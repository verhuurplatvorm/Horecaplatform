import type { SupabaseClient } from "@supabase/supabase-js";

export interface IdentifiedSupplier {
  supplierId: string;
  supplierName: string;
}

/**
 * Probeert de leverancier te herkennen puur op basis van de platte tekst
 * in de PDF (naam/btw-nummer/kvk-nummer), vóórdat Claude wordt
 * aangeroepen — zodat bekende aanwijzingen over de factuuropmaak van
 * deze leverancier meteen in dezelfde Claude-aanroep meegegeven kunnen
 * worden, zonder een tweede (duurdere) OCR-ronde.
 *
 * Dit is bewust een goedkope, tekst-gebaseerde gok — de uiteindelijke,
 * gezaghebbende leveranciersmatch blijft na de Claude-extractie gebeuren
 * via match_supplier_from_invoice (btw/kvk/iban uit de gestructureerde
 * data).
 */
export async function identifySupplierFromPdfText(
  buffer: Buffer,
  groupId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>
): Promise<IdentifiedSupplier | null> {
  let text = "";
  try {
    if (typeof (globalThis as Record<string, unknown>).DOMMatrix === "undefined") {
      (globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix {};
    }
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    text = (result.text ?? "").toLowerCase();
  } catch (err) {
    console.warn("[invoice-import] Kan platte tekst niet uit PDF halen voor leveranciersherkenning:", err);
    return null;
  }

  if (!text.trim()) return null;

  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name, vat_number, kvk_number")
    .eq("group_id", groupId)
    .eq("is_active", true);

  if (!suppliers || suppliers.length === 0) return null;

  for (const supplier of suppliers) {
    const vat = supplier.vat_number?.toLowerCase().replace(/\s/g, "");
    const kvk = supplier.kvk_number?.toLowerCase().replace(/\s/g, "");
    const textCompact = text.replace(/\s/g, "");

    if (vat && vat.length > 4 && textCompact.includes(vat)) {
      return { supplierId: supplier.id, supplierName: supplier.name };
    }
    if (kvk && kvk.length >= 6 && textCompact.includes(kvk)) {
      return { supplierId: supplier.id, supplierName: supplier.name };
    }
  }

  for (const supplier of suppliers) {
    const name = supplier.name?.toLowerCase().trim();
    if (name && name.length >= 5 && text.includes(name)) {
      return { supplierId: supplier.id, supplierName: supplier.name };
    }
  }

  return null;
}

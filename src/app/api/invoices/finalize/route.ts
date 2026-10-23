import { NextResponse } from "next/server";
import { normalizeIban } from "@/lib/invoice-import/iban";
import { createClient } from "@/lib/supabase/server";
import { createImportBatch } from "@/lib/price-import/create-batch";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import type { ParsedInvoiceHeader, ParsedInvoiceLine } from "@/lib/invoice-import/parse-ubl";
import { linesToRows } from "@/lib/invoice-import/lines-to-rows";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  }

  const body = await request.json();
  const {
    header,
    lines,
    storagePath,
    companyId,
    originalFilename,
    supplierId: existingSupplierId,
    newSupplierName,
    confirmIbanMismatch,
  } = body as {
    header: ParsedInvoiceHeader;
    lines: ParsedInvoiceLine[];
    storagePath: string | null;
    companyId: string | null;
    originalFilename: string;
    supplierId?: string;
    newSupplierName?: string;
    confirmIbanMismatch?: boolean;
  };

  const groupId = await getCurrentGroupId(supabase);
  if (!groupId) {
    return NextResponse.json({ error: "Kan groep niet bepalen." }, { status: 400 });
  }

  let supplierId = existingSupplierId ?? null;

  if (!supplierId) {
    if (!newSupplierName?.trim()) {
      return NextResponse.json(
        { error: "Kies een bestaande leverancier of geef een naam op voor een nieuwe." },
        { status: 400 }
      );
    }
    const { data: created, error: supplierError } = await supabase
      .from("suppliers")
      .insert({
        group_id: groupId,
        name: newSupplierName.trim(),
        vat_number: header.supplierVatNumber,
        kvk_number: header.supplierKvkNumber,
        iban: normalizeIban(header.supplierIban),
        iban_verified_at: header.supplierIban ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (supplierError || !created) {
      return NextResponse.json(
        { error: "Kan leverancier niet aanmaken: " + (supplierError?.message ?? "") },
        { status: 500 }
      );
    }
    supplierId = created.id;
  }

  // Handmatig gekozen bestaande leverancier: onthoud de koppeling, zodat
  // dezelfde leverancier de volgende keer vanzelf wordt herkend.
  if (existingSupplierId) {
    await rememberSupplierLink(supabase, groupId, existingSupplierId, header);
  }

  if (header.supplierIban && !confirmIbanMismatch) {
    const { data: supplier } = await supabase
      .from("suppliers")
      .select("iban")
      .eq("id", supplierId)
      .single();
    if (supplier?.iban && normalizeIban(supplier.iban) !== normalizeIban(header.supplierIban)) {
      return NextResponse.json(
        {
          error:
            "Het IBAN op deze factuur wijkt af van het bekende IBAN van deze leverancier. Bevestig dit expliciet voordat de factuur verwerkt wordt.",
        },
        { status: 400 }
      );
    }
  }

  if (confirmIbanMismatch && header.supplierIban) {
    await supabase
      .from("suppliers")
      .update({ iban: normalizeIban(header.supplierIban), iban_verified_at: new Date().toISOString() })
      .eq("id", supplierId);
  }

  const result = await createImportBatch(supabase, {
    groupId,
    supplierId,
    companyId: companyId || null,
    originalFilename,
    importedBy: user.id,
    parsedRows: linesToRows(lines),
    invoice: {
      invoiceNumber: header.invoiceNumber,
      invoiceDate: header.invoiceDate,
      dueDate: header.dueDate,
      supplierVatNumber: header.supplierVatNumber,
      supplierKvkNumber: header.supplierKvkNumber,
      supplierIban: header.supplierIban,
      ibanMismatch: false,
      totalInclVat: header.totalInclVat,
      originalFilePath: storagePath,
    },
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ batchId: result.batchId });
}

/**
 * Leert van een handmatige leverancierskeuze:
 * - de naam op de factuur wordt een bevestigde alias van de leverancier;
 * - lege btw-/kvk-velden van de leverancier worden aangevuld. Bestaande
 *   waarden worden nooit overschreven en het IBAN wordt hier bewust niet
 *   aangepast (daar geldt de aparte IBAN-controle).
 * Fouten hierbij mogen het verwerken van de factuur niet blokkeren.
 */
async function rememberSupplierLink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  groupId: string,
  supplierId: string,
  header: ParsedInvoiceHeader
) {
  try {
    const aliasName = header.supplierName?.trim();
    const aliasKey = (aliasName ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (aliasName && aliasKey.length >= 3) {
      await supabase.from("supplier_name_aliases").upsert(
        { group_id: groupId, supplier_id: supplierId, alias_name: aliasName, alias_key: aliasKey },
        { onConflict: "group_id,alias_key" }
      );
    }

    const { data: supplier } = await supabase
      .from("suppliers")
      .select("vat_number, kvk_number, iban")
      .eq("id", supplierId)
      .single();
    if (supplier) {
      const patch: Record<string, string> = {};
      if (!supplier.vat_number && header.supplierVatNumber) patch.vat_number = header.supplierVatNumber;
      if (!supplier.kvk_number && header.supplierKvkNumber) patch.kvk_number = header.supplierKvkNumber;
      if (!supplier.iban && header.supplierIban) {
        patch.iban = normalizeIban(header.supplierIban)!;
        patch.iban_verified_at = new Date().toISOString();
      }
      if (Object.keys(patch).length > 0) {
        await supabase.from("suppliers").update(patch).eq("id", supplierId);
      }
    }
  } catch (err) {
    console.warn("[invoice-import] Kan leverancierskoppeling niet onthouden:", err);
  }
}

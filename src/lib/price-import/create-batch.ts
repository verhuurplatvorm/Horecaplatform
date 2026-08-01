import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedPriceRow } from "./columns";
import { matchRowsToProducts, type MatchedRow } from "./match";
import { parsePackagingText, UNIT_TO_BASE_FACTOR } from "./packaging-parser";

/**
 * Maakt automatisch een nieuw product aan voor factuurregels die zeker
 * geen match hebben (confidence 'nieuw' — geen EAN/artikelnummer-treffer
 * én geen sterk gelijkende naam). Regels met een 'waarschijnlijk'- of
 * 'mogelijk_dubbel'-signaal worden bewust NIET automatisch aangemaakt —
 * die vereisen een menselijke blik om te voorkomen dat een bestaand
 * product per ongeluk dubbel wordt aangemaakt onder een net iets andere
 * naam of schrijfwijze.
 */
async function autoCreateNewProducts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  groupId: string,
  rows: MatchedRow[]
): Promise<MatchedRow[]> {
  const { data: units } = await supabase.from("units").select("id, key");
  const unitIdByKey = new Map((units ?? []).map((u: { id: string; key: string }) => [u.key, u.id]));
  const createdByName = new Map<string, string>();

  const result: MatchedRow[] = [];
  for (const row of rows) {
    if (row.confidence !== "nieuw" || row.matchedProductId || !row.description) {
      result.push(row);
      continue;
    }

    const key = row.description.trim().toLowerCase();
    let productId = createdByName.get(key);

    if (!productId) {
      const parsedPackaging = row.packagingDescription
        ? parsePackagingText(row.packagingDescription)
        : null;
      const baseUnitKey = parsedPackaging
        ? (UNIT_TO_BASE_FACTOR[parsedPackaging.unit]?.baseUnitKey ?? "stuk")
        : "stuk";
      const baseUnitId = unitIdByKey.get(baseUnitKey) ?? unitIdByKey.get("stuk");
      if (!baseUnitId) {
        result.push(row);
        continue;
      }

      const { data: newProduct, error: productError } = await supabase
        .from("products")
        .insert({
          group_id: groupId,
          name: row.description,
          article_number: row.articleNumber,
          ean_code: row.eanCode,
          brand: row.brand,
          base_unit_id: baseUnitId,
          kind: "inkoopartikel" as const,
        })
        .select("id")
        .single();

      if (productError || !newProduct) {
        result.push(row);
        continue;
      }
      productId = newProduct.id as string;
      createdByName.set(key, productId);

      if (row.packagingDescription && row.packagingUnitCount) {
        await supabase.from("product_packagings").insert({
          product_id: productId,
          name: row.packagingDescription,
          quantity_in_base_unit: row.packagingUnitCount,
          is_default: true,
        });
      }
    }

    result.push({
      ...row,
      matchedProductId: productId,
      matchMethod: "automatisch_aangemaakt" as const,
      confidence: "gekoppeld" as const,
    });
  }

  return result;
}

/**
 * Maakt een prijsimport-batch + -regels aan van al genormaliseerde,
 * gematchte rijen. Gedeeld tussen de "gewone" upload-route en de
 * finalize-route van het kolommen-koppelscherm, zodat er maar één plek
 * is die de batch-structuur kent.
 */
export async function createImportBatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  params: {
    groupId: string;
    supplierId: string;
    companyId: string | null;
    originalFilename: string;
    importedBy: string;
    parsedRows: ParsedPriceRow[];
    invoice?: {
      invoiceNumber: string | null;
      invoiceDate: string | null;
      dueDate: string | null;
      supplierVatNumber: string | null;
      supplierKvkNumber: string | null;
      supplierIban: string | null;
      ibanMismatch: boolean;
      totalInclVat: number | null;
      originalFilePath: string | null;
    };
  }
): Promise<{ batchId: string } | { error: string }> {
  const { groupId, supplierId, companyId, originalFilename, importedBy, parsedRows, invoice } =
    params;

  let { data: source } = await supabase
    .from("supplier_price_sources")
    .select("id")
    .eq("supplier_id", supplierId)
    .eq("source_type", "manual_upload")
    .maybeSingle();

  if (!source) {
    const { data: created, error: createSourceError } = await supabase
      .from("supplier_price_sources")
      .insert({ supplier_id: supplierId, source_type: "manual_upload" })
      .select("id")
      .single();
    if (createSourceError || !created) {
      return { error: "Kan geen prijsbron aanmaken voor deze leverancier." };
    }
    source = created;
  }

  let matched = await matchRowsToProducts(supabase, groupId, parsedRows);

  // Alleen bij facturen worden zeker-nieuwe artikelen automatisch
  // aangemaakt en aan deze leverancier gekoppeld — bij een gewone
  // prijslijst-import blijft dat een bewuste, aparte bulk-actie.
  if (invoice) {
    matched = await autoCreateNewProducts(supabase, groupId, matched);
  }

  const matchedCount = matched.filter((r) => r.matchedProductId).length;

  const { data: batch, error: batchError } = await supabase
    .from("price_import_batches")
    .insert({
      group_id: groupId,
      supplier_id: supplierId,
      price_source_id: source.id,
      company_id: companyId,
      status: "wacht_op_controle",
      original_filename: originalFilename,
      total_rows: matched.length,
      matched_rows: matchedCount,
      unmatched_rows: matched.length - matchedCount,
      imported_by: importedBy,
      source_kind: invoice ? "factuur" : "prijslijst",
      invoice_number: invoice?.invoiceNumber ?? null,
      invoice_date: invoice?.invoiceDate ?? null,
      due_date: invoice?.dueDate ?? null,
      supplier_vat_number_on_invoice: invoice?.supplierVatNumber ?? null,
      supplier_kvk_number_on_invoice: invoice?.supplierKvkNumber ?? null,
      supplier_iban_on_invoice: invoice?.supplierIban ?? null,
      iban_mismatch: invoice?.ibanMismatch ?? false,
      total_incl_vat: invoice?.totalInclVat ?? null,
      original_file_path: invoice?.originalFilePath ?? null,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return { error: "Kan importbatch niet aanmaken." };
  }

  const rowsToInsert = matched.map((row) => ({
    batch_id: batch.id,
    row_number: row.rowNumber,
    raw: row.raw,
    ean_code: row.eanCode,
    article_number: row.articleNumber,
    description: row.description,
    brand: row.brand,
    packaging_description: row.packagingDescription,
    packaging_unit_count: row.packagingUnitCount,
    purchase_price: row.purchasePrice,
    matched_product_id: row.matchedProductId,
    match_method: row.matchMethod,
    match_confidence: row.confidence,
    suggested_product_ids: row.suggestions.map((s) => s.id),
    status: (row.matchedProductId ? "gematcht" : "niet_gematcht") as
      | "gematcht"
      | "niet_gematcht",
  }));

  const { error: rowsError } = await supabase
    .from("price_import_rows")
    .insert(rowsToInsert);

  if (rowsError) {
    return { error: "Kan importregels niet opslaan." };
  }

  return { batchId: batch.id };
}

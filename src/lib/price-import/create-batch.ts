import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedPriceRow } from "./columns";
import { matchRowsToProducts } from "./match";

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
  }
): Promise<{ batchId: string } | { error: string }> {
  const { groupId, supplierId, companyId, originalFilename, importedBy, parsedRows } = params;

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

  const matched = await matchRowsToProducts(supabase, groupId, parsedRows);
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

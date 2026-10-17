import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Automatisch doorvoeren van een factuur-batch wanneer de procedure klopt
 * (zekere leverancier, geen IBAN-afwijking). Per regel gelden vangnetten:
 *  - alleen gekoppelde regels met een prijs;
 *  - een prijssprong groter dan MAX_AUTO_CHANGE_PCT blijft voor controle liggen;
 *  - een nieuwe prijs zonder verpakkingsaantal blijft voor controle liggen.
 * Wat niet automatisch kan, blijft in de batch staan als "te controleren".
 * Prijsalarmen en prijshistorie werken daarna precies als bij handmatig
 * toepassen (dezelfde database-functie).
 */
export const MAX_AUTO_CHANGE_PCT = 50;

export type AutoRowDecision = "toepassen" | "controle";

/** Zuivere beslisregel per regel (getest). */
export function decideAutoRow(input: {
  newPrice: number | null;
  packagingUnitCount: number | null;
  existingPrice: number | null;
}): { decision: AutoRowDecision; reason?: string } {
  const { newPrice, packagingUnitCount, existingPrice } = input;
  if (newPrice === null || !(newPrice > 0)) return { decision: "controle", reason: "prijs ontbreekt" };
  if (existingPrice !== null && existingPrice > 0) {
    const pct = (Math.abs(newPrice - existingPrice) / existingPrice) * 100;
    if (pct > MAX_AUTO_CHANGE_PCT) {
      return { decision: "controle", reason: `prijssprong van ${pct.toFixed(0)}%` };
    }
    return { decision: "toepassen" };
  }
  if (!packagingUnitCount || packagingUnitCount <= 0) {
    return { decision: "controle", reason: "verpakkingsaantal ontbreekt" };
  }
  return { decision: "toepassen" };
}

export async function autoApplyInvoiceBatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  batchId: string
): Promise<{ applied: number; left: number; errors: string[] }> {
  const { data: batch } = await supabase
    .from("price_import_batches")
    .select("id, supplier_id, company_id")
    .eq("id", batchId)
    .single();
  const { data: rows } = await supabase
    .from("price_import_rows")
    .select("id, matched_product_id, status, purchase_price, packaging_unit_count, description, row_number")
    .eq("batch_id", batchId);
  if (!batch || !rows) return { applied: 0, left: 0, errors: ["batch niet gevonden"] };

  const candidates = rows.filter((r) => r.matched_product_id && r.status === "gematcht");
  const productIds = [...new Set(candidates.map((r) => r.matched_product_id as string))];
  const existing = new Map<string, number>();
  for (let i = 0; i < productIds.length; i += 200) {
    let q = supabase
      .from("supplier_products")
      .select("product_id, purchase_price")
      .eq("supplier_id", batch.supplier_id)
      .is("valid_to", null)
      .in("product_id", productIds.slice(i, i + 200));
    q = batch.company_id ? q.eq("company_id", batch.company_id) : q.is("company_id", null);
    const { data } = await q;
    for (const sp of data ?? []) existing.set(sp.product_id as string, Number(sp.purchase_price));
  }

  let applied = 0;
  const errors: string[] = [];
  for (const row of candidates) {
    const verdict = decideAutoRow({
      newPrice: row.purchase_price === null ? null : Number(row.purchase_price),
      packagingUnitCount: row.packaging_unit_count === null ? null : Number(row.packaging_unit_count),
      existingPrice: existing.get(row.matched_product_id as string) ?? null,
    });
    if (verdict.decision === "controle") continue;
    const { error } = await supabase.rpc("apply_price_import_row", { p_row_id: row.id });
    if (error) {
      errors.push(
        `${row.description ?? "regel " + row.row_number}: ${error.message.replace(/Kan regel [0-9a-f-]+ niet toepassen:\s*/i, "")}`
      );
    } else {
      applied++;
    }
  }

  const { data: after } = await supabase
    .from("price_import_rows")
    .select("status")
    .eq("batch_id", batchId);
  const left = (after ?? []).filter((r) => r.status === "gematcht" || r.status === "niet_gematcht").length;

  await supabase
    .from("price_import_batches")
    .update({
      status: left === 0 && errors.length === 0 ? "toegepast" : "wacht_op_controle",
      applied_rows: applied,
      error_message: errors.length > 0 ? errors.join("; ") : null,
      completed_at: left === 0 && errors.length === 0 ? new Date().toISOString() : null,
    })
    .eq("id", batchId);

  return { applied, left, errors };
}

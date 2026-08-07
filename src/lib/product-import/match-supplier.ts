import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSupplierName } from "./parse-multi-supplier";

export interface SupplierMatchResult {
  supplierId: string | null;
  matched: boolean;
}

/**
 * Koppelt leveranciersnamen uit het bestand aan bestaande leveranciers —
 * exact, of na het strippen van een bekend achtervoegsel (bv.
 * "- InOne"). Maakt NOOIT automatisch een nieuwe leverancier aan; een
 * niet-gevonden naam blijft ongekoppeld voor handmatige controle.
 */
export async function buildSupplierMatchMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  groupId: string,
  rawSupplierNames: string[]
): Promise<Map<string, SupplierMatchResult>> {
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("group_id", groupId)
    .eq("is_active", true);

  const byNormalizedName = new Map<string, string>();
  for (const s of suppliers ?? []) {
    byNormalizedName.set(normalizeSupplierName(s.name), s.id);
  }

  const result = new Map<string, SupplierMatchResult>();
  for (const raw of rawSupplierNames) {
    const supplierId = byNormalizedName.get(normalizeSupplierName(raw)) ?? null;
    result.set(raw, { supplierId, matched: supplierId !== null });
  }
  return result;
}

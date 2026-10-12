import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedPriceRow } from "./columns";

/** Omschrijving vergelijkbaar maken: kleine letters, alleen letters/cijfers. */
export function normalizeItemKey(description: string | null | undefined): string {
  return (description ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Haalt regels weg die de gebruiker eerder als "niet meer verwerken" heeft
 * aangemerkt voor deze leverancier. Herkenning op artikelnummer van de
 * leverancier; ontbreekt dat op de regel of in de lijst, dan op de
 * genormaliseerde omschrijving.
 */
export async function removeIgnoredRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  supplierId: string,
  rows: ParsedPriceRow[]
): Promise<{ rows: ParsedPriceRow[]; ignoredCount: number }> {
  const { data, error } = await supabase
    .from("ignored_invoice_items")
    .select("article_number, description_key")
    .eq("supplier_id", supplierId);

  if (error || !data || data.length === 0) {
    return { rows, ignoredCount: 0 };
  }

  const articles = new Set<string>();
  const keys = new Set<string>();
  for (const item of data as { article_number: string | null; description_key: string }[]) {
    if (item.article_number) articles.add(item.article_number);
    else keys.add(item.description_key);
  }

  const kept = rows.filter((row) => {
    if (row.articleNumber && articles.has(row.articleNumber)) return false;
    const key = normalizeItemKey(row.description);
    if (key && keys.has(key)) return false;
    return true;
  });

  return { rows: kept, ignoredCount: rows.length - kept.length };
}

const EMBALLAGE_PATTERN = /\b(emballage|statiegeld|leeggoed|retouremballage|borg)\b/i;

/**
 * Emballage-/statiegeldregels (kratten, flessen, pallets) zijn geen artikel
 * en horen niet in het systeem. Bewust alleen duidelijke woorden; "fust" of
 * "krat" alleen zou ook gewoon product (bv. een fust bier) kunnen zijn.
 */
export function isEmballageRow(row: ParsedPriceRow): boolean {
  return EMBALLAGE_PATTERN.test(row.description ?? "");
}

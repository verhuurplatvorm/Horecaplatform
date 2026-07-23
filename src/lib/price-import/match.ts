import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedPriceRow } from "./columns";

export interface MatchedRow extends ParsedPriceRow {
  matchedProductId: string | null;
  matchMethod: "ean" | "artikelnummer" | null;
}

/**
 * Matcht geparste rijen tegen de centrale productdatabase van de groep,
 * eerst op EAN-code (het meest betrouwbaar), dan op artikelnummer.
 * Rijen die niets matchen blijven `matchedProductId: null` — die worden
 * in de UI ter handmatige koppeling voorgelegd, in plaats van
 * overgeslagen (spec §10/§28: dubbele artikelen en afwijkende
 * artikelnamen moeten expliciet zichtbaar zijn, niet stil verdwijnen).
 */
export async function matchRowsToProducts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  groupId: string,
  rows: ParsedPriceRow[]
): Promise<MatchedRow[]> {
  const eanCodes = [...new Set(rows.map((r) => r.eanCode).filter(Boolean))];
  const articleNumbers = [
    ...new Set(rows.map((r) => r.articleNumber).filter(Boolean)),
  ];

  const [byEan, byArticle] = await Promise.all([
    eanCodes.length > 0
      ? supabase
          .from("products")
          .select("id, ean_code")
          .eq("group_id", groupId)
          .in("ean_code", eanCodes)
      : Promise.resolve({ data: [] as { id: string; ean_code: string | null }[] }),
    articleNumbers.length > 0
      ? supabase
          .from("products")
          .select("id, article_number")
          .eq("group_id", groupId)
          .in("article_number", articleNumbers)
      : Promise.resolve({
          data: [] as { id: string; article_number: string | null }[],
        }),
  ]);

  const eanMap = new Map(
    (byEan.data ?? [])
      .filter((p) => p.ean_code)
      .map((p) => [p.ean_code as string, p.id])
  );
  const articleMap = new Map(
    (byArticle.data ?? [])
      .filter((p) => p.article_number)
      .map((p) => [p.article_number as string, p.id])
  );

  return rows.map((row) => {
    if (row.eanCode && eanMap.has(row.eanCode)) {
      return {
        ...row,
        matchedProductId: eanMap.get(row.eanCode)!,
        matchMethod: "ean" as const,
      };
    }
    if (row.articleNumber && articleMap.has(row.articleNumber)) {
      return {
        ...row,
        matchedProductId: articleMap.get(row.articleNumber)!,
        matchMethod: "artikelnummer" as const,
      };
    }
    return { ...row, matchedProductId: null, matchMethod: null };
  });
}

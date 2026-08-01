import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedPriceRow } from "./columns";

export type MatchConfidence =
  | "gekoppeld" // betrouwbaar automatisch gekoppeld (EAN/artikelnummer)
  | "waarschijnlijk" // vergelijkbare naam gevonden, gebruiker moet bevestigen
  | "nieuw" // geen enkele match, waarschijnlijk een nieuw artikel
  | "mogelijk_dubbel"; // lijkt al te bestaan onder een andere naam/code

export interface MatchedRow extends ParsedPriceRow {
  matchedProductId: string | null;
  matchMethod: "ean" | "artikelnummer" | "handmatig" | "automatisch_aangemaakt" | null;
  confidence: MatchConfidence;
  /** Bij 'waarschijnlijk' of 'mogelijk_dubbel': maximaal 3 kandidaten om uit te kiezen. */
  suggestions: { id: string; name: string }[];
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Eenvoudige gelijkenis: aandeel gedeelde woorden (geen zware Levenshtein-
 * implementatie nodig voor "waarschijnlijk gekoppeld"-suggesties). */
function nameSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeName(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalizeName(b).split(" ").filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared++;
  return shared / Math.max(wordsA.size, wordsB.size);
}

/**
 * Matcht geparste rijen tegen de centrale productdatabase van de groep,
 * eerst op EAN-code (het meest betrouwbaar), dan op artikelnummer. Rijen
 * zonder exacte match krijgen een vertrouwensniveau (spec §7): een
 * vergelijkbare naam wordt als suggestie getoond ("waarschijnlijk
 * gekoppeld"), maar nooit automatisch gekoppeld — de gebruiker bevestigt
 * altijd met één klik.
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

  const [byEan, byArticle, allProducts] = await Promise.all([
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
    supabase.from("products").select("id, name").eq("group_id", groupId),
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
  const productList: { id: string; name: string }[] = allProducts.data ?? [];

  return rows.map((row) => {
    if (row.eanCode && eanMap.has(row.eanCode)) {
      return {
        ...row,
        matchedProductId: eanMap.get(row.eanCode)!,
        matchMethod: "ean" as const,
        confidence: "gekoppeld" as const,
        suggestions: [],
      };
    }
    if (row.articleNumber && articleMap.has(row.articleNumber)) {
      return {
        ...row,
        matchedProductId: articleMap.get(row.articleNumber)!,
        matchMethod: "artikelnummer" as const,
        confidence: "gekoppeld" as const,
        suggestions: [],
      };
    }

    // Geen exacte match: zoek op naamgelijkenis voor suggesties.
    const name = row.description ?? "";
    const scored = name
      ? productList
          .map((p) => ({ p, score: nameSimilarity(name, p.name) }))
          .filter((s) => s.score >= 0.4)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
      : [];

    const suggestions = scored.map((s) => ({ id: s.p.id, name: s.p.name }));
    const bestScore = scored[0]?.score ?? 0;

    return {
      ...row,
      matchedProductId: null,
      matchMethod: null,
      confidence:
        bestScore >= 0.75
          ? ("mogelijk_dubbel" as const)
          : suggestions.length > 0
          ? ("waarschijnlijk" as const)
          : ("nieuw" as const),
      suggestions,
    };
  });
}

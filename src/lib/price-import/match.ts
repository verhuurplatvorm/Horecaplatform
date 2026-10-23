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

export function normalizeName(name: string): string {
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
 * Matcht geparste rijen tegen de centrale ingrediëntendatabase van de groep,
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
  rows: ParsedPriceRow[],
  supplierId?: string | null
): Promise<MatchedRow[]> {
  const eanCodes = [...new Set(rows.map((r) => r.eanCode).filter(Boolean))];
  const articleNumbers = [
    ...new Set(rows.map((r) => r.articleNumber).filter(Boolean)),
  ];

  const [byEan, byArticle, allProducts, bySupplierCode, byDescription] = await Promise.all([
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
    // Geheugen per leverancier: een artikelnummer van DEZE leverancier dat
    // eerder aan een ingrediënt is gekoppeld (bevestigd bij een eerdere
    // factuur of prijslijst) wordt bij een terugkerende factuur direct
    // herkend. Alleen eigen artikelnummers van de leverancier tellen mee.
    supplierId && articleNumbers.length > 0
      ? supabase
          .from("supplier_products")
          .select("supplier_article_code, product_id, valid_to")
          .eq("supplier_id", supplierId)
          .in("supplier_article_code", articleNumbers)
      : Promise.resolve({
          data: [] as {
            supplier_article_code: string | null;
            product_id: string;
            valid_to: string | null;
          }[],
        }),
    // Geheugen per leverancier voor regels zonder codes: dezelfde omschrijving
    // eerder bevestigd = direct dezelfde koppeling.
    supplierId
      ? supabase
          .from("supplier_description_matches")
          .select("normalized_description, product_id")
          .eq("supplier_id", supplierId)
      : Promise.resolve({
          data: [] as { normalized_description: string; product_id: string }[],
        }),
  ]);

  const descriptionMap = new Map<string, string>(
    (byDescription.data ?? []).map((d) => [d.normalized_description, d.product_id])
  );

  // code -> product; bij een code die naar meerdere producten wijst is het
  // niet zeker welke bedoeld is, dan laten we de koppeling over aan een mens.
  const codeProducts = new Map<string, Set<string>>();
  for (const sp of bySupplierCode.data ?? []) {
    if (!sp.supplier_article_code) continue;
    const set = codeProducts.get(sp.supplier_article_code) ?? new Set<string>();
    set.add(sp.product_id);
    codeProducts.set(sp.supplier_article_code, set);
  }
  const supplierCodeMap = new Map<string, string>();
  for (const [code, set] of codeProducts) {
    if (set.size === 1) supplierCodeMap.set(code, [...set][0]);
  }

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
    if (row.articleNumber && supplierCodeMap.has(row.articleNumber)) {
      return {
        ...row,
        matchedProductId: supplierCodeMap.get(row.articleNumber)!,
        matchMethod: "artikelnummer" as const,
        confidence: "gekoppeld" as const,
        suggestions: [],
      };
    }
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

    if (row.description) {
      const remembered = descriptionMap.get(normalizeName(row.description));
      if (remembered) {
        return {
          ...row,
          matchedProductId: remembered,
          matchMethod: "artikelnummer" as const,
          confidence: "gekoppeld" as const,
          suggestions: [],
        };
      }
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

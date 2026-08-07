import type { SupabaseClient } from "@supabase/supabase-js";

export interface MatchResult {
  type: "product" | "halfproduct" | "unmatched";
  id: string | null;
  matchMethod: "artikelnummer" | "receptnaam" | "naam_gelijkenis" | "geen";
}

/**
 * Bepaalt waar een geïmporteerd ingrediënt aan gekoppeld moet worden, in
 * volgorde van betrouwbaarheid:
 * 1. Een recept/halfproduct met exact dezelfde naam (ook net in deze
 *    import aangemaakt) — bv. "Aioli" als ingrediënt van "Tomaten aioli"
 *    hoort aan het halfproduct Aioli te verwijzen, niet aan een los
 *    product met die naam.
 * 2. Een product met hetzelfde leverancier-artikelnummer — de meest
 *    betrouwbare match, want dat nummer is uniek per artikel.
 * 3. Een product met een sterk gelijkende naam.
 * 4. Geen van bovenstaande: blijft ongekoppeld, voor handmatige controle.
 */
export async function matchIngredient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  groupId: string,
  ingredientName: string,
  supplierArticleNumber: string | null,
  recipeNameToId: Map<string, string>
): Promise<MatchResult> {
  const normalizedName = ingredientName.trim().toLowerCase();

  const recipeMatch = recipeNameToId.get(normalizedName);
  if (recipeMatch) {
    return { type: "halfproduct", id: recipeMatch, matchMethod: "receptnaam" };
  }

  if (supplierArticleNumber) {
    const { data: byArticleNumber } = await supabase
      .from("products")
      .select("id")
      .eq("group_id", groupId)
      .eq("article_number", supplierArticleNumber)
      .limit(1)
      .maybeSingle();
    if (byArticleNumber) {
      return { type: "product", id: byArticleNumber.id, matchMethod: "artikelnummer" };
    }
  }

  const { data: candidates } = await supabase.rpc("match_product_by_name", {
    p_group_id: groupId,
    p_name: ingredientName,
  });
  const best = candidates?.[0];
  if (best && best.similarity_score > 0.55) {
    return { type: "product", id: best.product_id, matchMethod: "naam_gelijkenis" };
  }

  return { type: "unmatched", id: null, matchMethod: "geen" };
}

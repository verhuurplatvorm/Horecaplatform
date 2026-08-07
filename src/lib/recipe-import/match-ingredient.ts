import type { SupabaseClient } from "@supabase/supabase-js";

export interface MatchResult {
  type: "product" | "halfproduct" | "unmatched";
  id: string | null;
  matchMethod: "artikelnummer" | "receptnaam" | "geen";
}

/**
 * Bepaalt waar een geïmporteerd ingrediënt aan gekoppeld moet worden —
 * uitsluitend op basis van EXACTE, betrouwbare kenmerken. Er wordt
 * bewust NOOIT op naamgelijkenis gegokt: als er geen zekere match is,
 * blijft de regel leeg en gemarkeerd voor handmatige controle, in
 * plaats van een mogelijk verkeerde koppeling automatisch door te
 * voeren.
 *
 * Volgorde van betrouwbaarheid:
 * 1. Een recept/halfproduct met exact dezelfde naam (ook net in deze
 *    import aangemaakt) — bv. "Aioli" als ingrediënt van "Tomaten aioli"
 *    hoort aan het halfproduct Aioli te verwijzen, niet aan een los
 *    product met die naam.
 * 2. Een product met hetzelfde leverancier-artikelnummer — uniek per
 *    artikel, dus betrouwbaar.
 * 3. Geen van bovenstaande: blijft ongekoppeld, voor handmatige controle.
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

  return { type: "unmatched", id: null, matchMethod: "geen" };
}

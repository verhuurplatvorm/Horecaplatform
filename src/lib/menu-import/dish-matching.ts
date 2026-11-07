/**
 * Slim koppelen van menukaartregels aan bestaande gerechten.
 *
 * De database (match_menu_dishes, migratie 0107) vergelijkt genormaliseerde
 * namen. Hier bepalen we per regel het voorstel:
 * - "zeker": naam is na normaliseren gelijk → standaard gekoppeld
 * - "waarschijnlijk": sterk gelijkend (≥ 0.7) → standaard gekoppeld, wel
 *   gemarkeerd om te controleren
 * - anders: alleen als keuze in de lijst, standaard "Nieuw aanmaken"
 */

export const LIKELY_MATCH_THRESHOLD = 0.7;

export interface DishCandidate {
  recipe_id: string;
  recipe_name: string;
  company_id: string | null;
  status: string | null;
  sales_price: number | null;
  similarity_score: number;
  is_exact: boolean;
}

export interface MatchRow extends DishCandidate {
  name_index: number;
}

export type MatchConfidence = "zeker" | "waarschijnlijk" | null;

/** Groepeert de RPC-uitvoer per regelindex. */
export function groupCandidates(rows: MatchRow[] | null, count: number): DishCandidate[][] {
  const result: DishCandidate[][] = Array.from({ length: count }, () => []);
  for (const r of rows ?? []) {
    if (r.name_index < 0 || r.name_index >= count) continue;
    result[r.name_index].push({
      recipe_id: r.recipe_id,
      recipe_name: r.recipe_name,
      company_id: r.company_id,
      status: r.status,
      sales_price: r.sales_price === null ? null : Number(r.sales_price),
      similarity_score: Number(r.similarity_score),
      is_exact: r.is_exact,
    });
  }
  return result;
}

/**
 * Alleen gerechten van hetzelfde bedrijf of groepsbrede gerechten zijn
 * geschikt. Bij een groepsbrede kaart (companyId leeg) mag alles.
 */
export function candidatesForCompany(
  candidates: DishCandidate[],
  companyId: string | null
): DishCandidate[] {
  if (!companyId) return candidates;
  return candidates.filter((c) => c.company_id === null || c.company_id === companyId);
}

export function pickSuggestion(
  candidates: DishCandidate[],
  companyId: string | null
): { recipeId: string | null; confidence: MatchConfidence } {
  const usable = candidatesForCompany(candidates, companyId);
  // Voorkeur: exact, dan eigen bedrijf boven groepsbreed, dan score.
  const sorted = [...usable].sort((a, b) => {
    if (a.is_exact !== b.is_exact) return a.is_exact ? -1 : 1;
    if (companyId) {
      const aOwn = a.company_id === companyId ? 1 : 0;
      const bOwn = b.company_id === companyId ? 1 : 0;
      if (aOwn !== bOwn) return bOwn - aOwn;
    }
    return b.similarity_score - a.similarity_score;
  });
  const best = sorted[0];
  if (!best) return { recipeId: null, confidence: null };
  if (best.is_exact) return { recipeId: best.recipe_id, confidence: "zeker" };
  if (best.similarity_score >= LIKELY_MATCH_THRESHOLD) {
    return { recipeId: best.recipe_id, confidence: "waarschijnlijk" };
  }
  return { recipeId: null, confidence: null };
}

/** Zelfde normalisatie als normalize_dish_name() in de database. */
export function normalizeDishName(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(stuks|stuk|stk)\b/g, "st")
    .replace(/\b(en|and)\b/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return [...new Set(tokens)].sort().join(" ");
}

/**
 * Naam zoals op de kaart, alleen opslaan als die echt afwijkt van de
 * gerechtnaam (bv. "Kinderpizza salami" bij gerecht "Kinderpizza").
 */
export function displayNameFor(cardName: string, recipeName: string): string | null {
  return normalizeDishName(cardName) === normalizeDishName(recipeName) ? null : cardName.trim();
}

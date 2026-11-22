/**
 * Prijsontwikkeling: gevolgen van prijswijzigingen voor halfproducten en
 * gerechten. De rijen komen uit price_change_impact (migratie 0150): één
 * rij per (ingrediënt, recept), met oude/nieuwe kostprijs uit de bestaande
 * kostprijsberekening waarin alleen dat ingrediënt op oud/nieuw staat.
 *
 * Omdat een kostprijs lineair is in elke ingrediëntprijs, telt het verschil
 * per ingrediënt precies op tot het totale verschil van een recept:
 *   nieuw = huidige kostprijs (alle prijzen nu)
 *   oud   = nieuw − Σ verschil per gewijzigd ingrediënt
 */

export interface ImpactRow {
  product_id: string;
  product_name: string;
  recipe_id: string;
  recipe_name: string;
  recipe_kind: string;
  category: string | null;
  /** Halfproducten tussen gerecht en ingrediënt (leeg = direct gebruikt). */
  via: string[];
  old_cost: number;
  new_cost: number;
  delta: number;
  sales_price_excl: number | null;
  active_cards: string[];
}

export interface RecipeImpact {
  recipeId: string;
  name: string;
  kind: "gerecht" | "halfproduct";
  category: string | null;
  activeCards: string[];
  /** Welke gewijzigde ingrediënten, en via welke halfproducten. */
  causes: { productId: string; productName: string; via: string[]; delta: number }[];
  oldCost: number;
  newCost: number;
  delta: number;
  deltaPct: number | null;
  salesPriceExcl: number | null;
  oldFoodcostPct: number | null;
  newFoodcostPct: number | null;
  /** Partijgerecht: kostprijs geldt per vorm in plaats van per portie. */
  perForm: boolean;
}

export const PARTY_CATEGORY = "Partijgerechten";

export function normalizeImpactRow(r: ImpactRow): ImpactRow {
  return {
    ...r,
    via: Array.isArray(r.via) ? r.via : [],
    active_cards: Array.isArray(r.active_cards) ? r.active_cards : [],
    old_cost: Number(r.old_cost),
    new_cost: Number(r.new_cost),
    delta: Number(r.delta),
    sales_price_excl: r.sales_price_excl === null ? null : Number(r.sales_price_excl),
  };
}

/**
 * Per recept samenvoegen (optioneel alleen voor één ingrediënt) en sorteren:
 * gerechten op een actieve menukaart eerst, daarna het grootste verschil.
 */
export function aggregateImpact(rows: ImpactRow[], productId?: string | null): RecipeImpact[] {
  const byRecipe = new Map<string, ImpactRow[]>();
  for (const r of rows) {
    if (productId && r.product_id !== productId) continue;
    byRecipe.set(r.recipe_id, [...(byRecipe.get(r.recipe_id) ?? []), r]);
  }
  const out: RecipeImpact[] = [];
  for (const list of byRecipe.values()) {
    const first = list[0];
    const delta = round4(list.reduce((s, r) => s + r.delta, 0));
    // Alleen één ingrediënt gekozen: precies de oude/nieuwe prijs van die rij.
    const newCost = first.new_cost;
    const oldCost = round4(newCost - delta);
    const sales = first.sales_price_excl;
    out.push({
      recipeId: first.recipe_id,
      name: first.recipe_name,
      kind: first.recipe_kind === "halfproduct" ? "halfproduct" : "gerecht",
      category: first.category,
      activeCards: first.active_cards,
      causes: list
        .map((r) => ({ productId: r.product_id, productName: r.product_name, via: r.via, delta: r.delta }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
      oldCost,
      newCost,
      delta,
      deltaPct: oldCost > 0 ? (delta / oldCost) * 100 : null,
      salesPriceExcl: sales,
      oldFoodcostPct: sales && sales > 0 ? (oldCost / sales) * 100 : null,
      newFoodcostPct: sales && sales > 0 ? (newCost / sales) * 100 : null,
      perForm: first.category === PARTY_CATEGORY,
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.activeCards.length > 0) - Number(a.activeCards.length > 0) ||
      Math.abs(b.delta) - Math.abs(a.delta) ||
      a.name.localeCompare(b.name, "nl"),
  );
}

/** "Pizza saus › Tomaat" of alleen "Tomaat" bij direct gebruik. */
export function describeCause(c: { productName: string; via: string[] }): string {
  return [...c.via, c.productName].join(" › ");
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

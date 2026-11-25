/**
 * "Kostprijs onvolledig": status bovenop de bestaande kostprijsberekening.
 *
 * De bedragen komen ongewijzigd uit de bestaande functies (calculate_recipe_costs,
 * calculate_event_menu_cost, ingredientLineCost/halfproductLineCost). Hier staat
 * alleen wát er ontbreekt, zodat een deelsom nooit als definitieve kostprijs
 * wordt getoond. Database-tegenhanger: recipe_cost_status (migratie 0146).
 */

export type CostIssueKind = "koppeling" | "prijs" | "omrekening" | "opbrengst" | "leeg";

export interface CostIssue {
  line_id: string | null;
  /** Recept waar de regel in staat (null = regel direct op een menu/buffet). */
  recipe_id: string | null;
  recipe_name: string | null;
  kind: CostIssueKind;
  /** Naam van de regel: ongekoppelde naam, ingrediënt of halfproduct. */
  name: string | null;
  product_id: string | null;
  sub_recipe_id: string | null;
  unit_name: string | null;
  /** Halfproducten vanaf de top tot het recept met de regel; leeg = eigen regel. */
  path: string[];
}

export interface CostStatus {
  isComplete: boolean;
  issues: CostIssue[];
}

export const COMPLETE: CostStatus = { isComplete: true, issues: [] };

export const ISSUE_LABEL: Record<CostIssueKind, string> = {
  koppeling: "niet gekoppeld",
  prijs: "geen inkoopprijs",
  omrekening: "eenheid niet om te rekenen",
  opbrengst: "halfproduct zonder opbrengst",
  leeg: "nog geen ingrediënten",
};

/** Eén regel tekst, bv. "Pizza saus › Tomaat: geen inkoopprijs". */
export function describeIssue(issue: CostIssue): string {
  const where = issue.path.length > 0 ? `${issue.path.join(" › ")} › ` : "";
  const unit = issue.kind === "omrekening" && issue.unit_name ? ` (${issue.unit_name})` : "";
  return `${where}${issue.name ?? "regel zonder naam"}${unit}: ${ISSUE_LABEL[issue.kind]}`;
}

/** Ruwe rij uit de database-functies naar een CostStatus. */
export function toCostStatus(row: { is_complete: boolean | null; issues: unknown } | null | undefined): CostStatus {
  if (!row) return COMPLETE;
  const issues = Array.isArray(row.issues) ? (row.issues as CostIssue[]) : [];
  return {
    isComplete: row.is_complete !== false && issues.length === 0,
    issues: issues.map((i) => ({ ...i, path: Array.isArray(i.path) ? i.path : [] })),
  };
}

/**
 * Wat er van de kostprijs getoond mag worden. Bij een onvolledige
 * berekening is het bedrag alleen "Bekende kosten" en zijn foodcost en
 * marge niet te bepalen (null).
 */
export function costDisplay(
  cost: number | null,
  status: CostStatus,
  salesPriceExVat: number | null,
): { label: "Kostprijs" | "Bekende kosten"; amount: number | null; foodcostPct: number | null; margin: number | null } {
  if (!status.isComplete) {
    return { label: "Bekende kosten", amount: cost, foodcostPct: null, margin: null };
  }
  const canCompute = cost !== null && salesPriceExVat !== null && salesPriceExVat > 0;
  return {
    label: "Kostprijs",
    amount: cost,
    foodcostPct: canCompute ? (cost / salesPriceExVat) * 100 : null,
    margin: canCompute ? salesPriceExVat - cost : null,
  };
}

/**
 * Status in het receptformulier (live, vóór opslaan). Hergebruikt de
 * regelkosten die het formulier al uitrekent: een regel met kosten null is
 * onvolledig. De status van gebruikte halfproducten komt uit de database
 * (recipe_cost_status) en werkt door met het halfproduct vooraan in het pad.
 */
export function formCostStatus(args: {
  rows: {
    lineId?: string | null;
    type: "ingrediënt" | "halfproduct";
    refId: string | null;
    refName: string | null;
    unmatchedName: string | null;
    quantity: string;
    unitName: string | null;
    /** Kosten van de regel zoals het formulier ze rekent (null = niet te rekenen). */
    cost: number | null;
    /** Alleen voor ingrediënten: is er een inkoopprijs bekend? */
    hasPrice?: boolean;
    /** Alleen voor halfproducten: heeft het halfproduct een opbrengst? */
    hasYield?: boolean;
  }[];
  halfproductStatus: Map<string, CostStatus>;
}): CostStatus {
  const issues: CostIssue[] = [];
  const base = { recipe_id: null, recipe_name: null, path: [] as string[] };
  for (const row of args.rows) {
    const isEmpty = !row.refId && !row.unmatchedName && !row.quantity.trim();
    if (isEmpty) continue;
    // Niet-gekoppelde regel met hoeveelheid 0 kost niets: blokkeert niet (zoals in de database).
    if (!row.refId && Number(row.quantity.replace(",", ".")) === 0) continue;
    if (!row.refId) {
      issues.push({
        ...base,
        line_id: row.lineId ?? null,
        kind: "koppeling",
        name: row.unmatchedName ?? row.refName,
        product_id: null,
        sub_recipe_id: null,
        unit_name: row.unitName,
      });
      continue;
    }
    // Zonder inkoopprijs rekent het formulier met € 0: dat is géén echte kostprijs.
    const missingPrice = row.type === "ingrediënt" && row.hasPrice === false;
    if (row.cost === null || missingPrice) {
      const kind: CostIssueKind =
        row.type === "ingrediënt"
          ? missingPrice
            ? "prijs"
            : "omrekening"
          : row.hasYield === false
            ? "opbrengst"
            : "omrekening";
      issues.push({
        ...base,
        line_id: row.lineId ?? null,
        kind,
        name: row.refName,
        product_id: row.type === "ingrediënt" ? row.refId : null,
        sub_recipe_id: row.type === "halfproduct" ? row.refId : null,
        unit_name: row.unitName,
      });
    }
    if (row.type === "halfproduct") {
      const sub = args.halfproductStatus.get(row.refId);
      if (sub && !sub.isComplete) {
        for (const i of sub.issues) {
          issues.push({ ...i, path: [row.refName ?? "halfproduct", ...i.path] });
        }
      }
    }
  }
  return { isComplete: issues.length === 0, issues };
}

// ---------------------------------------------------------------------
// Opschonen: aandachtspunten groeperen en prioriteren
// ---------------------------------------------------------------------

export interface AttentionItem {
  line_id: string;
  recipe_id: string | null;
  recipe_name: string;
  recipe_kind: string;
  kind: CostIssueKind;
  name: string | null;
  product_id: string | null;
  sub_recipe_id: string | null;
  unit_name: string | null;
  active_sources: string[];
}

export interface AttentionGroup {
  key: string;
  kind: CostIssueKind;
  name: string;
  product_id: string | null;
  sub_recipe_id: string | null;
  items: AttentionItem[];
  /** Aantal verschillende recepten/buffetten. */
  recipeCount: number;
  /** Aantal daarvan op een actieve kaart of in een actief buffet. */
  activeCount: number;
  activeSources: string[];
}

export function normalizeName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function groupKey(i: AttentionItem): string {
  if (i.kind === "koppeling") return `koppeling:${normalizeName(i.name)}`;
  if (i.product_id) return `${i.kind}:p:${i.product_id}`;
  if (i.sub_recipe_id) return `${i.kind}:s:${i.sub_recipe_id}`;
  return `${i.kind}:n:${normalizeName(i.name)}`;
}

/**
 * Eén groep per terugkerende naam (koppeling) of per ingrediënt/halfproduct
 * (prijs, omrekening, opbrengst). Volgorde: eerst wat op actieve
 * menukaarten of buffetten staat, daarna het meest gebruikte.
 */
export function groupAttentionItems(items: AttentionItem[]): AttentionGroup[] {
  const groups = new Map<string, AttentionGroup>();
  for (const item of items) {
    const key = groupKey(item);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        kind: item.kind,
        name: (item.name ?? "").trim() || "regel zonder naam",
        product_id: item.product_id,
        sub_recipe_id: item.sub_recipe_id,
        items: [],
        recipeCount: 0,
        activeCount: 0,
        activeSources: [],
      };
      groups.set(key, g);
    }
    g.items.push(item);
  }
  for (const g of groups.values()) {
    const recipes = new Map<string, boolean>();
    const sources = new Set<string>();
    for (const i of g.items) {
      const rk = i.recipe_id ?? `buffet:${i.recipe_name}`;
      const active = i.active_sources.length > 0;
      recipes.set(rk, (recipes.get(rk) ?? false) || active);
      i.active_sources.forEach((s) => sources.add(s));
    }
    g.recipeCount = recipes.size;
    g.activeCount = [...recipes.values()].filter(Boolean).length;
    g.activeSources = [...sources].sort((a, b) => a.localeCompare(b, "nl"));
    // Actieve recepten bovenaan binnen de groep.
    g.items.sort(
      (a, b) =>
        Number(b.active_sources.length > 0) - Number(a.active_sources.length > 0) ||
        a.recipe_name.localeCompare(b.recipe_name, "nl"),
    );
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(b.activeCount > 0) - Number(a.activeCount > 0) ||
      b.activeCount - a.activeCount ||
      b.recipeCount - a.recipeCount ||
      a.name.localeCompare(b.name, "nl"),
  );
}

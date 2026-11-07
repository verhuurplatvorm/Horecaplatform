/**
 * Houdbaarheidsregels voor zelf bereide producten (halfproducten), op basis
 * van de Hygiënecode voor de Horeca. De keuze wordt per halfproduct
 * onthouden in recipes.shelf_life_rule.
 *
 * Let op: op 9 november 2026 verschijnt een nieuwe Hygiënecode Horeca
 * (verplicht vanaf 1 april 2027). Termijnen hierna controleren.
 */

export type ShelfLifeRuleKey =
  "gekoeld_2d" | "zelfde_dag" | "ingevroren_3m" | "eigen" | "handmatig";

export interface ShelfLifeRule {
  key: ShelfLifeRuleKey;
  label: string;
  /** Vaste termijn in dagen na de productiedatum (dag van bereiding = 0). */
  days?: number;
  /** Vaste termijn in maanden na de productiedatum. */
  months?: number;
}

export const SHELF_LIFE_RULES: ShelfLifeRule[] = [
  {
    key: "gekoeld_2d",
    label: "Zelf bereid, gekoeld ≤ 7 °C — dag van bereiding + 2 dagen",
    days: 2,
  },
  { key: "zelfde_dag", label: "Alleen dag van bereiding", days: 0 },
  {
    key: "ingevroren_3m",
    label: "Zelf ingevroren (−18 °C) — max. 3 maanden",
    months: 3,
  },
  { key: "eigen", label: "Eigen termijn (aantal dagen)" },
  { key: "handmatig", label: "Datum per sticker zelf invullen" },
];

export function findShelfLifeRule(
  key: string | null | undefined,
): ShelfLifeRule | null {
  return SHELF_LIFE_RULES.find((r) => r.key === key) ?? null;
}

/** Huidige regel van een halfproduct (val terug op 'eigen' als alleen dagen bekend zijn). */
export function currentShelfLifeRule(
  rule: string | null | undefined,
  shelfLifeDays: number | null | undefined,
): ShelfLifeRuleKey | "" {
  const found = findShelfLifeRule(rule);
  if (found) {
    // Dagen later in het receptformulier aangepast? Dan geldt de eigen termijn.
    if (
      found.days !== undefined &&
      shelfLifeDays != null &&
      shelfLifeDays !== found.days
    ) {
      return "eigen";
    }
    return found.key;
  }
  return shelfLifeDays != null ? "eigen" : "";
}

/** "Te gebruiken tot"-datum (yyyy-mm-dd, exclusief) uit productiedatum + regel; leeg als niet te berekenen. */
export function computeExpiryDate(
  productionAt: string,
  ruleKey: ShelfLifeRuleKey | "",
  shelfLifeDays: number | null | undefined,
): string {
  if (!productionAt || !ruleKey || ruleKey === "handmatig") return "";
  const base = new Date(productionAt);
  if (Number.isNaN(base.getTime())) return "";
  const rule = findShelfLifeRule(ruleKey);
  if (rule?.months) {
    base.setMonth(base.getMonth() + rule.months);
  } else {
    const days = rule?.days ?? shelfLifeDays;
    if (days == null) return "";
    // "Te gebruiken tot" (niet "tot en met"): de dag ná de laatste
    // gebruiksdag. Bereid op 7-11 met +2 dagen → te gebruiken tot 10-11.
    base.setDate(base.getDate() + days + 1);
  }
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

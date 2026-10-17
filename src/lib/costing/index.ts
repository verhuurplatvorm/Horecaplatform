import {
  convertQuantity,
  effectiveLossPct,
  type UnitBridge,
  type UnitLike,
} from "@/lib/units/convert";

/**
 * Centrale kostprijsregels voor één receptregel en voor het recepttotaal.
 * Eén plek, met tests; het receptformulier gebruikt precies deze functies.
 * (De database blijft de bron van waarheid voor opgeslagen kostprijzen en
 * rekent met dezelfde regels in SQL.)
 */

export interface IngredientPriceInfo extends UnitBridge {
  pricePerBaseUnit: number;
  defaultLossPct: number | null;
}

/** Kosten van één ingrediëntregel: hoeveelheid → basiseenheid (netto bruikbaar) × prijs × (1 + verlies%). */
export function ingredientLineCost(args: {
  quantity: number;
  unit: UnitLike | undefined;
  baseUnit: UnitLike | null | undefined;
  info: IngredientPriceInfo;
  unitsById: Map<string, UnitLike>;
  /** Verlies% dat op de regel zelf is ingevuld (null = niet ingevuld). */
  lineLossPct: number | null;
}): number | null {
  const { quantity, unit, baseUnit, info, unitsById, lineLossPct } = args;
  if (!unit || !baseUnit) return null;
  const qtyInBase = convertQuantity(quantity, unit, baseUnit, info, unitsById, true);
  if (qtyInBase === null) return null;
  const lossPct = effectiveLossPct(lineLossPct, info, info.defaultLossPct);
  return qtyInBase * info.pricePerBaseUnit * (1 + lossPct / 100);
}

/** Kosten van een halfproductregel: aandeel van de opbrengst × totale kostprijs van het halfproduct. */
export function halfproductLineCost(args: {
  quantity: number;
  unit: UnitLike | undefined;
  baseUnit: UnitLike | null | undefined;
  yieldQuantity: number | null | undefined;
  totalCost: number;
  unitsById: Map<string, UnitLike>;
}): number | null {
  const { quantity, unit, baseUnit, yieldQuantity, totalCost, unitsById } = args;
  if (!yieldQuantity || !unit || !baseUnit) return null;
  const qtyInBase = convertQuantity(quantity, unit, baseUnit, null, unitsById);
  if (qtyInBase === null) return null;
  return (qtyInBase / yieldQuantity) * totalCost;
}

/** Recepttotaal: regels + afval% + marge-vrije kosten, en kostprijs per basiseenheid van de opbrengst. */
export function recipeTotals(args: {
  ingredientCost: number;
  halfproductCost: number;
  wastePct: number;
  marginFreeCosts: number;
  yieldQuantity: number;
  isHalfproduct: boolean;
}) {
  const lines = args.ingredientCost + args.halfproductCost;
  const wasteAmount = lines * (args.wastePct / 100);
  const costBeforeMarginFree = lines + wasteAmount;
  const totalCost = costBeforeMarginFree + args.marginFreeCosts;
  const costPerBaseUnit =
    args.isHalfproduct && args.yieldQuantity > 0 ? totalCost / args.yieldQuantity : null;
  return { lines, wasteAmount, costBeforeMarginFree, totalCost, costPerBaseUnit };
}

/** Foodcost% en marge uit kostprijs en verkoopprijs excl. btw. */
export function foodcostAndMargin(cost: number, salesPriceExVat: number) {
  if (!(salesPriceExVat > 0)) return { foodcostPct: null, margin: null };
  return { foodcostPct: (cost / salesPriceExVat) * 100, margin: salesPriceExVat - cost };
}

/**
 * "In de buurt": gewicht en inhoud onderling gelijkstellen (1 g ≈ 1 ml),
 * alleen voor het optellen van een beginhoeveelheid/opbrengst. NIET voor
 * kostprijzen van ingrediënten. null = geen gewicht/inhoud-eenheid.
 */
export function approximateMeasure(quantity: number, from: UnitLike, to: UnitLike): number | null {
  const isMeasure = (u: UnitLike) => u.dimension === "gewicht" || u.dimension === "inhoud";
  if (!Number.isFinite(quantity) || !isMeasure(from) || !isMeasure(to) || !to.factor_to_base) return null;
  return (quantity * from.factor_to_base) / to.factor_to_base;
}

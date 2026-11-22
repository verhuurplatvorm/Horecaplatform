import { isUnitKey, measureDimension, pricesFromCount, type KeyBridge, type UnitKey } from "./core";

/**
 * Prijsweergave in de ingrediëntenlijst: de prijs per basiseenheid plus de
 * prijzen die bij dit product horen. Zelfde regels als pricesFromCount:
 *
 *  - stuks (18 × 260 g brood): prijs per stuk; per kg (en g) alleen bij een
 *    geldig gewicht per stuk, per liter alleen bij een geldige inhoud per stuk;
 *  - gewicht (g/kg): per g en per kg — nooit per liter;
 *  - inhoud (ml/l): per ml en per liter — nooit per kg;
 *  - per stuk naast gewicht/inhoud alleen als "1 stuk = X" bekend is.
 *
 * De inkoopverpakking zelf (18 stuks) blijft ongewijzigd: dit is alleen weergave.
 */
export interface UnitPriceLine {
  label: string;
  value: number;
  /** Aantal decimalen voor weergave. */
  digits: number;
}

export function unitPriceLines(args: {
  pricePerBase: number | null;
  baseUnit: string;
  bridgeQuantity?: number | null;
  bridgeUnit?: string | null;
  netQuantity?: number | null;
}): { primary: UnitPriceLine | null; extra: UnitPriceLine[] } {
  const { pricePerBase, baseUnit } = args;
  if (pricePerBase === null || !Number.isFinite(pricePerBase) || !isUnitKey(baseUnit)) {
    return { primary: null, extra: [] };
  }
  const bridge: KeyBridge | null =
    args.bridgeQuantity && args.bridgeQuantity > 0 && isUnitKey(args.bridgeUnit) && args.bridgeUnit !== "stuk"
      ? { quantity: args.bridgeQuantity, unit: args.bridgeUnit as UnitKey, netQuantity: args.netQuantity ?? null }
      : null;
  // pricesFromCount(prijs per basiseenheid, 1) = prijzen per eenheid.
  const p = pricesFromCount(pricePerBase, 1, baseUnit, bridge);
  const primary: UnitPriceLine = { label: baseUnit, value: pricePerBase, digits: 4 };
  const extra: UnitPriceLine[] = [];
  const measure = measureDimension(baseUnit, bridge);
  if (baseUnit !== "stuk" && p.perPiece !== null) extra.push({ label: "stuk", value: p.perPiece, digits: 4 });
  if (measure === "gewicht") {
    if (baseUnit !== "g" && p.perGram !== null) extra.push({ label: "g", value: p.perGram, digits: 4 });
    if (baseUnit !== "kg" && p.perKg !== null) extra.push({ label: "kg", value: p.perKg, digits: 2 });
  }
  if (measure === "inhoud" && baseUnit !== "l" && p.perLiter !== null) {
    extra.push({ label: "l", value: p.perLiter, digits: 2 });
  }
  return { primary, extra };
}

export function formatUnitPrice(line: UnitPriceLine): string {
  return `€ ${line.value.toLocaleString("nl-NL", { minimumFractionDigits: line.digits, maximumFractionDigits: line.digits })} / ${line.label}`;
}

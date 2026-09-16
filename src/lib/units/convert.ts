import type { Unit } from "@/lib/types/database";

/** Minimale eenheid-vorm die de conversie nodig heeft (Unit voldoet hieraan). */
export type UnitLike = Pick<Unit, "id" | "dimension" | "factor_to_base">;

/**
 * De brug tussen "stuk" en gewicht/inhoud van een product:
 * "1 stuk = avgUnitQuantity [avgUnit]" (bv. 1 stuk = 95 gram).
 * Beide velden leeg = geen brug bekend.
 */
export interface UnitBridge {
  avgUnitQuantity: number | null | undefined;
  avgUnitId: string | null | undefined;
}

/**
 * Eén centrale conversieregel voor het hele platform. Rekent een
 * hoeveelheid om van eenheid `from` naar eenheid `to`:
 *
 * 1. Zelfde dimensie (gram → kg, ml → liter): factor_from / factor_to.
 * 2. Aantal ↔ gewicht/inhoud: alleen via de brug van het product
 *    ("1 stuk = X [eenheid]"), in beide richtingen.
 * 3. Anders (geen brug ingesteld, of gewicht ↔ inhoud): `null`.
 *
 * `null` betekent bewust "kan niet" — nooit 0 of 1 teruggeven, want
 * dat zou een fout stilzwijgend in een berekening laten verdwijnen.
 *
 * Dit is de TS-tegenhanger van de SQL-functie public.convert_quantity;
 * beide moeten identiek blijven.
 */
export function convertQuantity(
  quantity: number,
  from: UnitLike,
  to: UnitLike,
  bridge: UnitBridge | null | undefined,
  unitsById: Map<string, UnitLike>
): number | null {
  if (!Number.isFinite(quantity)) return null;
  if (from.id === to.id) return quantity;

  if (from.dimension === to.dimension) {
    if (!to.factor_to_base) return null;
    return (quantity * from.factor_to_base) / to.factor_to_base;
  }

  // Alleen aantal ↔ gewicht/inhoud is overbrugbaar; gewicht ↔ inhoud niet.
  const fromIsCount = from.dimension === "aantal";
  const toIsCount = to.dimension === "aantal";
  if (fromIsCount === toIsCount) return null;

  if (!bridge?.avgUnitQuantity || !bridge.avgUnitId) return null;
  const avgUnit = unitsById.get(bridge.avgUnitId);
  if (!avgUnit || avgUnit.dimension === "aantal") return null;

  if (fromIsCount) {
    // stuks → gewicht/inhoud: eerst naar avg-eenheid, dan naar doel.
    if (avgUnit.dimension !== to.dimension || !to.factor_to_base) return null;
    const inAvgUnit = quantity * bridge.avgUnitQuantity;
    return (inAvgUnit * avgUnit.factor_to_base) / to.factor_to_base;
  }

  // gewicht/inhoud → stuks: eerst naar avg-eenheid, dan delen door 1 stuk.
  if (avgUnit.dimension !== from.dimension || !avgUnit.factor_to_base) return null;
  const inAvgUnit = (quantity * from.factor_to_base) / avgUnit.factor_to_base;
  return inAvgUnit / bridge.avgUnitQuantity;
}

/** Gemak: is er überhaupt een conversie mogelijk tussen deze twee eenheden? */
export function canConvert(
  from: UnitLike,
  to: UnitLike,
  bridge: UnitBridge | null | undefined,
  unitsById: Map<string, UnitLike>
): boolean {
  return convertQuantity(1, from, to, bridge, unitsById) !== null;
}

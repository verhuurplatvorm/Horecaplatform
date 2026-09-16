import type { Unit } from "@/lib/types/database";

/** Minimale eenheid-vorm die de conversie nodig heeft (Unit voldoet hieraan). */
export type UnitLike = Pick<Unit, "id" | "dimension" | "factor_to_base">;

/**
 * De brug tussen "stuk" en gewicht/inhoud van een product:
 * "1 stuk = avgUnitQuantity [avgUnit]" (bv. 1 stuk = 95 gram).
 * Beide velden leeg = geen brug bekend.
 */
export interface UnitBridge {
  /** BRUTO per stuk (1 avocado = 180 gram) — voor hoeveelheden. */
  avgUnitQuantity: number | null | undefined;
  avgUnitId: string | null | undefined;
  /** NETTO bruikbaar per stuk (1 avocado = 130 gram) — kostprijsbasis. Leeg = gelijk aan bruto. */
  netUnitQuantity?: number | null | undefined;
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
  unitsById: Map<string, UnitLike>,
  /**
   * true = rekenen met netto bruikbaar (kostprijs), false = bruto
   * (hoeveelheden). Zie migratie 0060 voor de onderbouwing.
   */
  forCost = false
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

  // Kostprijs rekent met netto bruikbaar; hoeveelheden met bruto.
  const bridgeQty = forCost
    ? bridge.netUnitQuantity ?? bridge.avgUnitQuantity
    : bridge.avgUnitQuantity;
  if (!bridgeQty || bridgeQty <= 0) return null;

  if (fromIsCount) {
    // stuks → gewicht/inhoud: eerst naar avg-eenheid, dan naar doel.
    if (avgUnit.dimension !== to.dimension || !to.factor_to_base) return null;
    return (quantity * bridgeQty * avgUnit.factor_to_base) / to.factor_to_base;
  }

  // gewicht/inhoud → stuks: eerst naar avg-eenheid, dan delen door 1 stuk.
  if (avgUnit.dimension !== from.dimension || !avgUnit.factor_to_base) return null;
  const inAvgUnit = (quantity * from.factor_to_base) / avgUnit.factor_to_base;
  return inAvgUnit / bridgeQty;
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

/**
 * Verliespercentage voor een receptregel — spiegelt
 * public.product_effective_loss_pct. Een expliciet percentage op de regel
 * wint altijd; anders vervalt het standaardverlies van het product zodra
 * er een netto bruikbaar is ingesteld (dat verlies zit daar al in).
 */
export function effectiveLossPct(
  lineLossPct: number | null | undefined,
  bridge: UnitBridge | null | undefined,
  productDefaultLossPct: number | null | undefined
): number {
  if (lineLossPct !== null && lineLossPct !== undefined && Number.isFinite(lineLossPct)) {
    return lineLossPct;
  }
  if (bridge?.netUnitQuantity) return 0;
  return productDefaultLossPct ?? 0;
}

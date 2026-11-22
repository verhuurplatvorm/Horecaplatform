/**
 * Verkoop van een menu/buffet/arrangement.
 *
 * - Basisprijs p.p. × max(gasten, minimum personen) — "Prijs t/m 25 personen:
 *   937,50" is 25 × 37,50.
 * - Gekozen opties (onderdelen met eigen prijs p.p.) × gasten.
 * - Toeslagen (drankenarrangement, kok bij de BBQ, tv-scherm) tellen mee in
 *   de omzet, niet in de foodcost.
 *
 * Alle prijzen zijn incl. btw; excl. btw rekent met het tarief van het menu
 * (eten) of van de toeslag.
 */

export interface ChargeTier {
  tot: number | null;
  bedrag: number;
}

export interface MenuCharge {
  id?: string;
  name: string;
  kind: "per_persoon" | "vast" | "staffel";
  amount: number;
  tiers: ChargeTier[];
  vat_rate: number;
  is_selected: boolean;
}

export interface MenuOption {
  name: string;
  option_price_pp: number | null;
  is_selected: boolean;
}

export interface SalesInput {
  personCount: number;
  minPersons: number | null;
  pricePerPerson: number | null;
  vatRate: number;
  sections: MenuOption[];
  charges: MenuCharge[];
}

const excl = (incl: number, vat: number) => incl / (1 + (vat || 0) / 100);

/** Bedrag van een staffel bij dit aantal gasten (eerste "tot" die past; null = rest). */
export function tierAmount(tiers: ChargeTier[], persons: number): number {
  const sorted = [...tiers].sort((a, b) => (a.tot ?? Infinity) - (b.tot ?? Infinity));
  const hit = sorted.find((t) => t.tot === null || persons <= t.tot);
  return hit ? Number(hit.bedrag) : 0;
}

export function chargeAmount(c: MenuCharge, persons: number): number {
  if (!c.is_selected) return 0;
  if (c.kind === "per_persoon") return Number(c.amount) * persons;
  if (c.kind === "vast") return Number(c.amount);
  return tierAmount(c.tiers ?? [], persons);
}

export function menuSales(i: SalesInput) {
  const guests = Math.max(0, i.personCount || 0);
  const billedPersons = Math.max(guests, i.minPersons ?? 0);
  const baseIncl = (i.pricePerPerson ?? 0) * billedPersons;
  const options = i.sections
    .filter((s) => s.option_price_pp !== null && s.option_price_pp !== undefined)
    .map((s) => ({
      name: s.name,
      selected: s.is_selected,
      incl: s.is_selected ? Number(s.option_price_pp) * guests : 0,
    }));
  const optionsIncl = options.reduce((t, o) => t + o.incl, 0);
  const foodIncl = baseIncl + optionsIncl;
  const foodExcl = excl(foodIncl, i.vatRate);
  const charges = i.charges.map((c) => {
    const incl = chargeAmount(c, guests);
    return { name: c.name, selected: c.is_selected, incl, excl: excl(incl, c.vat_rate) };
  });
  const chargesIncl = charges.reduce((t, c) => t + c.incl, 0);
  const chargesExcl = charges.reduce((t, c) => t + c.excl, 0);
  return {
    guests,
    billedPersons,
    minimumApplies: billedPersons > guests,
    baseIncl,
    options,
    optionsIncl,
    foodIncl,
    foodExcl,
    /** Eten p.p. excl. btw over de echte gasten (voor foodcost p.p.). */
    foodExclPerGuest: guests > 0 ? foodExcl / guests : null,
    charges,
    chargesIncl,
    chargesExcl,
    totalIncl: foodIncl + chargesIncl,
    totalExcl: foodExcl + chargesExcl,
    hasSales: foodIncl > 0,
  };
}

/** Foodcost % op de eten-omzet (basis + opties), excl. btw. */
export function foodcostPct(totalCost: number | null, foodExcl: number): number | null {
  if (totalCost === null || !(foodExcl > 0)) return null;
  return (totalCost / foodExcl) * 100;
}

// Rekenregels voor Gerechten voor Partijen.
// Dezelfde regels als de database-functie public.event_line_plan (migratie
// 0122); deze versie wordt alleen gebruikt voor directe voorbeelden in
// schermen (receptformulier, overzicht). Menu's, werklijst en bestellijst
// rekenen altijd via de database.

export const PARTY_CONTAINERS = [
  { key: "schaal", label: "Schaal", plural: "schalen", unit: "g" },
  { key: "bak", label: "Bak", plural: "bakken", unit: "g" },
  {
    key: "gastronormbak",
    label: "Gastronormbak",
    plural: "gastronormbakken",
    unit: "g",
  },
  { key: "plaat", label: "Plaat", plural: "platen", unit: "g" },
  { key: "stuks", label: "Stuks", plural: "stuks", unit: "stuk" },
  { key: "porties", label: "Porties", plural: "porties", unit: "stuk" },
  { key: "kilogram", label: "Kilogram", plural: "kilo", unit: "g" },
  { key: "liter", label: "Liter / pan", plural: "pannen", unit: "ml" },
] as const;

export type PartyContainerKey = (typeof PARTY_CONTAINERS)[number]["key"];

export const PORTION_PRESETS = [40, 50, 60, 70, 80] as const;

export function containerInfo(key: string | null | undefined) {
  return PARTY_CONTAINERS.find((c) => c.key === key) ?? PARTY_CONTAINERS[0];
}

export function containerLabel(
  key: string | null | undefined,
  count: number,
): string {
  const c = containerInfo(key);
  return count === 1 ? c.label.toLowerCase() : c.plural;
}

export type PartyPlan = {
  needed: number;
  containersExact: number;
  containers: number;
  fullContainers: boolean;
  produced: number;
  lastContainer: number;
  difference: number;
  recipeFactor: number;
  /** Bijv. [1200, 1200, 1200, 600] */
  distribution: number[];
};

/**
 * benodigd = portie p.p. × gasten × deelname% / 100
 * vormen   = naar boven afgerond(benodigd / capaciteit)
 * A volle vormen: geproduceerd = vormen × capaciteit, recept × vormen
 * B laatste aanpassen: geproduceerd = benodigd, recept × (benodigd / capaciteit)
 */
export function planParty(opts: {
  guests: number;
  portion: number;
  capacity: number;
  participationPct?: number;
  fullContainers?: boolean;
}): PartyPlan | null {
  const { guests, portion, capacity } = opts;
  const pct = opts.participationPct ?? 100;
  const full = opts.fullContainers ?? true;
  if (!(capacity > 0) || !(portion >= 0) || !(guests >= 0)) return null;
  const needed = (portion * guests * pct) / 100;
  const containersExact = needed / capacity;
  const containers = Math.ceil(Math.round(containersExact * 1e6) / 1e6);
  if (containers === 0) {
    return {
      needed,
      containersExact: 0,
      containers: 0,
      fullContainers: full,
      produced: 0,
      lastContainer: 0,
      difference: 0,
      recipeFactor: 0,
      distribution: [],
    };
  }
  const lastContainer = full ? capacity : needed - (containers - 1) * capacity;
  const produced = full ? containers * capacity : needed;
  const distribution = Array.from({ length: containers }, (_, i) =>
    i === containers - 1 ? lastContainer : capacity,
  );
  return {
    needed,
    containersExact,
    containers,
    fullContainers: full,
    produced,
    lastContainer,
    difference: produced - needed,
    recipeFactor: full ? containers : containersExact,
    distribution,
  };
}

/** "3 × 1.200 g + 1 × 600 g" */
export function formatDistribution(
  distribution: number[],
  unit: string,
): string {
  if (distribution.length === 0) return "—";
  const groups: { value: number; count: number }[] = [];
  for (const v of distribution) {
    const r = Math.round(v * 10) / 10;
    const last = groups[groups.length - 1];
    if (last && last.value === r) last.count += 1;
    else groups.push({ value: r, count: 1 });
  }
  return groups
    .map((g) => `${g.count} × ${g.value.toLocaleString("nl-NL")} ${unit}`)
    .join(" + ");
}

/** Hoeveel personen één vorm bedient bij de standaardportie. */
export function personsPerContainer(
  capacity: number,
  portion: number,
): number | null {
  if (!(capacity > 0) || !(portion > 0)) return null;
  return capacity / portion;
}

/**
 * Automatische indeling in grammen per persoon voor een buffet/menu.
 * Elke regel krijgt een gewicht op basis van wat het is (brood, koude
 * schaal, warm vlees/vis, garnituur, saus, dessert, ijs…), daarna wordt
 * alles geschaald naar het totaal (standaard 700 g p.p.) en afgerond op 5 g.
 * Bedoeld als startpunt — daarna fine-tunen.
 */

export const DEFAULT_TARGET_GRAMS = 700;

// Volgorde = voorrang: "Frites met Zaanse mayonaise" is frites, geen saus.
const RULES: [RegExp, number][] = [
  [/slagroom|\broom\b/, 10],
  [/\bijs\b|roomijs|sorbet|bolletje/, 25],
  [
    /shot|mousse|schuim|bavaroise|taart|cheesecake|tiramisu|brownie|panna|bonbon|petit/,
    40,
  ],
  [/fruit/, 40],
  [/brood|focaccia|ciabatta|bruschetta|baguette/, 50],
  [/frites|friet|aardappel|krieltjes|puree|gratin/, 90],
  [
    /filet|\bvis\b|zeewolf|kabeljauw|zeebaars|tarbot|haas|sukade|stroganoff|\bkip|varken|rund|\blam\b|lams|eend|hert|wild|sat[eé]|spareribs|stoofvlees|biefstuk|entrecote|ossobuco|burger/,
    110,
  ],
  [/groente|stoof|peer|rijst|couscous|risotto|pasta|curry|noodle|polenta/, 60],
  [
    /carpaccio|vitello|tonijn|zalm|ribeye|rosbief|\bham\b|paling|makreel|haring|garnalen|gamba|terrine|pat[eé]|tartaar/,
    40,
  ],
  [/salade|slaw|rauwkost/, 45],
  [/saus|mayo|jus\b|dressing|\bdip|smeersel|boter|aioli|tapenade/, 20],
];

export function weightFor(name: string, section?: string | null): number {
  const t = ` ${name.toLowerCase()} `;
  const sec = (section ?? "").toLowerCase();
  for (const [re, w] of RULES) if (re.test(t)) return w;
  if (/dessert|zoet|nagerecht/.test(sec)) return 35;
  if (/warm|hoofd/.test(sec)) return 80;
  if (/koud|voor/.test(sec)) return 40;
  return 40;
}

/** Vega-/dieetregels en vaste regels doen niet mee in de verdeling. */
export function excludedFromDistribution(
  section: string | null | undefined,
  isFixed: boolean,
): boolean {
  return isFixed || /vega|dieet|allergie|kinder/i.test(section ?? "");
}

/**
 * Verdeelt het totaal over de regels (in dezelfde volgorde terug).
 * Uitgesloten regels krijgen null.
 */
export function distributeGrams(
  items: { name: string; section?: string | null; isFixed?: boolean }[],
  target = DEFAULT_TARGET_GRAMS,
): (number | null)[] {
  const weights = items.map((it) =>
    excludedFromDistribution(it.section, Boolean(it.isFixed))
      ? null
      : weightFor(it.name, it.section),
  );
  const sum = weights.reduce<number>((s, w) => s + (w ?? 0), 0);
  if (sum <= 0) return weights.map(() => null);
  const raw = weights.map((w) => (w == null ? null : (w / sum) * target));
  const rounded = raw.map((r) =>
    r == null ? null : Math.max(5, Math.round(r / 5) * 5),
  );
  // Afrondingsverschil bij de grootste regel verrekenen, zodat het totaal klopt.
  const diff = target - rounded.reduce<number>((s, r) => s + (r ?? 0), 0);
  if (diff !== 0) {
    let idx = -1;
    rounded.forEach((r, i) => {
      if (r != null && (idx < 0 || r > (rounded[idx] ?? 0))) idx = i;
    });
    if (idx >= 0) rounded[idx] = Math.max(5, (rounded[idx] ?? 0) + diff);
  }
  return rounded;
}

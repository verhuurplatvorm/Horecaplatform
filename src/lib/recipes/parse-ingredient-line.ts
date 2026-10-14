/**
 * Leest één regel uit het ingrediëntenveld, bv. "2000 ml kookwijn wit".
 *
 * Dit is bewust alleen HERKENNING van tekst: de functie weet niets van de
 * database en koppelt niets. Het resultaat is een voorstel (hoeveelheid,
 * eenheid, naam); of er een bestaand ingrediënt bij hoort wordt apart
 * bepaald door de zoekfunctie. Zo blijven invoer en herkenning gescheiden.
 */

export interface ParsedIngredientLine {
  /** De regel zoals ingetypt (getrimd). */
  raw: string;
  /** Hoeveelheid, of null als er geen getal herkend is. */
  quantity: number | null;
  /** Sleutel van de eenheid in de units-tabel (g, kg, ml, l, stuk, …), of null. */
  unitKey: string | null;
  /** Eenheidstekst die we niet kennen (bv. "tl", "snufje"); dan is unitKey null. */
  unknownUnit: string | null;
  /** Wat overblijft: de ingrediëntnaam waarop gezocht wordt. */
  name: string;
}

const UNIT_ALIASES: Record<string, string> = {
  mg: "mg",
  milligram: "mg",
  g: "g",
  gr: "g",
  gram: "g",
  grammen: "g",
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  ml: "ml",
  milliliter: "ml",
  cl: "cl",
  centiliter: "cl",
  dl: "dl",
  deciliter: "dl",
  l: "l",
  lt: "l",
  ltr: "l",
  liter: "l",
  litre: "l",
  stuk: "stuk",
  stuks: "stuk",
  st: "stuk",
  stk: "stuk",
  x: "stuk",
  pc: "stuk",
  pcs: "stuk",
};

// Eenheden die kooknamen zijn maar (nog) niet in de eenhedentabel staan.
// We herkennen ze wel, zodat ze niet in de ingrediëntnaam terechtkomen;
// de kok kiest de eenheid dan zelf.
const UNKNOWN_UNITS = new Set([
  "tl", "el", "theelepel", "eetlepel", "snuf", "snufje", "takje", "takjes",
  "bos", "bosje", "teen", "tenen", "blik", "blikje", "pak", "pakje", "fles",
  "flesje", "plak", "plakje", "plakken",
]);

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3,
};

/** Getal lezen in Nederlandse of internationale schrijfwijze. */
export function parseQuantityToken(token: string): number | null {
  let t = token.trim();
  if (!t) return null;
  if (t in UNICODE_FRACTIONS) return UNICODE_FRACTIONS[t];
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) {
    const d = Number(frac[2]);
    return d > 0 ? Number(frac[1]) / d : null;
  }
  // "10.000" of "1.250.000" = duizendtallen (3 cijfers na elke punt),
  // "0.250" en "1.5" zijn decimalen.
  if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  else if (/^\d+,\d+$/.test(t)) t = t.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`(?:\d+\/\d+|\d+(?:[.,]\d+)*|[½¼¾⅓⅔])`;

function cleanName(s: string): string {
  return s.replace(/^[\s\-–—•*·:,;]+|[\s,;:]+$/g, "").replace(/\s+/g, " ");
}

export function parseIngredientLine(input: string): ParsedIngredientLine {
  const raw = input.trim();
  const base: ParsedIngredientLine = {
    raw,
    quantity: null,
    unitKey: null,
    unknownUnit: null,
    name: cleanName(raw),
  };
  // Opsommingstekens vooraan weghalen.
  const text = raw.replace(/^[\s\-–—•*·]+/, "");
  if (!text) return { ...base, name: "" };

  // 1. Getal vooraan: "2000 ml kookwijn", "2000ml kookwijn", "2x citroen",
  //    "25 gram zout", "3 eieren".
  const lead = new RegExp(`^(${NUM})\\s*([A-Za-zµ]+)?\\.?\\s*(.*)$`).exec(text);
  if (lead) {
    const quantity = parseQuantityToken(lead[1]);
    if (quantity !== null) {
      const word = (lead[2] ?? "").toLowerCase();
      const rest = lead[3] ?? "";
      if (word && UNIT_ALIASES[word]) {
        // "2x" mag, "x" als zelfstandig woord vooraan niet nodig.
        return { ...base, quantity, unitKey: UNIT_ALIASES[word], name: cleanName(rest) };
      }
      if (word && UNKNOWN_UNITS.has(word)) {
        return { ...base, quantity, unknownUnit: word, name: cleanName(rest) };
      }
      // Geen eenheid: "3 eieren" = 3 stuks "eieren". Het woord hoort bij de naam.
      const name = cleanName(`${lead[2] ?? ""}${lead[2] && rest ? " " : ""}${rest}`);
      return { ...base, quantity, unitKey: "stuk", name };
    }
  }

  // 2. Getal achteraan: "zout 25 gram", "citroen 2 stuks", "zout, 25 g".
  const trail = new RegExp(`^(.*?)[\\s,;:–-]+(${NUM})\\s*([A-Za-zµ]+)?\\.?$`).exec(text);
  if (trail) {
    const quantity = parseQuantityToken(trail[2]);
    const word = (trail[3] ?? "").toLowerCase();
    if (quantity !== null && trail[1].trim()) {
      if (!word) return { ...base, quantity, unitKey: "stuk", name: cleanName(trail[1]) };
      if (UNIT_ALIASES[word]) return { ...base, quantity, unitKey: UNIT_ALIASES[word], name: cleanName(trail[1]) };
      if (UNKNOWN_UNITS.has(word)) return { ...base, quantity, unknownUnit: word, name: cleanName(trail[1]) };
    }
  }

  // 3. Alleen een naam: geen hoeveelheid herkend.
  return base;
}

/** Meerdere regels (Enter, of vanuit plakken) tegelijk lezen; lege regels vallen weg. */
export function parseIngredientText(text: string): ParsedIngredientLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseIngredientLine);
}

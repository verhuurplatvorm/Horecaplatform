/**
 * Herkent veelvoorkomende verpakkingsnotaties uit een vrij tekstveld en
 * berekent de totale hoeveelheid (spec §5). Voorbeelden die herkend
 * worden: "6 x 1 liter", "12 × 750 ml", "doos 20 stuks", "zak 5 kg",
 * "1,5 kilogram", "500 gram", "10 stuks".
 *
 * Geeft altijd een controleerbare uitleg terug, zodat de UI kan tonen
 * *hoe* het systeem tot de hoeveelheid kwam.
 */

export interface ParsedArticleLine {
  name: string;
  packagingText: string | null;
  articleCode: string | null;
}

/**
 * Ontleedt één samengestelde artikelregel zoals leveranciers die vaak in
 * één kolom zetten, bijvoorbeeld:
 *
 *   "CREME FRAICHE 30% 1x1ltr #25072#"
 *   → naam: "Creme fraiche 30%", verpakking: "1x1ltr", code: "25072"
 *
 * Haalt achtereenvolgens een artikelcode tussen #-tekens, en een
 * verpakkingsnotatie (herkend door parsePackagingText) uit de tekst, en
 * behandelt de rest als productnaam.
 */
export function parseCombinedArticleLine(text: string): ParsedArticleLine {
  let remainder = text.trim();
  let articleCode: string | null = null;

  const codeMatch = remainder.match(/#\s*([a-z0-9.\-]+)\s*#/i);
  if (codeMatch) {
    articleCode = codeMatch[1];
    remainder = (remainder.slice(0, codeMatch.index) + remainder.slice(codeMatch.index! + codeMatch[0].length)).trim();
  }

  let packagingText: string | null = null;
  const packagingMatch = remainder.match(
    /\d+[.,]?\d*\s*[x×]\s*\d+[.,]?\d*\s*(?:l|liter|ltr|ml|milliliter|cl|centiliter|kg|kilogram|kilo|g|gram|gr|stuk|stuks|st|fles|flessen)\b/i
  );
  if (packagingMatch) {
    packagingText = packagingMatch[0].trim();
    remainder =
      (remainder.slice(0, packagingMatch.index) +
        remainder.slice(packagingMatch.index! + packagingMatch[0].length)).trim();
  }

  const name = remainder.replace(/\s{2,}/g, " ").replace(/[-,]+$/, "").trim();

  return { name: name || text.trim(), packagingText, articleCode };
}

export interface ParsedPackaging {
  totalQuantity: number;
  unit: string;
  explanation: string;
}

const UNIT_ALIASES: Record<string, string> = {
  l: "l",
  liter: "l",
  ltr: "l",
  ml: "ml",
  milliliter: "ml",
  cl: "cl",
  centiliter: "cl",
  kg: "kg",
  kilogram: "kg",
  kilo: "kg",
  g: "g",
  gram: "g",
  gr: "g",
  stuk: "stuk",
  stuks: "stuk",
  st: "stuk",
  fles: "stuk",
  flessen: "stuk",
};

function normalizeNumber(raw: string): number {
  const cleaned = raw.trim();
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    normalized = cleaned.replace(/,/g, "");
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export function parsePackagingText(text: string): ParsedPackaging | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  const multiPack = t.match(
    /(\d+[.,]?\d*)\s*[x×]\s*(\d+[.,]?\d*)\s*(l|liter|ltr|ml|milliliter|cl|centiliter|kg|kilogram|kilo|g|gram|gr|stuk|stuks|st|fles|flessen)\b/
  );
  if (multiPack) {
    const count = normalizeNumber(multiPack[1]);
    const perUnit = normalizeNumber(multiPack[2]);
    const unit = UNIT_ALIASES[multiPack[3]] ?? multiPack[3];
    if (Number.isFinite(count) && Number.isFinite(perUnit)) {
      const total = count * perUnit;
      return {
        totalQuantity: total,
        unit,
        explanation: `${count} × ${perUnit} ${unit} = ${total} ${unit}`,
      };
    }
  }

  const containerPack = t.match(
    /(?:doos|zak|krat|blik|pak|box|bag)\s*(?:van\s*)?(\d+[.,]?\d*)\s*(l|liter|ltr|ml|milliliter|cl|centiliter|kg|kilogram|kilo|g|gram|gr|stuk|stuks|st|fles|flessen)\b/
  );
  if (containerPack) {
    const count = normalizeNumber(containerPack[1]);
    const unit = UNIT_ALIASES[containerPack[2]] ?? containerPack[2];
    if (Number.isFinite(count)) {
      return { totalQuantity: count, unit, explanation: `${count} ${unit}` };
    }
  }

  const single = t.match(
    /(\d+[.,]?\d*)\s*(l|liter|ltr|ml|milliliter|cl|centiliter|kg|kilogram|kilo|g|gram|gr|stuk|stuks|st|fles|flessen)\b/
  );
  if (single) {
    const count = normalizeNumber(single[1]);
    const unit = UNIT_ALIASES[single[2]] ?? single[2];
    if (Number.isFinite(count)) {
      return { totalQuantity: count, unit, explanation: `${count} ${unit}` };
    }
  }

  return null;
}

/** Omrekenfactor van herkende eenheid naar de basiseenheid-sleutel
 * (matcht met units.key in de database). */
export const UNIT_TO_BASE_FACTOR: Record<string, { baseUnitKey: string; factor: number }> = {
  l: { baseUnitKey: "ml", factor: 1000 },
  cl: { baseUnitKey: "ml", factor: 10 },
  ml: { baseUnitKey: "ml", factor: 1 },
  kg: { baseUnitKey: "g", factor: 1000 },
  g: { baseUnitKey: "g", factor: 1 },
  stuk: { baseUnitKey: "stuk", factor: 1 },
};

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
  /** Alle gevonden codes, voor regels met meerdere kruisverwijzingen
   * (bv. "#3057# #22736# #66423#"). articleCode is de eerste. */
  allArticleCodes: string[];
}

/**
 * Ontleedt één samengestelde artikelregel zoals leveranciers die vaak in
 * één kolom zetten, bijvoorbeeld:
 *
 *   "CREME FRAICHE 30% 1x1ltr #25072#"
 *   → naam: "Creme fraiche 30%", verpakking: "1x1ltr", code: "25072"
 *
 * Haalt achtereenvolgens alle artikelcodes tussen #-tekens, en een
 * verpakkingsnotatie uit de tekst, en behandelt de rest als productnaam.
 */
export function parseCombinedArticleLine(text: string): ParsedArticleLine {
  const original = text.trim();
  let remainder = original;

  // Elke "#code" is een aparte code, ook als niet iedere code een eigen
  // sluit-# heeft (leveranciers zijn hierin niet consistent, bv.
  // "#31562 #645 #44597#" of "#71587 #30641"). We matchen daarom alleen
  // op de openings-#, en ruimen eventuele losse resterende #-tekens
  // (zoals de allerlaatste sluit-#) achteraf apart op.
  const codes: string[] = [];
  remainder = remainder.replace(/#([a-z0-9.\-]+)/gi, (_match, code) => {
    codes.push(code);
    return " ";
  });
  remainder = remainder.replace(/#/g, " ");
  const articleCode = codes[0] ?? null;

  const unitAlternation =
    "l|liter|ltr|ml|milliliter|cl|centiliter|kg|kilogram|kilo|g|gram|gr|stuk|stuks|st|fles|flessen";

  let packagingText: string | null = null;
  const multiMatch = remainder.match(
    new RegExp(`\\d+[.,]?\\d*\\s*[x×]\\s*\\d+[.,]?\\d*\\s*(?:${unitAlternation})\\b`, "i")
  );
  const containerMatch = !multiMatch
    ? remainder.match(
        new RegExp(
          `(?:doos|zak|krat|blik|pak|box|bag)\\s*(?:van\\s*)?\\d+[.,]?\\d*\\s*(?:${unitAlternation})\\b`,
          "i"
        )
      )
    : null;
  const singleMatch =
    !multiMatch && !containerMatch
      ? remainder.match(new RegExp(`\\d+[.,]?\\d*\\s*(?:${unitAlternation})\\b`, "i"))
      : null;

  const match = multiMatch ?? containerMatch ?? singleMatch;
  if (match) {
    packagingText = match[0].trim();
    remainder = remainder.slice(0, match.index) + remainder.slice(match.index! + match[0].length);
  }

  const name = remainder.replace(/\s{2,}/g, " ").replace(/[-,]+$/, "").trim();

  return { name: name || original, packagingText, articleCode, allArticleCodes: codes };
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

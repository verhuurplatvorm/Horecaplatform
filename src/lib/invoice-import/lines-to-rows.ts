import type { ParsedInvoiceLine } from "./parse-ubl";
import { parsePackagingText, UNIT_TO_BASE_FACTOR } from "@/lib/price-import/packaging-parser";
import type { ParsedPriceRow } from "@/lib/price-import/columns";

const UN_CEFACT_TO_BASE: Record<string, { baseUnitKey: string; factor: number }> = {
  KGM: { baseUnitKey: "g", factor: 1000 },
  GRM: { baseUnitKey: "g", factor: 1 },
  LTR: { baseUnitKey: "ml", factor: 1000 },
  MLT: { baseUnitKey: "ml", factor: 1 },
  C62: { baseUnitKey: "stuk", factor: 1 },
  EA: { baseUnitKey: "stuk", factor: 1 },
  H87: { baseUnitKey: "stuk", factor: 1 },
};
export function linesToRows(lines: ParsedInvoiceLine[]): ParsedPriceRow[] {
  return lines.map((line) => {
    let packagingUnitCount: number | null = null;
    let packagingUnitKey: string | null = null;
    let matchedPackagingText: string | null = null;

    // Volgorde van betrouwbaarheid: 1) expliciete verpakkingstekst van
    // Claude, 2) verpakking die in de artikelomschrijving zelf verwerkt
    // zit (bv. "MOSSELEN SUPER SELECT 2 KG" → 2 kg). Het AANTAL besteld
    // (bv. "40 stuks") wordt hier bewust NOOIT als verpakkingsgrootte
    // gebruikt — dat is een ander getal met een andere betekenis, en
    // door ze te verwarren ontstaat precies de fout waarbij "40 stuks
    // besteld à €1,25/stuk" verkeerd wordt gelezen als "1 verpakking van
    // 40 stuks voor €1,25", wat de prijs 40x te laag maakt.
    const candidateTexts = [line.packagingDescription, line.description].filter(
      Boolean
    ) as string[];

    for (const text of candidateTexts) {
      const parsed = parsePackagingText(text);
      if (parsed) {
        const baseUnit = UNIT_TO_BASE_FACTOR[parsed.unit];
        packagingUnitCount = parsed.totalQuantity * (baseUnit?.factor ?? 1);
        packagingUnitKey = baseUnit?.baseUnitKey ?? null;
        matchedPackagingText = parsed.explanation;
        break;
      }
    }

    // Geen verpakking gevonden: veiligste aanname is dat de prijs al per
    // losse eenheid is (bv. "€ 1,25 per stuk", "€ 17,50 per kg") — dat is
    // verreweg het meest voorkomende factuurpatroon. "1 {eenheid}" i.p.v.
    // "{aantal} {eenheid}" voorkomt dat het bestelde aantal per ongeluk
    // als verpakkingsgrootte wordt gebruikt.
    if (packagingUnitCount === null && line.unit) {
      const parsedSingle = parsePackagingText(`1 ${line.unit}`);
      if (parsedSingle) {
        const baseUnit = UNIT_TO_BASE_FACTOR[parsedSingle.unit];
        packagingUnitCount = parsedSingle.totalQuantity * (baseUnit?.factor ?? 1);
        packagingUnitKey = baseUnit?.baseUnitKey ?? null;
        matchedPackagingText = `1 ${line.unit}`;
      } else {
        const unCefact = UN_CEFACT_TO_BASE[line.unit.toUpperCase()];
        if (unCefact) {
          packagingUnitCount = unCefact.factor;
          packagingUnitKey = unCefact.baseUnitKey;
          matchedPackagingText = `1 ${line.unit}`;
        }
      }
    }

    if (packagingUnitCount === null) {
      console.warn(
        `[invoice-import] Regel ${line.lineNumber} ("${line.description}"): geen verpakkingshoeveelheid herkend uit "${line.packagingDescription ?? "—"}" / "${line.description}" / eenheid "${line.unit}".`
      );
    }

    return {
      rowNumber: line.lineNumber,
      raw: line as unknown as Record<string, unknown>,
      eanCode: line.eanCode,
      articleNumber: line.articleNumber,
      description: line.description,
      brand: null,
      packagingDescription:
        matchedPackagingText ?? line.packagingDescription ?? (line.unit ? `1 ${line.unit}` : null),
      packagingUnitCount,
      packagingUnitKey,
      purchasePrice: line.unitPrice,
    };
  });
}

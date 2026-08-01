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

/**
 * Zet uitgelezen factuurregels om naar prijsimport-rijen, met dezelfde
 * verpakkingsherkenning als bij een gewone prijslijst-import (spec §5:
 * "6 x 1 liter", "doos 12 stuks" etc.) — zodat handmatig invullen van de
 * verpakkingseenheid de uitzondering is, niet de regel.
 */
export function linesToRows(lines: ParsedInvoiceLine[]): ParsedPriceRow[] {
  return lines.map((line) => {
    let packagingUnitCount: number | null = null;

    const candidateTexts = [
      line.packagingDescription,
      line.quantity && line.unit ? `${line.quantity} ${line.unit}` : null,
    ].filter(Boolean) as string[];

    for (const text of candidateTexts) {
      const parsed = parsePackagingText(text);
      if (parsed) {
        const factor = UNIT_TO_BASE_FACTOR[parsed.unit]?.factor ?? 1;
        packagingUnitCount = parsed.totalQuantity * factor;
        break;
      }
    }

    if (packagingUnitCount === null && line.unit) {
      const unCefact = UN_CEFACT_TO_BASE[line.unit.toUpperCase()];
      if (unCefact) packagingUnitCount = unCefact.factor;
    }

    return {
      rowNumber: line.lineNumber,
      raw: line as unknown as Record<string, unknown>,
      eanCode: line.eanCode,
      articleNumber: line.articleNumber,
      description: line.description,
      brand: null,
      packagingDescription:
        line.packagingDescription ?? (line.unit ? `${line.quantity ?? 1} ${line.unit}` : null),
      packagingUnitCount,
      purchasePrice: line.unitPrice,
    };
  });
}

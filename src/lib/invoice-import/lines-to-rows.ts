import type { ParsedInvoiceLine } from "./parse-ubl";
import { importPackagingFromText, pieceCountFromName } from "@/lib/packaging";
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

    // Als Claude geen eenheid heeft ingevuld (bv. een factuur zonder
    // aparte eenheidskolom), val terug op dezelfde vuistregel als in de
    // prompt: een niet-heel getal (bv. 3,6) is vrijwel altijd een
    // gewicht in kilogram, een heel getal duidt meestal op stuks. Dit is
    // een harde terugval in code, niet alleen een instructie aan Claude.
    let effectiveUnit = line.unit;
    if (!effectiveUnit && line.quantity !== null) {
      effectiveUnit = Number.isInteger(line.quantity) ? "stuk" : "kg";
    }

    // Volgorde van betrouwbaarheid: 1) expliciete verpakkingstekst van
    // Claude, 2) verpakking die in de artikelomschrijving zelf verwerkt
    // zit (bv. "MOSSELEN SUPER SELECT 2 KG" → 2 kg). Het AANTAL besteld
    // (bv. "40 stuks") wordt hier bewust NOOIT als verpakkingsgrootte
    // gebruikt — dat is een ander getal met een andere betekenis, en
    // door ze te verwarren ontstaat precies de fout waarbij "40 stuks
    // besteld à €1,25/stuk" verkeerd wordt gelezen als "1 verpakking van
    // 40 stuks voor €1,25", wat de prijs 40x te laag maakt.
    //
    // Uitzondering: staat de regel in kilo's of liters (bv. "3,39 kg à
    // € 17,50"), dan is de prijs per kilo/liter en is de verpakking altijd
    // 1 kg / 1 liter. Gewichten in de omschrijving ("1.2-1.6", "200 gr")
    // zijn dan de portie- of stukgrootte en nooit de verpakking.
    const unitKey = (effectiveUnit ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const perUnitText = /^(kg|kgs|kilo|kilogram)$/.test(unitKey)
      ? "1 kg"
      : /^(l|lt|ltr|liter|litre)$/.test(unitKey)
      ? "1 l"
      : null;
    const candidateTexts = perUnitText
      ? [perUnitText]
      : ([line.packagingDescription, line.description].filter(Boolean) as string[]);

    for (const text of candidateTexts) {
      const parsed = importPackagingFromText(text);
      if (parsed) {
        packagingUnitCount = parsed.count;
        packagingUnitKey = parsed.unitKey;
        matchedPackagingText = parsed.explanation;
        break;
      }
    }

    // Staat het aantal in de productnaam ("Croquetas 48x30" = 48 stuks),
    // gebruik dat dan boven de aanname "1 stuk". Alleen voor regels die
    // in stuks gaan; kilo- en literregels hebben hierboven al hun verpakking.
    if (packagingUnitCount === null && !perUnitText) {
      const fromName = pieceCountFromName(line.description);
      if (fromName) {
        packagingUnitCount = fromName.count;
        packagingUnitKey = "stuk";
        matchedPackagingText = `${fromName.count} × 1 Stuks`;
      }
    }

    // Geen verpakking gevonden: veiligste aanname is dat de prijs al per
    // losse eenheid is (bv. "€ 1,25 per stuk", "€ 17,50 per kg") — dat is
    // verreweg het meest voorkomende factuurpatroon. "1 {eenheid}" i.p.v.
    // "{aantal} {eenheid}" voorkomt dat het bestelde aantal per ongeluk
    // als verpakkingsgrootte wordt gebruikt.
    if (packagingUnitCount === null && effectiveUnit) {
      const parsedSingle = importPackagingFromText(`1 ${effectiveUnit}`);
      if (parsedSingle) {
        packagingUnitCount = parsedSingle.count;
        packagingUnitKey = parsedSingle.unitKey;
        matchedPackagingText = `1 ${effectiveUnit}`;
      } else {
        const unCefact = UN_CEFACT_TO_BASE[effectiveUnit.toUpperCase()];
        if (unCefact) {
          packagingUnitCount = unCefact.factor;
          packagingUnitKey = unCefact.baseUnitKey;
          matchedPackagingText = `1 ${effectiveUnit}`;
        }
      }
    }

    if (packagingUnitCount === null) {
      console.warn(
        `[invoice-import] Regel ${line.lineNumber} ("${line.description}"): geen verpakkingshoeveelheid herkend uit "${line.packagingDescription ?? "—"}" / "${line.description}" / eenheid "${effectiveUnit}".`
      );
    }

    return {
      rowNumber: line.lineNumber,
      raw: line as unknown as Record<string, unknown>,
      eanCode: line.eanCode,
      articleNumber: line.articleNumber,
      description: line.description,
      // Het merk stond wél in de uitlezing maar werd hier weggegooid; op
      // facturen met een merkkolom (bv. Horesca) gaat dat nu mee.
      brand: line.brand ?? null,
      packagingDescription:
        matchedPackagingText ?? line.packagingDescription ?? (effectiveUnit ? `1 ${effectiveUnit}` : null),
      packagingUnitCount,
      packagingUnitKey,
      purchasePrice: line.unitPrice,
      vatRate: line.vatRate ?? null,
      qualityMark: line.qualityMark ?? null,
      deliveryDate: line.deliveryDate ?? null,
      deliveryNote: line.deliveryNote ?? null,
      // Bij twijfel geen aanname: 'onbekend' betekent dat een mens het
      // beoordeelt, zodat niet-food nooit stil als ingrediënt ontstaat.
      itemCategory: line.itemCategory ?? null,
    };
  });
}

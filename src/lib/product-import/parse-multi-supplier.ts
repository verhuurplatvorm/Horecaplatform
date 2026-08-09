import * as XLSX from "xlsx";
import { normalizeUnitKey } from "@/lib/recipe-import/parse-halfproducts";

export interface ParsedProductRow {
  rowNumber: number;
  name: string;
  supplierArticleNumber: string | null;
  brand: string | null;
  supplierNameRaw: string;
  category: string | null;
  purchasePrice: number | null;
  packagingUnitCount: number | null; // omgerekend naar systeem-basiseenheid
  packagingUnitKey: string | null;
  packagingDescription: string | null;
  eanCode: string | null;
  isAvailable: boolean;
  flaggedBySource: boolean; // "Niet herkend" kolom uit het bronbestand
  contentDerivedFromName: boolean; // inhoud uit de ingrediëntnaam afgeleid (bv. "2x5l") — controleren
}

const HEADER_MAP: Record<string, string> = {
  "niet herkend": "flaggedBySource",
  naam: "name",
  "leverancier artikelnr.": "supplierArticleNumber",
  merk: "brand",
  leverancier: "supplierNameRaw",
  categorie: "category",
  "prijs per ingrediënt": "purchasePrice",
  "ingrediënten in pakket": "packagingCount",
  "inhoud van prod.": "contentPerUnit",
  eenheid: "unitRaw",
  beschikbaar: "isAvailable",
  ean: "eanCode",
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

const UNIT_FACTOR_TO_BASE: Record<string, number> = {
  g: 1,
  kg: 1000,
  ml: 1,
  cl: 10,
  dl: 100,
  l: 1000,
  stuk: 1,
};

/** Elke herkende eenheid rekent naar de kleinste basiseenheid van zijn dimensie: g (gewicht), ml (inhoud) of stuk. */
function toBaseUnitKey(unitKey: string): string {
  if (unitKey === "stuk") return "stuk";
  if (unitKey === "kg" || unitKey === "g") return "g";
  return "ml"; // ml, cl, dl, l
}

// Eenheid-spellingen zoals ze in ingrediëntnamen voorkomen, met hun factor
// naar de basiseenheid (ml of g) van hun dimensie.
const NAME_UNIT_PATTERNS: { pattern: RegExp; baseKey: "ml" | "g"; factor: number }[] = [
  { pattern: /^(?:ml)$/i, baseKey: "ml", factor: 1 },
  { pattern: /^(?:cl)$/i, baseKey: "ml", factor: 10 },
  { pattern: /^(?:dl)$/i, baseKey: "ml", factor: 100 },
  { pattern: /^(?:l|lt|ltr|liter|litre)$/i, baseKey: "ml", factor: 1000 },
  { pattern: /^(?:g|gr|gram)$/i, baseKey: "g", factor: 1 },
  { pattern: /^(?:kg|kilo)$/i, baseKey: "g", factor: 1000 },
];

/**
 * Probeert de inhoud uit een ingrediëntnaam of -omschrijving af te leiden,
 * voor regels waar het bronbestand geen bruikbare inhoud/eenheid gaf en
 * die anders als "1 stuk" zouden binnenkomen (bv. een emmer van 10 liter
 * als € 22,50 "per stuk" — 10.000x te hoge prijs per basiseenheid).
 *
 * Herkent o.a.: "2x5l", "6 x 1 ltr", "emmer 10 ltr", "750ml", "0,75L",
 * "2,5 kg", "500 gr". Bij meerdere maten in de naam wint de laatste
 * (maataanduidingen staan vrijwel altijd achteraan, bv.
 * "Cola 0,33 → krat 24x33cl").
 */
export function deriveContentFromName(
  name: string
): { baseKey: "ml" | "g"; quantityInBase: number; matchedText: string } | null {
  // "AxB eenheid" (bv. 2x5l, 24 x 33cl) of "B eenheid" (bv. 10 ltr, 750ml)
  const regex =
    /(?:(\d+(?:[.,]\d+)?)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|ltr|lt|liter|litre|l|kg|kilo|gram|gr|g)(?![a-z])/gi;

  let best: { baseKey: "ml" | "g"; quantityInBase: number; matchedText: string } | null = null;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(name)) !== null) {
    const count = match[1] ? Number(match[1].replace(",", ".")) : 1;
    const amount = Number(match[2].replace(",", "."));
    const unitText = match[3];
    const unitDef = NAME_UNIT_PATTERNS.find((u) => u.pattern.test(unitText));
    if (!unitDef || !Number.isFinite(count) || !Number.isFinite(amount)) continue;
    const quantityInBase = count * amount * unitDef.factor;
    if (quantityInBase <= 0) continue;
    best = { baseKey: unitDef.baseKey, quantityInBase, matchedText: match[0].trim() };
  }
  return best;
}

/**
 * Leest het vaste "Ingrediënten"-exportformaat: één blad, kolomkoppen op
 * de eerste rij, één rij per product/leverancier-combinatie. Kolommen
 * worden op NAAM herkend (niet op positie), robuust tegen een andere
 * volgorde.
 */
export function parseMultiSupplierExcel(buffer: Buffer): ParsedProductRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: null,
  });

  const firstRow = rows[0];
  const canonicalByOriginal = new Map<string, string>();
  if (firstRow) {
    for (const key of Object.keys(firstRow)) {
      const normalized = key.trim().toLowerCase();
      if (HEADER_MAP[normalized]) canonicalByOriginal.set(key, HEADER_MAP[normalized]);
    }
  }

  const result: ParsedProductRow[] = [];

  rows.forEach((row, i) => {
    const byCanonical: Record<string, unknown> = {};
    for (const [original, canonical] of canonicalByOriginal) {
      byCanonical[canonical] = row[original];
    }

    const name = toText(byCanonical.name);
    const supplierNameRaw = toText(byCanonical.supplierNameRaw);
    if (!name || !supplierNameRaw) return;

    const packagingCount = toNumber(byCanonical.packagingCount) ?? 1;
    const contentPerUnit = toNumber(byCanonical.contentPerUnit) ?? 1;
    const unitRaw = toText(byCanonical.unitRaw) ?? "stuk";
    const unitKey = normalizeUnitKey(unitRaw);
    const factor = UNIT_FACTOR_TO_BASE[unitKey] ?? 1;

    let packagingUnitCount = packagingCount * contentPerUnit * factor;
    let packagingUnitKey = toBaseUnitKey(unitKey);
    let packagingDescription = `${packagingCount} × ${contentPerUnit} ${unitRaw}`;
    let contentDerivedFromName = false;

    // Bronbestand gaf geen bruikbare inhoud (eenheid "stuk" zonder echte
    // inhoud per stuk) — probeer de maat uit de ingrediëntnaam te halen,
    // zodat een "emmer 10 ltr" niet als 1 stuk van € 22,50 binnenkomt.
    if (packagingUnitKey === "stuk" && contentPerUnit === 1) {
      const derived = deriveContentFromName(name);
      if (derived) {
        packagingUnitKey = derived.baseKey;
        packagingUnitCount = packagingCount * derived.quantityInBase;
        packagingDescription = `${packagingCount} × ${derived.matchedText} (uit naam afgeleid)`;
        contentDerivedFromName = true;
      }
    }

    result.push({
      rowNumber: i + 2,
      name,
      supplierArticleNumber: toText(byCanonical.supplierArticleNumber),
      brand: toText(byCanonical.brand),
      supplierNameRaw,
      category: toText(byCanonical.category),
      purchasePrice: toNumber(byCanonical.purchasePrice),
      packagingUnitCount: packagingUnitCount > 0 ? packagingUnitCount : null,
      packagingUnitKey,
      packagingDescription,
      eanCode: toText(byCanonical.eanCode),
      isAvailable: toText(byCanonical.isAvailable)?.toLowerCase() !== "nee",
      flaggedBySource: toText(byCanonical.flaggedBySource)?.toLowerCase() === "true",
      contentDerivedFromName,
    });
  });

  return result;
}

/** Strip bekende platform-achtervoegsels (bv. "- InOne") voor een betrouwbaardere exacte match. */
export function normalizeSupplierName(raw: string): string {
  return raw
    .replace(/\s*-\s*inone\s*$/i, "")
    .trim()
    .toLowerCase();
}

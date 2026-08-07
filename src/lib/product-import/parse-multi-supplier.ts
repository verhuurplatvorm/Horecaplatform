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
}

const HEADER_MAP: Record<string, string> = {
  "niet herkend": "flaggedBySource",
  naam: "name",
  "leverancier artikelnr.": "supplierArticleNumber",
  merk: "brand",
  leverancier: "supplierNameRaw",
  categorie: "category",
  "prijs per product": "purchasePrice",
  "producten in pakket": "packagingCount",
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
    const packagingUnitCount = packagingCount * contentPerUnit * factor;

    result.push({
      rowNumber: i + 2,
      name,
      supplierArticleNumber: toText(byCanonical.supplierArticleNumber),
      brand: toText(byCanonical.brand),
      supplierNameRaw,
      category: toText(byCanonical.category),
      purchasePrice: toNumber(byCanonical.purchasePrice),
      packagingUnitCount: packagingUnitCount > 0 ? packagingUnitCount : null,
      packagingUnitKey: toBaseUnitKey(unitKey),
      packagingDescription: `${packagingCount} × ${contentPerUnit} ${unitRaw}`,
      eanCode: toText(byCanonical.eanCode),
      isAvailable: toText(byCanonical.isAvailable)?.toLowerCase() !== "nee",
      flaggedBySource: toText(byCanonical.flaggedBySource)?.toLowerCase() === "true",
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

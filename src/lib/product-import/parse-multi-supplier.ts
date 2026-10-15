import * as XLSX from "xlsx";
import { normalizeUnitKey } from "@/lib/recipe-import/parse-halfproducts";
import { contentFromName, isUnitKey, toSmallestUnit } from "@/lib/packaging";

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

/**
 * Inhoud uit een ingrediëntnaam afleiden — de logica staat centraal in
 * src/lib/packaging (contentFromName); hier alleen onder de oude naam.
 */
export function deriveContentFromName(
  name: string
): { baseKey: "ml" | "g"; quantityInBase: number; matchedText: string } | null {
  return contentFromName(name);
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
    const { baseKey: smallestKey, factor } = isUnitKey(unitKey)
      ? toSmallestUnit(unitKey)
      : { baseKey: "stuk" as const, factor: 1 };

    let packagingUnitCount = packagingCount * contentPerUnit * factor;
    let packagingUnitKey: string = smallestKey;
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

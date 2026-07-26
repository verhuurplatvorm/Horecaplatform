/**
 * Herkent kolomkoppen in leveranciersprijslijsten. Leveranciers noemen
 * hun kolommen niet allemaal hetzelfde, dus we matchen op een aantal
 * bekende varianten (NL/EN) in plaats van exacte namen te eisen.
 */

import { parsePackagingText } from "./packaging-parser";

export interface ParsedPriceRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  eanCode: string | null;
  articleNumber: string | null;
  description: string | null;
  packagingDescription: string | null;
  packagingUnitCount: number | null;
  purchasePrice: number | null;
}

const HEADER_ALIASES: Record<string, string[]> = {
  ean: ["ean", "ean_code", "eancode", "barcode", "gtin"],
  articleNumber: [
    "artikelnummer",
    "artikelcode",
    "article_number",
    "articlenumber",
    "sku",
    "productcode",
  ],
  description: [
    "omschrijving",
    "naam",
    "artikelomschrijving",
    "description",
    "name",
    "product",
  ],
  packagingDescription: [
    "verpakking",
    "verpakkingseenheid",
    "packaging",
    "packaging_description",
    "eenheid",
  ],
  packagingUnitCount: [
    "inhoud",
    "aantal",
    "inhoud_per_verpakking",
    "packaging_unit_count",
    "quantity",
    "content",
  ],
  purchasePrice: [
    "prijs",
    "inkoopprijs",
    "price",
    "purchase_price",
    "netto_prijs",
    "nettoprijs",
    "unit_price",
  ],
};

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Bouwt een lookup van genormaliseerde brondkolomnaam -> canonieke veldnaam. */
export function buildHeaderMap(headers: string[]): Map<string, string> {
  const normalized = headers.map((h) => ({
    original: h,
    normalized: normalizeHeader(h),
  }));

  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    const match = normalized.find((h) => aliases.includes(h.normalized));
    if (match) map.set(match.original, canonical);
  }
  return map;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const cleaned = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "") // duizendtalpunten weg
    .replace(",", "."); // komma als decimaalteken
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/** Zet een rij ruwe kolomwaarden (op originele headernaam) om naar een
 * genormaliseerde rij, gegeven de eerder gebouwde header-map. */
export function normalizeRow(
  rowNumber: number,
  raw: Record<string, unknown>,
  headerMap: Map<string, string>
): ParsedPriceRow {
  const byCanonical: Record<string, unknown> = {};
  for (const [original, canonical] of headerMap.entries()) {
    byCanonical[canonical] = raw[original];
  }

  const packagingDescription = toText(byCanonical.packagingDescription);
  let packagingUnitCount = toNumber(byCanonical.packagingUnitCount);

  // Geen aparte hoeveelheid-kolom, maar wel een verpakkingstekst zoals
  // "6 x 1 liter" of "doos 20 stuks"? Probeer die te ontleden (spec §5).
  if (packagingUnitCount === null && packagingDescription) {
    const parsed = parsePackagingText(packagingDescription);
    if (parsed) packagingUnitCount = parsed.totalQuantity;
  }

  return {
    rowNumber,
    raw,
    eanCode: toText(byCanonical.ean),
    articleNumber: toText(byCanonical.articleNumber),
    description: toText(byCanonical.description),
    packagingDescription,
    packagingUnitCount,
    purchasePrice: toNumber(byCanonical.purchasePrice),
  };
}

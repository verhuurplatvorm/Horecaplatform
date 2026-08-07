import * as XLSX from "xlsx";

export interface ParsedImportIngredient {
  name: string;
  quantity: number;
  unitRaw: string;
  supplierArticleNumber: string | null;
  supplierName: string | null;
  brand: string | null;
}

export interface ParsedImportRecipe {
  name: string;
  externalId: string | null;
  ingredients: ParsedImportIngredient[];
}

function cell(row: unknown[], index: number): string | null {
  const value = row[index];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function parseQuantity(raw: string | null): number | null {
  if (!raw) return null;
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

/**
 * Leest een export in het "Item naam: X ... ID: Y" blokformaat: per
 * recept een kopregel, een vaste kolomkoppen-regel, dan ingrediëntregels
 * tot een lege rij het volgende blok inluidt.
 *
 * Gebruikt bewust SheetJS (xlsx) i.p.v. exceljs — exceljs struikelt over
 * de minimale (maar geldige) bestandsstructuur die dit soort export-
 * tools produceren (ontbrekende docProps/core.xml etc.), SheetJS leest
 * dit foutloos.
 */
export function parseHalfproductsExcel(buffer: Buffer): ParsedImportRecipe[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false });

  const recipes: ParsedImportRecipe[] = [];
  let current: ParsedImportRecipe | null = null;
  let awaitingColumnHeaderRow = false;

  for (const row of rows) {
    const colA = cell(row, 0);
    const colF = cell(row, 5);

    if (colA?.toLowerCase().startsWith("item naam:")) {
      if (current && current.ingredients.length > 0) recipes.push(current);
      const name = colA.slice(colA.indexOf(":") + 1).trim();
      const externalIdMatch = colF?.match(/ID:\s*(\S+)/i);
      current = {
        name,
        externalId: externalIdMatch ? externalIdMatch[1] : null,
        ingredients: [],
      };
      awaitingColumnHeaderRow = true;
      continue;
    }

    if (awaitingColumnHeaderRow) {
      awaitingColumnHeaderRow = false;
      continue;
    }

    if (!colA) {
      if (current && current.ingredients.length > 0) {
        recipes.push(current);
      }
      current = null;
      continue;
    }

    if (!current) continue;

    const quantity = parseQuantity(cell(row, 1));
    if (quantity === null) continue;

    current.ingredients.push({
      name: colA,
      quantity,
      unitRaw: cell(row, 2) ?? "stuk",
      supplierArticleNumber: cell(row, 3),
      supplierName: cell(row, 4),
      brand: cell(row, 5),
    });
  }

  if (current && (current as ParsedImportRecipe).ingredients.length > 0) {
    recipes.push(current);
  }

  return recipes;
}

/** Zet een Excel-eenheidsnaam (Stuks/Gram/Ml/...) om naar de systeem-eenheidssleutel. */
export function normalizeUnitKey(raw: string): string {
  const key = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    stuks: "stuk",
    stuk: "stuk",
    st: "stuk",
    gram: "g",
    g: "g",
    kg: "kg",
    kilogram: "kg",
    ml: "ml",
    milliliter: "ml",
    cl: "cl",
    dl: "dl",
    l: "l",
    liter: "l",
    ltr: "l",
  };
  return map[key] ?? "stuk";
}

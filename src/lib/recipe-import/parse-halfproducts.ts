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
  /** Mapnaam uit de bron (bv. "01. HS Lunch") — wordt de categorie/map van het recept. */
  folderName: string | null;
  /** Kaartprijs (verkoopprijs incl. btw) uit de bron, indien aanwezig. */
  salesPriceInclVat: number | null;
  /** Btw-percentage uit de bron, indien aanwezig. */
  vatRate: number | null;
  /** Omschrijving uit de bron. */
  description: string | null;
  /** Kassanummer, voor koppeling met het kassasysteem en dubbelcontrole. */
  posReference: string | null;
  /** Aantal personen/porties waarop het bronrecept is gerekend. */
  portionCount: number | null;
  /** Verliespercentage uit de bron. */
  wastePercentage: number | null;
  /** Gewenste brutowinstmarge uit de bron. */
  grossMarginPct: number | null;
  /** "Soort naam" uit de bron, bv. "Snack Z". */
  sourceKind: string | null;
  /**
   * Financiële cijfers zoals ze in het bronbestand stonden. Puur ter
   * vergelijking bewaard — onze eigen kostprijsberekening blijft leidend
   * en overschrijft deze waarden nooit.
   */
  sourceFinancials: Record<string, number | string | null>;
  ingredients: ParsedImportIngredient[];
}

/**
 * Bronbestanden bevatten soms letterlijke HTML-codes in de tekst
 * (vooral "&nbsp;" als spatie), waardoor eenheden niet herkend worden
 * ("200&nbsp;ml&nbsp;Vissoep" → 200 stuk met de eenheid in de naam).
 * Decodeert de gangbare codes en normaliseert alle witruimte.
 */
function decodeEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&eacute;/gi, "é")
    .replace(/&euml;/gi, "ë")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseDutchNumber(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
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
        folderName: null,
        salesPriceInclVat: null,
        vatRate: null,
        description: null,
        posReference: null,
        portionCount: null,
        wastePercentage: null,
        grossMarginPct: null,
        sourceKind: null,
        sourceFinancials: {},
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

  // Geen blokken gevonden? Probeer het rij-formaat: één gerecht per rij,
  // met alle ingrediënten als meerregelige tekst in één "Ingrediënten"-
  // kolom (zoals de Gerechten-export: "220 ml Vissoep\n60 gr Kabeljauw…").
  if (recipes.length === 0) {
    return parseGerechtenRowFormat(workbook);
  }

  return recipes;
}

/**
 * Leest het rij-formaat van een Gerechten-export: kopregel met o.a.
 * "Naam" en "Ingrediënten", daarna per gerecht één rij waarin de
 * ingrediënten als regels tekst in één cel staan ("hoeveelheid [eenheid]
 * naam"). Ontbreekt de eenheid ("0,025 Little gem"), dan geldt stuk.
 */
function parseGerechtenRowFormat(workbook: XLSX.WorkBook): ParsedImportRecipe[] {
  const INGREDIENT_LINE =
    /^\s*(\d+(?:[.,]\d+)?)\s*(?:(stuks?|st|gram|gr|g|kg|ml|cl|dl|ltr|lt|liter|l)\b\.?\s+)?(.+)$/i;

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
    });

    // Kopregel zoeken in de eerste vijf rijen
    let headerIndex = -1;
    let nameCol = -1;
    let ingredientsCol = -1;
    let idCol = -1;
    let mapCol = -1;
    let priceCol = -1;
    let vatCol = -1;
    let descCol = -1;
    let posCol = -1;
    let personsCol = -1;
    let wasteCol = -1;
    let marginCol = -1;
    let kindCol = -1;
    const financialCols: Record<string, number> = {};
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const headers = (rows[i] ?? []).map((h) =>
        String(h ?? "").trim().toLowerCase()
      );
      const n = headers.indexOf("naam");
      const ing = headers.findIndex((h) => h.startsWith("ingredi"));
      if (n >= 0 && ing >= 0) {
        headerIndex = i;
        nameCol = n;
        ingredientsCol = ing;
        idCol = headers.indexOf("id");
        mapCol = headers.indexOf("mapnaam");
        priceCol = headers.indexOf("kaartprijs");
        // Let op: "btw" bestaat óók als kolom met het btw-BEDRAG in euro's.
        // Het tarief staat in "Btw percentage"; zonder deze volgorde werd
        // eerder het bedrag (bv. 0,61) als tarief ingelezen.
        vatCol = headers.findIndex((h) => h.startsWith("btw percentage"));
        if (vatCol < 0) vatCol = headers.indexOf("btw");
        descCol = headers.indexOf("omschrijving");
        posCol = headers.indexOf("kassanummer");
        personsCol = headers.indexOf("aantal personen");
        wasteCol = headers.indexOf("verliespercentage");
        marginCol = headers.indexOf("brutowinstmarge");
        kindCol = headers.indexOf("soort naam");
        // Brondata die we alleen bewaren, nooit gebruiken om mee te rekenen.
        for (const label of [
          "kosten", "afval", "totale kosten", "winst", "verkoop excl. btw",
          "btw", "verkoop incl. btw", "kaartmarge", "margeprobleem",
          "gemaakt op", "gewijzigd op", "gerealiseerde brutowinst",
          "marge-uitgesloten kosten", "inslag percentage", "kaart inslag",
        ]) {
          const idx = headers.indexOf(label);
          if (idx >= 0) financialCols[label] = idx;
        }
        break;
      }
    }
    if (headerIndex < 0) continue;

    const recipes: ParsedImportRecipe[] = [];
    for (const row of rows.slice(headerIndex + 1)) {
      const rawName = cell(row, nameCol);
      const ingredientsText = cell(row, ingredientsCol);
      if (!rawName || !ingredientsText) continue;
      const name = decodeEntities(rawName);

      const ingredients: ParsedImportIngredient[] = [];
      for (const rawLine of ingredientsText.split(/\r?\n/)) {
        const line = decodeEntities(rawLine);
        if (!line) continue;
        const match = line.match(INGREDIENT_LINE);
        if (!match) continue;
        const quantity = Number(match[1].replace(",", "."));
        let ingredientName = match[3].trim();
        // Leveranciersartikelnummer staat in de bron tussen hekjes,
        // bv. "Curry ketchup tube 1x800 ml #68848#". Dat is de meest
        // betrouwbare koppeling, dus apart houden en uit de naam halen.
        let articleNumber: string | null = null;
        const artMatch = ingredientName.match(/#\s*([\w.-]+)\s*#/);
        if (artMatch) {
          articleNumber = artMatch[1];
          ingredientName = ingredientName.replace(artMatch[0], "").trim();
        }
        if (!Number.isFinite(quantity) || quantity <= 0 || !ingredientName) continue;
        ingredients.push({
          name: ingredientName,
          quantity,
          unitRaw: match[2] ?? "stuk",
          supplierArticleNumber: articleNumber,
          supplierName: null,
          brand: null,
        });
      }

      if (ingredients.length > 0) {
        recipes.push({
          name,
          externalId: idCol >= 0 ? cell(row, idCol) : null,
          folderName: mapCol >= 0 ? cell(row, mapCol) : null,
          salesPriceInclVat: priceCol >= 0 ? parseDutchNumber(cell(row, priceCol)) : null,
          vatRate: vatCol >= 0 ? parseDutchNumber(cell(row, vatCol)) : null,
          description: descCol >= 0 ? decodeEntities(cell(row, descCol) ?? "") || null : null,
          posReference: posCol >= 0 ? cell(row, posCol) || null : null,
          portionCount: personsCol >= 0 ? parseDutchNumber(cell(row, personsCol)) : null,
          wastePercentage: wasteCol >= 0 ? parseDutchNumber(cell(row, wasteCol)) : null,
          grossMarginPct: marginCol >= 0 ? parseDutchNumber(cell(row, marginCol)) : null,
          sourceKind: kindCol >= 0 ? cell(row, kindCol) || null : null,
          sourceFinancials: Object.fromEntries(
            Object.entries(financialCols).map(([label, idx]) => [label, cell(row, idx) || null])
          ),
          ingredients,
        });
      }
    }

    if (recipes.length > 0) return recipes;
  }

  return [];
}

/** Zet een Excel-eenheidsnaam (Stuks/Gram/Ml/...) om naar de systeem-eenheidssleutel. */
export function normalizeUnitKey(raw: string): string {
  const key = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    stuks: "stuk",
    stuk: "stuk",
    st: "stuk",
    gram: "g",
    gr: "g",
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

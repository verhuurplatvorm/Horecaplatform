/**
 * Menu's & buffetten — sheet importeren.
 *
 * Een Excel/CSV-sheet (of geplakte tekst) wordt omgezet naar regels:
 * onderdeel (bv. "Koud buffet"), naam, en optioneel hoeveelheid + eenheid.
 * Puur, zodat het getest kan worden; het lezen van het bestand zelf
 * (SheetJS) gebeurt in de pagina.
 */

export interface ImportRow {
  section: string | null;
  name: string;
  quantity: number | null;
  unit: string | null;
}

type Cell = string | number | boolean | null | undefined;

const SECTION_WORDS =
  /^(koud|warm|buffet|voorgerecht|voorgerechten|hoofdgerecht|hoofdgerechten|nagerecht|nagerechten|dessert|desserts|soep|soepen|salade|salades|bijgerecht|bijgerechten|garnituur|borrel|bites|hapjes|amuse|ontbijt|lunch|diner|brood|dranken|vegetarisch|vis|vlees|kids|kinderen|extra|extra's|sauzen)\b/i;

const NAME_HEADER =
  /^(gerecht|gerechten|omschrijving|naam|product|artikel|item|onderdeel menu|menu)$/i;
const QTY_HEADER =
  /^(aantal|hoeveelheid|hoev\.?|p\.?\s?p\.?|per persoon|portie|porties|qty|stuks)$/i;
const UNIT_HEADER = /^(eenheid|unit|maat)$/i;
const SECTION_HEADER = /^(onderdeel|sectie|categorie|gang|rubriek|groep)$/i;

function str(c: Cell): string {
  if (c === null || c === undefined || c === false) return "";
  return String(c).trim();
}

/** "1,5" → 1.5; "2 x" → 2; tekst → null */
export function toNumber(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const s = str(c)
    .replace(/\s*x\s*$/i, "")
    .replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Eenheidstekst uit een sheet → sleutel in de tabel units (g, kg, ml, cl, l, stuk). */
export function unitKeyFor(text: string | null | undefined): string | null {
  const t = (text ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!t) return null;
  if (/^(g|gr|gram|grammen)$/.test(t)) return "g";
  if (/^(kg|kilo|kilogram)$/.test(t)) return "kg";
  if (/^(ml|milliliter)$/.test(t)) return "ml";
  if (/^(cl|centiliter)$/.test(t)) return "cl";
  if (/^(dl|deciliter)$/.test(t)) return "dl";
  if (/^(l|ltr|liter)$/.test(t)) return "l";
  if (/^(st|stk|stuk|stuks|portie|porties|pp|p\.p|pers|persoon|x)$/.test(t))
    return "stuk";
  return null;
}

/** "150 gr carpaccio" / "2x broodje" / "carpaccio 150 g" → naam + hoeveelheid. */
export function splitQuantity(text: string): {
  name: string;
  quantity: number | null;
  unit: string | null;
} {
  const s = text.trim();
  let m =
    /^(\d+(?:[.,]\d+)?)\s*(x|st|stuks?|g|gr|gram|kg|ml|cl|l|ltr|liter)?\.?\s+(.+)$/i.exec(
      s,
    );
  if (m) {
    return {
      name: m[3].trim(),
      quantity: Number(m[1].replace(",", ".")),
      unit: m[2] ? (unitKeyFor(m[2]) ?? m[2]) : null,
    };
  }
  m =
    /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(g|gr|gram|kg|ml|cl|l|ltr|liter|st|stuks?)\.?$/i.exec(
      s,
    );
  if (m) {
    return {
      name: m[1].trim(),
      quantity: Number(m[2].replace(",", ".")),
      unit: unitKeyFor(m[3]),
    };
  }
  return { name: s, quantity: null, unit: null };
}

function looksLikeSection(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith(":")) return true;
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
  return SECTION_WORDS.test(t) && t.split(/\s+/).length <= 3;
}

function cleanSection(text: string): string {
  const t = text.trim().replace(/:$/, "").trim();
  // HOOFDLETTERS → Hoofdletter
  if (t === t.toUpperCase()) return t.charAt(0) + t.slice(1).toLowerCase();
  return t;
}

/**
 * Rijen uit een spreadsheet (eerste werkblad, als array van rijen).
 * Herkent een kopregel (Gerecht/Aantal/Eenheid/Onderdeel); zonder kopregel
 * is de eerste tekstkolom de naam en de eerste getalkolom het aantal.
 * Rijen met alleen een kopje (bv. "KOUD BUFFET") worden het onderdeel.
 */
export function parseGrid(grid: Cell[][]): ImportRow[] {
  const rows = grid.filter((r) => r.some((c) => str(c) !== ""));
  if (rows.length === 0) return [];

  let nameCol = -1;
  let qtyCol = -1;
  let unitCol = -1;
  let sectionCol = -1;
  let start = 0;

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map(str);
    const n = cells.findIndex((c) => NAME_HEADER.test(c));
    if (n >= 0) {
      nameCol = n;
      qtyCol = cells.findIndex((c) => QTY_HEADER.test(c));
      unitCol = cells.findIndex((c) => UNIT_HEADER.test(c));
      sectionCol = cells.findIndex((c, j) => j !== n && SECTION_HEADER.test(c));
      start = i + 1;
      break;
    }
  }

  if (nameCol < 0) {
    // Geen kopregel: kolom met de meeste tekst = naam, eerste getalkolom = aantal.
    const width = Math.max(...rows.map((r) => r.length));
    let best = 0;
    let bestScore = -1;
    for (let c = 0; c < width; c++) {
      const score = rows.filter(
        (r) => str(r[c]) !== "" && toNumber(r[c]) === null,
      ).length;
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    nameCol = best;
    for (let c = 0; c < width; c++) {
      if (c === nameCol) continue;
      const nums = rows.filter((r) => toNumber(r[c]) !== null).length;
      if (nums >= Math.max(1, rows.length / 3)) {
        qtyCol = c;
        break;
      }
    }
  }

  const out: ImportRow[] = [];
  let section: string | null = null;
  for (const r of rows.slice(start)) {
    const filled = r.map(str).filter(Boolean);
    const rawName = str(r[nameCol]);
    const explicitSection = sectionCol >= 0 ? str(r[sectionCol]) : "";
    if (explicitSection) section = cleanSection(explicitSection);

    // Alleen één cel gevuld en die lijkt een kopje → nieuw onderdeel.
    if (
      filled.length === 1 &&
      looksLikeSection(filled[0]) &&
      toNumber(filled[0]) === null
    ) {
      section = cleanSection(filled[0]);
      continue;
    }
    if (!rawName) continue;

    let quantity = qtyCol >= 0 ? toNumber(r[qtyCol]) : null;
    let unit = unitCol >= 0 ? str(r[unitCol]) || null : null;
    let name = rawName;
    if (quantity === null) {
      const s = splitQuantity(rawName);
      name = s.name;
      quantity = s.quantity;
      unit = unit ?? s.unit;
    }
    out.push({
      section,
      name,
      quantity,
      unit: unit ? (unitKeyFor(unit) ?? unit) : null,
    });
  }
  return out;
}

/** Geplakte tekst: één regel per item, kopjes eindigen op ":" of zijn in HOOFDLETTERS. */
export function parseText(text: string): ImportRow[] {
  const grid: Cell[][] = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s•\-–*·]+/, "").trim())
    .filter(Boolean)
    .map((l) =>
      l.includes("\t") ? l.split("\t") : l.includes(";") ? l.split(";") : [l],
    );
  return parseGrid(grid);
}

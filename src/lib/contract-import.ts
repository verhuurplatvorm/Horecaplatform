/**
 * Excel-import van contractprijzen: kolommen herkennen, regels matchen met
 * leverancier, bedrijf en artikel, en overlappende geldigheidsperiodes
 * signaleren. Puur (zonder database), zodat het te testen is; de pagina
 * Contractprijzen haalt de gegevens op en toont de voorvertoning.
 */

import { normalizeArticle, normalizePackaging } from "@/lib/price-comparison";

export interface ContractSheetRow {
  /** Regelnummer in Excel (kop = 1). */
  line: number;
  supplier: string;
  company: string;
  articleNumber: string;
  description: string;
  packaging: string;
  price: string;
  validFrom: string;
  validTo: string;
  note: string;
}

type Field = Exclude<keyof ContractSheetRow, "line">;

const HEADER_ALIASES: Record<Field, string[]> = {
  supplier: ["leverancier", "supplier", "groothandel"],
  company: ["bedrijf", "vestiging", "locatie", "company"],
  articleNumber: ["artikelnummer", "art.nr", "artnr", "artikelnr", "artikelcode", "art nr", "article", "sku"],
  description: ["omschrijving", "artikel", "product", "naam", "description"],
  packaging: ["verpakking", "eenheid", "inhoud", "packaging"],
  price: ["prijs excl btw", "prijs excl. btw", "prijs (excl. btw)", "contractprijs", "prijs", "price", "netto prijs"],
  validFrom: ["ingangsdatum", "geldig vanaf", "vanaf", "startdatum", "begindatum", "valid from"],
  validTo: ["einddatum", "geldig t/m", "geldig tot", "t/m", "tot", "valid to"],
  note: ["notitie", "opmerking", "note"],
};

function norm(h: string): string {
  return h.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Welke Excel-kolom hoort bij welk veld (exacte naam gaat voor 'begint met'). */
export function detectColumns(headers: string[]): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  const used = new Set<string>();
  const fields = Object.keys(HEADER_ALIASES) as Field[];
  for (const pass of ["exact", "prefix"] as const) {
    for (const field of fields) {
      if (out[field]) continue;
      for (const alias of HEADER_ALIASES[field]) {
        const hit = headers.find((h) => {
          if (used.has(h)) return false;
          const n = norm(h);
          return pass === "exact" ? n === alias : n.startsWith(alias);
        });
        if (hit) {
          out[field] = hit;
          used.add(hit);
          break;
        }
      }
    }
  }
  return out;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return toIso(v) ?? "";
  return String(v).trim();
}

/** Ruwe Excel-rijen (sheet_to_json) naar invoerregels. */
export function parseContractSheet(rows: Record<string, unknown>[]): {
  rows: ContractSheetRow[];
  missingColumns: string[];
} {
  // Alle kolomnamen (lege cellen ontbreken soms in de eerste rij).
  const cols = detectColumns([...new Set(rows.flatMap((r) => Object.keys(r)))]);
  const missingColumns = (["supplier", "price", "validFrom"] as Field[])
    .filter((f) => !cols[f])
    .map((f) => ({ supplier: "Leverancier", price: "Prijs excl. btw", validFrom: "Ingangsdatum" })[f as "supplier" | "price" | "validFrom"]);
  if (!cols.articleNumber && !cols.description) missingColumns.push("Artikelnummer");
  const out: ContractSheetRow[] = [];
  rows.forEach((r, i) => {
    const get = (f: Field) => (cols[f] ? cell(r[cols[f]!]) : "");
    const row: ContractSheetRow = {
      line: i + 2,
      supplier: get("supplier"),
      company: get("company"),
      articleNumber: get("articleNumber"),
      description: get("description"),
      packaging: get("packaging"),
      price: get("price"),
      validFrom: normalizeDateText(r[cols.validFrom ?? ""]),
      validTo: normalizeDateText(r[cols.validTo ?? ""]),
      note: get("note"),
    };
    const empty = !row.supplier && !row.articleNumber && !row.description && !row.price;
    if (!empty) out.push(row);
  });
  return { rows: out, missingColumns };
}

function toIso(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Excel-datum (serieel getal, Date, dd-mm-jjjj, jjjj-mm-dd) naar jjjj-mm-dd; anders de tekst zelf. */
export function normalizeDateText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return toIso(v) ?? "";
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel-serienummer (dagen sinds 1899-12-30).
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return s;
}

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "€ 12,50" / "12,50" / "1.234,56" / 12.5 → 12.5; null als ongeldig. */
export function parsePrice(text: string): number | null {
  let s = text.replace(/[€\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10000) / 10000 : null;
}

// ---------------------------------------------------------------------
// Matchen en controleren

export interface NamedOption {
  id: string;
  name: string;
}

export interface CatalogArticle {
  supplierId: string;
  articleNumber: string;
  productId: string;
  productName: string;
  packaging: string | null;
}

export interface ExistingContract {
  id: string;
  supplier_id: string;
  company_id: string | null;
  product_id: string | null;
  article_number: string | null;
  packaging_description: string | null;
  price: number;
  valid_from: string;
  valid_to: string | null;
}

/** Bewerkbare regel in de voorvertoning (ids zijn al gekozen of leeg). */
export interface ContractDraft {
  line: number;
  supplierText: string;
  supplierId: string | null;
  companyText: string;
  /** "" = alle bedrijven (groepsbreed); null = niet gevonden. */
  companyId: string | null;
  articleNumber: string;
  description: string;
  packaging: string;
  price: string;
  validFrom: string;
  validTo: string;
  note: string;
}

export type IssueLevel = "fout" | "let op";

export interface DraftIssue {
  level: IssueLevel;
  text: string;
}

export interface CheckedDraft extends ContractDraft {
  productId: string | null;
  productName: string | null;
  catalogPackaging: string | null;
  priceValue: number | null;
  issues: DraftIssue[];
  /** Ids van bestaande contracten die overlappen. */
  overlapsExisting: string[];
  /** Regelnummers in hetzelfde bestand die overlappen. */
  overlapsLines: number[];
  /** Zonder fouten (waarschuwingen mogen). */
  canSave: boolean;
}

function findByName(options: NamedOption[], text: string): NamedOption | null {
  const t = norm(text);
  if (!t) return null;
  return (
    options.find((o) => norm(o.name) === t) ??
    (() => {
      const hits = options.filter((o) => norm(o.name).startsWith(t) || t.startsWith(norm(o.name)));
      return hits.length === 1 ? hits[0] : null;
    })()
  );
}

/** Eerste keer: leverancier en bedrijf uit de tekst herkennen. */
export function toDrafts(
  rows: ContractSheetRow[],
  suppliers: NamedOption[],
  companies: NamedOption[],
): ContractDraft[] {
  return rows.map((r) => {
    const company = r.company.trim();
    const allCompanies = !company || /^(alle|groep|alle bedrijven|\*)$/i.test(company);
    return {
      line: r.line,
      supplierText: r.supplier,
      supplierId: findByName(suppliers, r.supplier)?.id ?? null,
      companyText: r.company,
      companyId: allCompanies ? "" : (findByName(companies, company)?.id ?? null),
      articleNumber: r.articleNumber,
      description: r.description,
      packaging: r.packaging,
      price: r.price,
      validFrom: r.validFrom,
      validTo: r.validTo,
      note: r.note,
    };
  });
}

/** Overlappen twee periodes (open einde = doorlopend)? */
export function periodsOverlap(
  a: { from: string; to: string | null },
  b: { from: string; to: string | null },
): boolean {
  const aTo = a.to || "9999-12-31";
  const bTo = b.to || "9999-12-31";
  return a.from <= bTo && b.from <= aTo;
}

/** Zelfde contractsleutel als de vergelijking: leverancier, bedrijf, artikel (of ingrediënt), verpakking. */
function sameKey(
  a: { supplierId: string | null; companyId: string | null; article: string; productId: string | null; packaging: string },
  b: { supplierId: string | null; companyId: string | null; article: string; productId: string | null; packaging: string },
): boolean {
  if (!a.supplierId || a.supplierId !== b.supplierId) return false;
  if ((a.companyId || null) !== (b.companyId || null)) return false;
  if (normalizePackaging(a.packaging) !== normalizePackaging(b.packaging)) return false;
  if (a.article || b.article) return a.article !== "" && a.article === b.article;
  return !!a.productId && a.productId === b.productId;
}

export function checkDrafts(
  drafts: ContractDraft[],
  ctx: { catalog: CatalogArticle[]; existing: ExistingContract[] },
): CheckedDraft[] {
  const catalog = new Map<string, CatalogArticle>();
  for (const a of ctx.catalog) {
    const k = `${a.supplierId}|${normalizeArticle(a.articleNumber)}`;
    if (!catalog.has(k)) catalog.set(k, a);
  }
  const checked: CheckedDraft[] = drafts.map((d) => {
    const issues: DraftIssue[] = [];
    if (!d.supplierId)
      issues.push({ level: "fout", text: d.supplierText ? `Leverancier "${d.supplierText}" niet gevonden` : "Leverancier ontbreekt" });
    if (d.companyId === null) issues.push({ level: "fout", text: `Bedrijf "${d.companyText}" niet gevonden` });
    const art = normalizeArticle(d.articleNumber);
    if (!art) issues.push({ level: "fout", text: "Artikelnummer ontbreekt" });
    const priceValue = parsePrice(d.price);
    if (priceValue === null) issues.push({ level: "fout", text: d.price ? `Prijs "${d.price}" is ongeldig` : "Prijs ontbreekt" });
    if (!isValidIsoDate(d.validFrom))
      issues.push({ level: "fout", text: d.validFrom ? `Ingangsdatum "${d.validFrom}" is ongeldig` : "Ingangsdatum ontbreekt" });
    if (d.validTo && !isValidIsoDate(d.validTo)) issues.push({ level: "fout", text: `Einddatum "${d.validTo}" is ongeldig` });
    else if (d.validTo && isValidIsoDate(d.validFrom) && d.validTo < d.validFrom)
      issues.push({ level: "fout", text: "Einddatum ligt vóór de ingangsdatum" });

    const hit = d.supplierId && art ? catalog.get(`${d.supplierId}|${art}`) : undefined;
    if (d.supplierId && art && !hit)
      issues.push({ level: "let op", text: "Artikelnummer niet gevonden bij deze leverancier (geen match met een ingrediënt)" });
    if (hit && d.packaging && hit.packaging && normalizePackaging(hit.packaging) !== normalizePackaging(d.packaging))
      issues.push({ level: "let op", text: `Verpakking wijkt af van de leverancier: ${hit.packaging}` });
    if (!d.packaging) issues.push({ level: "let op", text: "Verpakking niet ingevuld" });

    return {
      ...d,
      productId: hit?.productId ?? null,
      productName: hit?.productName ?? null,
      catalogPackaging: hit?.packaging ?? null,
      priceValue,
      issues,
      overlapsExisting: [],
      overlapsLines: [],
      canSave: false,
    };
  });

  const keyOf = (c: CheckedDraft) => ({
    supplierId: c.supplierId,
    companyId: c.companyId,
    article: normalizeArticle(c.articleNumber),
    productId: c.productId,
    packaging: c.packaging,
  });
  for (const c of checked) {
    if (!isValidIsoDate(c.validFrom)) continue;
    const period = { from: c.validFrom, to: c.validTo || null };
    for (const e of ctx.existing) {
      const ek = {
        supplierId: e.supplier_id,
        companyId: e.company_id,
        article: normalizeArticle(e.article_number),
        productId: e.product_id,
        packaging: e.packaging_description ?? "",
      };
      if (sameKey(keyOf(c), ek) && periodsOverlap(period, { from: e.valid_from, to: e.valid_to }))
        c.overlapsExisting.push(e.id);
    }
    for (const o of checked) {
      if (o === c || !isValidIsoDate(o.validFrom)) continue;
      if (sameKey(keyOf(c), keyOf(o)) && periodsOverlap(period, { from: o.validFrom, to: o.validTo || null }))
        c.overlapsLines.push(o.line);
    }
    if (c.overlapsExisting.length)
      c.issues.push({
        level: "let op",
        text: `Overlapt met ${c.overlapsExisting.length} bestaande contractprijs${c.overlapsExisting.length === 1 ? "" : "zen"}`,
      });
    if (c.overlapsLines.length)
      c.issues.push({ level: "let op", text: `Overlapt met regel ${c.overlapsLines.join(", ")} in dit bestand` });
  }
  for (const c of checked) c.canSave = !c.issues.some((i) => i.level === "fout");
  return checked;
}

/** Wat er in supplier_contract_prices wordt opgeslagen. */
export function draftToInsert(c: CheckedDraft) {
  return {
    supplier_id: c.supplierId!,
    company_id: c.companyId || null,
    product_id: c.productId,
    article_number: c.articleNumber.trim(),
    description: c.description.trim() || c.productName || null,
    packaging_description: c.packaging.trim() || null,
    price: c.priceValue!,
    valid_from: c.validFrom,
    valid_to: c.validTo || null,
    note: c.note.trim() || null,
  };
}

/** Kolommen van het voorbeeldbestand. */
export const TEMPLATE_HEADERS = [
  "Leverancier",
  "Bedrijf",
  "Artikelnummer",
  "Omschrijving",
  "Verpakking",
  "Prijs excl. btw",
  "Ingangsdatum",
  "Einddatum",
  "Notitie",
];

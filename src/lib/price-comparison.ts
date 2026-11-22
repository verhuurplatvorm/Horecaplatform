import type { PriceComparisonRow } from "@/lib/types/database";

export const PRIORITY_META: Record<
  PriceComparisonRow["priority"],
  { label: string; short: string; className: string; dot: string }
> = {
  1: {
    label: "Kritiek",
    short: "1 Kritiek",
    className: "bg-danger text-white",
    dot: "bg-danger",
  },
  2: {
    label: "Hoog",
    short: "2 Hoog",
    className: "bg-warning text-white",
    dot: "bg-warning",
  },
  3: {
    label: "Normaal",
    short: "3 Normaal",
    className: "bg-amber-100 text-amber-900",
    dot: "bg-amber-400",
  },
  4: {
    label: "Laag",
    short: "4 Laag",
    className: "bg-slate-100 text-slate-700",
    dot: "bg-slate-400",
  },
  5: {
    label: "Akkoord",
    short: "5 Akkoord",
    className: "bg-success/15 text-success",
    dot: "bg-success",
  },
};

export type ComparisonStatus =
  | "open"
  | "controle"
  | "betwist"
  | "geaccepteerd"
  | "akkoord"
  | "zonder_referentie";

export const STATUS_LABEL: Record<ComparisonStatus, string> = {
  open: "Open",
  controle: "Controle nodig",
  betwist: "Betwist",
  geaccepteerd: "Geaccepteerd",
  akkoord: "Akkoord",
  zonder_referentie: "Zonder referentieprijs",
};

/** Eén status per regel: een beoordeling gaat vóór de automatische status. */
export function statusOf(row: PriceComparisonRow): ComparisonStatus {
  // Zonder referentieprijs valt er niets te vergelijken of te beoordelen.
  if (hasNoReference(row)) return "zonder_referentie";
  if (row.review_status === "betwist") return "betwist";
  if (row.review_status === "geaccepteerd") return "geaccepteerd";
  if (row.needs_check) return "controle";
  if (row.priority === 5) return "akkoord";
  return "open";
}

/** Geen contract- of (vergelijkbare) prijslijstprijs gevonden. */
export function hasNoReference(row: PriceComparisonRow): boolean {
  return row.ref_source === "geen" || row.ref_price === null;
}

export interface ComparisonTotals {
  overcharged: number;
  favourable: number;
  net: number;
  disputed: number;
  critical: number;
  high: number;
  toCheck: number;
  /** Regels zonder referentieprijs: tellen nergens in mee. */
  noReference: number;
}

/**
 * Totalen zonder plussen en minnen tegen elkaar weg te strepen.
 * Regels met "Controle nodig" tellen niet mee in de bedragen (de vergelijking
 * is dan nog niet betrouwbaar), geaccepteerde regels ook niet, en regels
 * zonder referentieprijs al helemaal niet ("Mogelijk te veel betaald").
 */
export function computeTotals(rows: PriceComparisonRow[]): ComparisonTotals {
  const t: ComparisonTotals = {
    overcharged: 0,
    favourable: 0,
    net: 0,
    disputed: 0,
    critical: 0,
    high: 0,
    toCheck: 0,
    noReference: 0,
  };
  for (const r of rows) {
    const status = statusOf(r);
    if (status === "zonder_referentie") {
      t.noReference++;
      continue;
    }
    if (status === "controle") {
      t.toCheck++;
      continue;
    }
    if (status === "geaccepteerd") continue;
    const impact = Number(r.impact ?? 0);
    if (impact > 0) t.overcharged += impact;
    if (impact < 0) t.favourable += impact;
    if (status === "betwist" && impact > 0) t.disputed += impact;
    if (status === "open" && r.priority === 1) t.critical++;
    if (status === "open" && r.priority === 2) t.high++;
  }
  t.net = t.overcharged + t.favourable;
  return t;
}

const euroFmt = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});

export function euro(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined || Number.isNaN(Number(value)))
    return "—";
  const n = Number(value);
  const s = euroFmt.format(n);
  return signed && n > 0 ? `+${s}` : s;
}

export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  return `${n > 0 ? "+" : ""}${n.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

export type PeriodKey =
  "30d" | "deze_maand" | "vorige_maand" | "90d" | "dit_jaar" | "eigen";

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  "30d": "Laatste 30 dagen",
  deze_maand: "Deze maand",
  vorige_maand: "Vorige maand",
  "90d": "Laatste 3 maanden",
  dit_jaar: "Dit jaar",
  eigen: "Eigen periode",
};

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function periodRange(
  key: PeriodKey,
  custom: { from: string; to: string },
): { from: string; to: string } {
  const now = new Date();
  switch (key) {
    case "30d":
      return {
        from: iso(new Date(now.getTime() - 30 * 86400000)),
        to: iso(now),
      };
    case "90d":
      return {
        from: iso(new Date(now.getTime() - 91 * 86400000)),
        to: iso(now),
      };
    case "deze_maand":
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: iso(now),
      };
    case "vorige_maand":
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case "dit_jaar":
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
    case "eigen":
      return custom;
  }
}

// ---------------------------------------------------------------------------
// Filters van de pagina Prijsvergelijking. Andere schermen (dashboard,
// factuur) zetten hier een filter klaar en sturen dan door — zonder
// zoekparameters in de URL.

export const COMPARISON_FILTER_KEY = "prijsvergelijking-filters";

export type StatusFilter = "aandacht" | ComparisonStatus | "alles";
export type ComparisonView = "regels" | "artikelen" | "facturen";

export interface ComparisonFilters {
  period: PeriodKey;
  customFrom: string;
  customTo: string;
  supplier: string;
  priority: "alle" | "1" | "2" | "3" | "4" | "5";
  status: StatusFilter;
  minImpact: string;
  view: ComparisonView;
}

export const DEFAULT_COMPARISON_FILTERS: ComparisonFilters = {
  period: "90d",
  customFrom: "",
  customTo: "",
  supplier: "alle",
  priority: "alle",
  status: "aandacht",
  minImpact: "",
  view: "regels",
};

export function loadComparisonFilters(): ComparisonFilters {
  if (typeof window === "undefined") return DEFAULT_COMPARISON_FILTERS;
  try {
    const raw = window.sessionStorage.getItem(COMPARISON_FILTER_KEY);
    return raw
      ? { ...DEFAULT_COMPARISON_FILTERS, ...JSON.parse(raw) }
      : DEFAULT_COMPARISON_FILTERS;
  } catch {
    return DEFAULT_COMPARISON_FILTERS;
  }
}

/** Zet filters klaar voor de pagina Prijsvergelijking (vóór het doorklikken). */
export function presetComparisonFilters(
  patch: Partial<ComparisonFilters>,
): void {
  try {
    window.sessionStorage.setItem(
      COMPARISON_FILTER_KEY,
      JSON.stringify({ ...DEFAULT_COMPARISON_FILTERS, ...patch }),
    );
  } catch {
    /* geen sessionStorage: dan opent de pagina met de standaardfilters */
  }
}

/** Dashboardperiode in dagen → passende periode op de vergelijkingspagina. */
export function periodForDays(
  days: number,
): Pick<ComparisonFilters, "period" | "customFrom" | "customTo"> {
  if (days === 30) return { period: "30d", customFrom: "", customTo: "" };
  if (days === 90) return { period: "90d", customFrom: "", customTo: "" };
  const now = new Date();
  return {
    period: "eigen",
    customFrom: iso(new Date(now.getTime() - days * 86400000)),
    customTo: iso(now),
  };
}

export function daysAgoIso(days: number, from: Date = new Date()): string {
  return iso(new Date(from.getTime() - days * 86400000));
}

/** numeric-kolommen komen soms als tekst binnen; maak er getallen van. */
export function normalizeComparisonRow(
  r: PriceComparisonRow,
): PriceComparisonRow {
  return {
    ...r,
    quantity: r.quantity === null ? null : Number(r.quantity),
    invoice_price: Number(r.invoice_price),
    ref_price: r.ref_price === null ? null : Number(r.ref_price),
    ref_source: r.ref_source ?? (r.ref_price === null ? "geen" : "prijslijst"),
    diff_per_unit: r.diff_per_unit === null ? null : Number(r.diff_per_unit),
    diff_pct: r.diff_pct === null ? null : Number(r.diff_pct),
    impact: r.impact === null ? null : Number(r.impact),
    reasons: r.reasons ?? [],
  };
}

/** Te veel betaald (open + betwist), voor sorteren en tonen. */
export function overchargeOf(r: PriceComparisonRow): number {
  const s = statusOf(r);
  if (s === "controle" || s === "geaccepteerd" || s === "zonder_referentie") return 0;
  return Math.max(0, Number(r.impact ?? 0));
}

// ---------------------------------------------------------------------------
// Referentie in gewone taal

/** "Contract € 10,50 · geldig vanaf 1 okt 26" / "Prijslijst van 1 sep 26". */
export function referenceLabel(r: PriceComparisonRow): string {
  if (hasNoReference(r)) return "Geen referentieprijs";
  const to = r.ref_valid_to ? ` t/m ${shortDate(r.ref_valid_to)}` : "";
  return r.ref_source === "contract"
    ? `Contract, geldig vanaf ${shortDate(r.ref_date)}${to}`
    : `Prijslijst van ${shortDate(r.ref_date)}${to}`;
}

// ---------------------------------------------------------------------------
// Terugkerende open afwijkingen bundelen

export function normalizeArticle(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s/g, "").replace(/^0+/, "");
}

export function normalizePackaging(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s/g, "").replace(",", ".");
}

/** Open afwijking: nog niet beoordeeld, vergelijkbaar en niet gelijk aan de referentie. */
export function isOpenDeviation(r: PriceComparisonRow): boolean {
  return statusOf(r) === "open" && Math.abs(Number(r.diff_per_unit ?? 0)) >= 0.005;
}

export interface DeviationGroup {
  key: string;
  companyId: string | null;
  supplierId: string;
  supplierName: string;
  articleNumber: string | null;
  productName: string | null;
  packaging: string | null;
  rows: PriceComparisonRow[];
  /** Aantal factuurregels. */
  lineCount: number;
  /** Aantal verschillende facturen. */
  invoiceCount: number;
  /** Som van de afwijkingen (te veel positief, voordelig negatief). */
  totalDiff: number;
  /** Alleen het deel dat te veel is betaald. */
  overcharged: number;
  /** Laagste (= meest dringende) prioriteit in de groep. */
  topPriority: PriceComparisonRow["priority"];
  firstDate: string;
  lastDate: string;
}

/**
 * Bundelt open prijsafwijkingen per bedrijf, leverancier, artikelnummer en
 * verpakking. Zonder artikelnummer telt het gekoppelde ingrediënt. De
 * beoordeling blijft per factuurregel; dit is alleen een weergave.
 * Volgorde: terugkerend (meerdere facturen) eerst, dan het meeste te veel.
 */
export function groupDeviations(rows: PriceComparisonRow[]): DeviationGroup[] {
  const map = new Map<string, DeviationGroup>();
  for (const r of rows) {
    if (!isOpenDeviation(r)) continue;
    const art = r.article_key ?? normalizeArticle(r.article_number);
    const item = art ? `a:${art}` : `p:${r.product_id ?? normalizeArticle(r.description)}`;
    const key = [r.company_id ?? "-", r.supplier_id, item, normalizePackaging(r.packaging)].join("|");
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        companyId: r.company_id,
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        articleNumber: r.article_number,
        productName: r.product_name ?? r.description,
        packaging: r.packaging,
        rows: [],
        lineCount: 0,
        invoiceCount: 0,
        totalDiff: 0,
        overcharged: 0,
        topPriority: r.priority,
        firstDate: r.invoice_date,
        lastDate: r.invoice_date,
      };
      map.set(key, g);
    }
    g.rows.push(r);
  }
  for (const g of map.values()) {
    g.rows.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));
    g.lineCount = g.rows.length;
    g.invoiceCount = new Set(g.rows.map((r) => r.batch_id)).size;
    g.totalDiff = round2(g.rows.reduce((s, r) => s + Number(r.impact ?? 0), 0));
    g.overcharged = round2(g.rows.reduce((s, r) => s + Math.max(0, Number(r.impact ?? 0)), 0));
    g.topPriority = Math.min(...g.rows.map((r) => r.priority)) as PriceComparisonRow["priority"];
    g.firstDate = g.rows[0].invoice_date;
    g.lastDate = g.rows[g.rows.length - 1].invoice_date;
  }
  return [...map.values()].sort(
    (a, b) =>
      Number(b.invoiceCount > 1) - Number(a.invoiceCount > 1) ||
      b.overcharged - a.overcharged ||
      Math.abs(b.totalDiff) - Math.abs(a.totalDiff),
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

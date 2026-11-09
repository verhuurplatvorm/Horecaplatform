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
  "open" | "controle" | "betwist" | "geaccepteerd" | "akkoord";

export const STATUS_LABEL: Record<ComparisonStatus, string> = {
  open: "Open",
  controle: "Controle nodig",
  betwist: "Betwist",
  geaccepteerd: "Geaccepteerd",
  akkoord: "Akkoord",
};

/** Eén status per regel: een beoordeling gaat vóór de automatische status. */
export function statusOf(row: PriceComparisonRow): ComparisonStatus {
  if (row.review_status === "betwist") return "betwist";
  if (row.review_status === "geaccepteerd") return "geaccepteerd";
  if (row.needs_check) return "controle";
  if (row.priority === 5) return "akkoord";
  return "open";
}

export interface ComparisonTotals {
  overcharged: number;
  favourable: number;
  net: number;
  disputed: number;
  critical: number;
  high: number;
  toCheck: number;
}

/**
 * Totalen zonder plussen en minnen tegen elkaar weg te strepen.
 * Regels met "Controle nodig" tellen niet mee in de bedragen (de vergelijking
 * is dan nog niet betrouwbaar) en geaccepteerde regels ook niet.
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
  };
  for (const r of rows) {
    const status = statusOf(r);
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
export type ComparisonView = "regels" | "facturen";

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
    ref_price: Number(r.ref_price),
    diff_per_unit: Number(r.diff_per_unit),
    diff_pct: r.diff_pct === null ? null : Number(r.diff_pct),
    impact: r.impact === null ? null : Number(r.impact),
    reasons: r.reasons ?? [],
  };
}

/** Te veel betaald (open + betwist), voor sorteren en tonen. */
export function overchargeOf(r: PriceComparisonRow): number {
  const s = statusOf(r);
  if (s === "controle" || s === "geaccepteerd") return 0;
  return Math.max(0, Number(r.impact ?? 0));
}

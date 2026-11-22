/**
 * Afval & personeelsmaaltijden: één definitie van "bedrijf" en "periode"
 * voor het overzicht, de snelinvoer en de doorklik vanaf het dashboard.
 *
 * Datums zijn kalenderdagen in Europe/Amsterdam (zoals waste_overview in de
 * database), nooit UTC — anders valt een registratie om 00:30 op gisteren.
 *
 * URL: ?bedrijf=<id,id>&periode=vandaag|week|vorigeweek|maand
 *      of ?bedrijf=…&dagen=30 (zoals het dashboard: laatste 30 dagen t/m vandaag).
 */

export type PeriodKey = "vandaag" | "week" | "vorigeweek" | "maand" | "dagen";

export interface WastePeriod {
  key: PeriodKey;
  /** Alleen bij key "dagen". */
  days?: number;
}

export interface WasteFilter {
  /** null = alle bedrijven. */
  companyIds: string[] | null;
  period: WastePeriod;
}

export const PERIOD_PRESETS: { key: Exclude<PeriodKey, "dagen">; label: string }[] = [
  { key: "vandaag", label: "Vandaag" },
  { key: "week", label: "Deze week" },
  { key: "vorigeweek", label: "Vorige week" },
  { key: "maand", label: "Deze maand" },
];

/** Vandaag in Amsterdam als YYYY-MM-DD. */
export function amsterdamToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Maandag = 0 … zondag = 6. */
function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** Van/tot (beide inclusief) voor een periode. */
export function periodRange(p: WastePeriod, today: string = amsterdamToday()): { from: string; to: string } {
  switch (p.key) {
    case "vandaag":
      return { from: today, to: today };
    case "week":
      return { from: addDays(today, -weekdayIndex(today)), to: today };
    case "vorigeweek": {
      const from = addDays(today, -weekdayIndex(today) - 7);
      return { from, to: addDays(from, 6) };
    }
    case "maand":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "dagen": {
      const n = Math.max(1, Math.floor(p.days ?? 30));
      return { from: addDays(today, -n + 1), to: today };
    }
  }
}

/** Zelfde lengte direct ervoor (voor "t.o.v. vorige periode"). */
export function previousRange(r: { from: string; to: string }): { from: string; to: string } {
  const len = Math.round((Date.parse(`${r.to}T12:00:00Z`) - Date.parse(`${r.from}T12:00:00Z`)) / 86_400_000) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

export function periodLabel(p: WastePeriod): string {
  if (p.key === "dagen") return `Laatste ${p.days} dagen`;
  return PERIOD_PRESETS.find((x) => x.key === p.key)?.label ?? "";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filter uit de URL; zonder parameters: alle bedrijven, deze maand. */
export function parseWasteFilter(params: { get(name: string): string | null }): WasteFilter {
  const ids = (params.get("bedrijf") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
  const days = Number(params.get("dagen"));
  const preset = params.get("periode");
  let period: WastePeriod = { key: "maand" };
  if (Number.isFinite(days) && days > 0) period = { key: "dagen", days: Math.floor(days) };
  else if (preset && PERIOD_PRESETS.some((p) => p.key === preset)) period = { key: preset as PeriodKey };
  return { companyIds: ids.length ? ids : null, period };
}

/** Link naar het afvaloverzicht met precies deze filters. */
export function wasteHref(f: WasteFilter, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(extra);
  if (f.companyIds?.length) q.set("bedrijf", f.companyIds.join(","));
  if (f.period.key === "dagen") q.set("dagen", String(f.period.days ?? 30));
  else q.set("periode", f.period.key);
  return `/afval?${q.toString()}`;
}

/** Totalen over regels (zelfde som op overzicht en dashboard). */
export function wasteTotals(
  rows: { waste_value: number | null; quantity: number; unit_dimension: string | null; factor_to_base: number | null; unit_name: string | null }[],
) {
  let value = 0;
  let kg = 0;
  let liter = 0;
  let pieces = 0;
  for (const r of rows) {
    value += Number(r.waste_value ?? 0);
    // Zelfde rekenregel als waste_summary: factor_to_base rekent naar g/ml.
    const base = Number(r.quantity) * Number(r.factor_to_base ?? 1);
    if (r.unit_dimension === "gewicht") kg += base / 1000;
    else if (r.unit_dimension === "inhoud") liter += base / 1000;
    else if (r.unit_dimension === "aantal") pieces += Number(r.quantity);
  }
  return { value, count: rows.length, kg, liter, pieces };
}

/**
 * Doorkliks vanaf het dashboard: dezelfde filters (bedrijf, actuele kaart,
 * periode, leverancier, categorie) gaan mee in de URL, zodat de
 * bestemmingspagina precies dezelfde lijst toont als de teller telt.
 *
 * bedrijf ontbreekt = alle bedrijven.
 */

export interface DashboardScope {
  /** null = alle bedrijven. */
  companyIds: string[] | null;
  onlyCurrent: boolean;
  days?: number;
  supplierName?: string | null;
  category?: string | null;
}

export function dashboardHref(path: string, scope: DashboardScope, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  if (scope.companyIds && scope.companyIds.length > 0) params.set("bedrijf", scope.companyIds.join(","));
  if (scope.onlyCurrent) params.set("kaart", "actueel");
  if (scope.days) params.set("dagen", String(scope.days));
  if (scope.supplierName) params.set("leverancier", scope.supplierName);
  if (scope.category) params.set("categorie", scope.category);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ParamSource = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

function read(src: ParamSource, name: string): string | null {
  if (typeof (src as { get?: unknown }).get === "function") return (src as { get(n: string): string | null }).get(name);
  const v = (src as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** Filters uit de URL van een bestemmingspagina (client: useSearchParams; server: searchParams). */
export function parseDashboardScope(src: ParamSource): DashboardScope {
  const bedrijf = read(src, "bedrijf");
  // Alleen geldige uuid's: de waarde komt uit de URL.
  const ids = bedrijf
    ? bedrijf.split(",").map((s) => s.trim()).filter((s) => UUID_RE.test(s))
    : [];
  const days = Number(read(src, "dagen"));
  return {
    companyIds: ids.length ? ids : null,
    onlyCurrent: read(src, "kaart") === "actueel",
    days: Number.isFinite(days) && days > 0 ? days : undefined,
    supplierName: read(src, "leverancier") || null,
    category: read(src, "categorie") || null,
  };
}

/** Korte omschrijving van de filters, voor de balk boven de bestemmingslijst. */
export function describeScope(
  scope: DashboardScope,
  companyName: (id: string) => string | undefined,
  menuRelevant = true,
): string {
  const parts: string[] = [];
  parts.push(
    scope.companyIds ? scope.companyIds.map((id) => companyName(id) ?? "onbekend bedrijf").join(", ") : "Alle bedrijven",
  );
  if (menuRelevant) parts.push(scope.onlyCurrent ? "actuele kaart" : "alle recepten");
  if (scope.days) parts.push(`laatste ${scope.days} dagen`);
  if (scope.supplierName) parts.push(scope.supplierName);
  if (scope.category) parts.push(scope.category);
  return parts.join(" · ");
}

/** Bedrijven uit de bedrijfskeuze: groepsweergave = alle bedrijven (null). */
export function scopeCompanyIds(scope: { mode: string }, activeCompanyIds: string[]): string[] | null {
  return scope.mode === "group" || activeCompanyIds.length === 0 ? null : activeCompanyIds;
}

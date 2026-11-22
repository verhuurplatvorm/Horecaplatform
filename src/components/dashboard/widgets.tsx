"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, TriangleAlert, X } from "lucide-react";
import { DashboardWidget, WidgetTable } from "./dashboard-widget";
import { periodRange, previousRange, wasteHref, wasteTotals, type WasteFilter } from "@/lib/waste/period";
import type { WasteOverviewRow } from "@/lib/types/database";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { withReturnTo } from "@/lib/use-return-navigation";
import { cn } from "@/lib/utils";
import { countUnmatchedNames, priceAlertCount, type PriceAlerts } from "@/lib/dashboard-data";
import type { DashboardMarginProblemRow } from "@/lib/types/database";

interface Filters {
  companyId: string | null;
  days: number;
  supplierName: string | null;
  category: string | null;
  /** Alleen de actuele kaart: actieve menukaarten + actuele halfproducten. */
  onlyCurrent?: boolean;
}

/** Blok 1/2/3: prijswijzigingen, grootste stijgers/dalers en prijsalarmen. */
export function PriceChangesWidget({
  filters,
  direction,
  title,
  widgetId,
  alertsOnly,
  onHide,
  hidden,
}: {
  filters: Filters;
  direction: "alle" | "stijging" | "daling";
  title: string;
  widgetId: string;
  alertsOnly?: boolean;
  onHide?: (id: string) => void;
  hidden?: boolean;
}) {
  const [rows, setRows] = useState<
    {
      product_id: string;
      product_name: string;
      supplier_name: string | null;
      old_price: number;
      new_price: number;
      difference_eur: number;
      difference_pct: number;
      changed_on: string;
      above_alert: boolean;
      price_row_id: string;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);

  // Een onterecht alarm (bv. met een verkeerd gewicht gerekend) weghalen.
  // De prijshistorie blijft bestaan; alleen het alarm verdwijnt.
  async function dismissAlert(priceRowId: string) {
    const { error } = await createClient()
      .from("dismissed_price_alerts")
      .upsert({ supplier_product_id: priceRowId }, { onConflict: "supplier_product_id" });
    if (error) {
      window.alert("Alarm weghalen is niet gelukt: " + error.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.price_row_id !== priceRowId));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    createClient()
      .rpc("dashboard_price_changes_scoped", {
        p_days: filters.days,
        p_limit: alertsOnly ? 25 : 10,
        p_direction: direction,
        p_only_current: Boolean(filters.onlyCurrent),
      })
      .then(({ data }) => {
        if (cancelled) return;
        let list = data ?? [];
        if (alertsOnly) list = list.filter((r) => r.above_alert);
        if (filters.supplierName) {
          list = list.filter((r) => r.supplier_name === filters.supplierName);
        }
        setRows(list);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters.days, filters.supplierName, filters.onlyCurrent, direction, alertsOnly]);

  return (
    <DashboardWidget
      id={widgetId}
      title={title}
      count={alertsOnly ? rows.length : null}
      href="/leveranciers/prijzen/wijzigingen"
      hidden={hidden}
      onHide={onHide}
    >
      <WidgetTable
        loading={loading}
        empty={
          alertsOnly
            ? "Geen prijswijzigingen boven de alarmgrens."
            : "Geen prijswijzigingen in deze periode."
        }
        headers={
          alertsOnly
            ? ["Ingrediënt", "Leverancier", "Oud → nieuw", "Verschil", "Datum", ""]
            : ["Ingrediënt", "Leverancier", "Oud → nieuw", "Verschil", "Datum"]
        }
      >
        {rows.map((r) => (
          <tr key={`${r.price_row_id}`} className="border-t border-border">
            <td className="px-4 py-2 font-medium">
              <Link
                href={withReturnTo(`/producten/${r.product_id}/bewerken`)}
                className="hover:text-teal hover:underline"
              >
                {r.above_alert && (
                  <TriangleAlert className="mr-1 inline h-3.5 w-3.5 text-copper" />
                )}
                {r.product_name}
              </Link>
            </td>
            <td className="px-4 py-2 text-muted">{r.supplier_name ?? "—"}</td>
            <td className="px-4 py-2 text-right tabular text-xs">
              <span className="text-muted line-through">€ {r.old_price.toFixed(2)}</span> → €{" "}
              {r.new_price.toFixed(2)}
            </td>
            <td className="px-4 py-2 text-right tabular">
              <span
                className={cn(
                  "inline-flex items-center gap-0.5",
                  r.difference_pct > 0 ? "text-danger" : "text-success",
                  r.above_alert && "font-semibold"
                )}
              >
                {r.difference_pct > 0 ? (
                  <ArrowUp className="h-3 w-3" />
                ) : (
                  <ArrowDown className="h-3 w-3" />
                )}
                {Math.abs(r.difference_pct).toFixed(1)}%
              </span>
              <span className="ml-1 text-xs text-muted">
                ({r.difference_eur > 0 ? "+" : ""}
                {r.difference_eur.toFixed(2)})
              </span>
            </td>
            <td className="px-4 py-2 text-right text-xs text-muted">
              {new Date(r.changed_on).toLocaleDateString("nl-NL")}
            </td>
            {alertsOnly && (
              <td className="px-2 py-2 text-right">
                <button
                  type="button"
                  onClick={() => dismissAlert(r.price_row_id)}
                  className="text-muted hover:text-danger"
                  title="Alarm verwijderen (de prijs zelf blijft staan)"
                  aria-label="Alarm verwijderen"
                >
                  <X className="h-4 w-4" />
                </button>
              </td>
            )}
          </tr>
        ))}
      </WidgetTable>
    </DashboardWidget>
  );
}

/**
 * Blok 4: gerechten met een margeprobleem. De rijen komen van het
 * dashboard (fetchMarginProblems), zodat blok en tegel precies hetzelfde
 * tellen; "Alles bekijken" opent Gerechten met hetzelfde filter.
 */
export function MarginProblemsWidget({
  rows,
  loading,
  href,
  onHide,
  hidden,
}: {
  rows: DashboardMarginProblemRow[];
  loading: boolean;
  href: string;
  onHide?: (id: string) => void;
  hidden?: boolean;
}) {
  const shown = rows.slice(0, 15);
  const norm = rows[0]?.norm_pct ?? 33;
  return (
    <DashboardWidget
      id="marge"
      title="Gerechten met een margeprobleem"
      count={loading ? null : rows.length}
      href={href}
      hidden={hidden}
      onHide={onHide}
    >
      <WidgetTable
        loading={loading}
        empty="Geen gerechten boven de foodcostnorm (met een volledige kostprijs)."
        headers={["Gerecht", "Bedrijf", "Kostprijs", "Verkoop excl.", "Foodcost", "Marge"]}
      >
        {shown.map((r) => (
          <tr key={r.recipe_id} className="border-t border-border">
            <td className="px-4 py-2 font-medium">
              <Link
                href={withReturnTo(`/recepturen/${r.recipe_id}/bewerken`)}
                className="hover:text-teal hover:underline"
              >
                {r.recipe_name}
              </Link>
              {r.category && <span className="ml-1 text-xs text-muted">{r.category}</span>}
            </td>
            <td className="px-4 py-2 text-muted">{r.company_name}</td>
            <td className="px-4 py-2 text-right tabular">€ {r.cost_price.toFixed(2)}</td>
            <td className="px-4 py-2 text-right tabular">€ {r.sales_price.toFixed(2)}</td>
            <td className="px-4 py-2 text-right tabular font-semibold text-danger">
              {r.foodcost_pct.toFixed(1)}%
            </td>
            <td className="px-4 py-2 text-right tabular text-muted">
              {r.margin_pct.toFixed(1)}%
            </td>
          </tr>
        ))}
      </WidgetTable>
      {!loading && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted">
          Foodcost boven {norm}% en een volledige kostprijs. Gerechten met &ldquo;Kostprijs
          onvolledig&rdquo; tellen hier niet mee.
          {rows.length > shown.length && (
            <>
              {" "}
              <Link href={href} className="text-teal hover:underline">
                Alle {rows.length} bekijken →
              </Link>
            </>
          )}
        </p>
      )}
    </DashboardWidget>
  );
}

/** Blok: prijsalarmen — zelfde gegevens als de tegel "Prijsalarmen". */
export function PriceAlertsWidget({
  data,
  loading,
  href,
  onHide,
  hidden,
  onDismissed,
}: {
  data: PriceAlerts;
  loading: boolean;
  href: string;
  onHide?: (id: string) => void;
  hidden?: boolean;
  onDismissed: (priceRowId: string) => void;
}) {
  // Een onterecht alarm (bv. met een verkeerd gewicht gerekend) weghalen.
  // De prijshistorie blijft bestaan; alleen het alarm verdwijnt.
  async function dismissAlert(priceRowId: string) {
    const { error } = await createClient()
      .from("dismissed_price_alerts")
      .upsert({ supplier_product_id: priceRowId }, { onConflict: "supplier_product_id" });
    if (error) {
      window.alert("Alarm weghalen is niet gelukt: " + error.message);
      return;
    }
    onDismissed(priceRowId);
  }
  const total = priceAlertCount(data);
  return (
    <DashboardWidget
      id="alarmen"
      title="Prijsalarmen"
      count={loading ? null : total}
      href={href}
      hidden={hidden}
      onHide={onHide}
    >
      <WidgetTable
        loading={loading}
        empty="Geen prijsalarmen in deze periode."
        headers={["Ingrediënt", "Leverancier", "Oud → nieuw", "Verschil", "Datum", ""]}
      >
        {data.alerts.slice(0, 25).map((r) => (
          <tr key={r.price_row_id} className="border-t border-border">
            <td className="px-4 py-2 font-medium">
              <Link
                href={withReturnTo(`/producten/${r.product_id}/bewerken`)}
                className="hover:text-teal hover:underline"
              >
                <TriangleAlert className="mr-1 inline h-3.5 w-3.5 text-copper" />
                {r.product_name}
              </Link>
            </td>
            <td className="px-4 py-2 text-muted">{r.supplier_name ?? "—"}</td>
            <td className="px-4 py-2 text-right tabular text-xs">
              <span className="text-muted line-through">€ {r.old_price.toFixed(2)}</span> → €{" "}
              {r.new_price.toFixed(2)}
            </td>
            <td className="px-4 py-2 text-right tabular">
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 font-semibold",
                  r.difference_pct > 0 ? "text-danger" : "text-success"
                )}
              >
                {r.difference_pct > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {Math.abs(r.difference_pct).toFixed(1)}%
              </span>
            </td>
            <td className="px-4 py-2 text-right text-xs text-muted">
              {new Date(r.changed_on).toLocaleDateString("nl-NL")}
            </td>
            <td className="px-2 py-2 text-right">
              <button
                type="button"
                onClick={() => dismissAlert(r.price_row_id)}
                className="text-muted hover:text-danger"
                title="Alarm verwijderen (de prijs zelf blijft staan)"
                aria-label="Alarm verwijderen"
              >
                <X className="h-4 w-4" />
              </button>
            </td>
          </tr>
        ))}
      </WidgetTable>
      {!loading && data.agreed.length > 0 && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted">
          Plus {data.agreed.length} factuurregel{data.agreed.length === 1 ? "" : "s"} die afwijk
          {data.agreed.length === 1 ? "t" : "en"} van een afgesproken prijs.{" "}
          <Link href={href} className="text-teal hover:underline">
            Bekijken →
          </Link>
        </p>
      )}
    </DashboardWidget>
  );
}

export interface UnmatchedLine {
  line_id: string;
  recipe_id: string;
  recipe_name: string;
  recipe_kind: string;
  name: string | null;
  unit_name: string | null;
}

/**
 * Blok 6: niet-gekoppelde receptregels (regels zonder ingrediënt of
 * halfproduct). Zelfde rijen als de tegel; koppelen gebeurt in één keer
 * per naam in Opschonen.
 */
export function UnmatchedIngredientsWidget({
  lines,
  loading,
  href,
  onHide,
  hidden,
}: {
  lines: UnmatchedLine[];
  loading: boolean;
  href: string;
  onHide?: (id: string) => void;
  hidden?: boolean;
}) {
  const names = countUnmatchedNames(lines);
  return (
    <DashboardWidget
      id="nietherkend"
      title="Niet-gekoppelde receptregels"
      count={loading ? null : lines.length}
      href={href}
      hidden={hidden}
      onHide={onHide}
    >
      <WidgetTable
        loading={loading}
        empty="Alle receptregels zijn gekoppeld aan een ingrediënt of halfproduct."
        headers={["Naam in recept", "Recept", "Eenheid", ""]}
      >
        {lines.slice(0, 20).map((r) => {
          const recipeHref = withReturnTo(
            r.recipe_kind === "halfproduct"
              ? `/halfproducten/${r.recipe_id}/bewerken`
              : `/recepturen/${r.recipe_id}/bewerken`
          );
          return (
            <tr key={r.line_id} className="border-t border-border">
              <td className="px-4 py-2 font-medium">{r.name ?? "—"}</td>
              <td className="px-4 py-2 text-muted">
                <Link href={recipeHref} className="hover:text-teal hover:underline">
                  {r.recipe_name}
                </Link>
              </td>
              <td className="px-4 py-2 text-muted">{r.unit_name ?? ""}</td>
              <td className="px-4 py-2 text-right">
                <Link href={recipeHref} className="text-xs text-teal hover:underline">
                  Openen →
                </Link>
              </td>
            </tr>
          );
        })}
      </WidgetTable>
      {!loading && lines.length > 0 && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted">
          {lines.length} regel{lines.length === 1 ? "" : "s"} met {names} verschillende na
          {names === 1 ? "am" : "men"}.{" "}
          <Link href={href} className="text-teal hover:underline">
            Per naam koppelen in Opschonen →
          </Link>
        </p>
      )}
    </DashboardWidget>
  );
}

/** Blok 9/10: aankomende menu's, met wat er geproduceerd en besteld moet worden. */
export function UpcomingMenusWidget({
  filters,
  onHide,
  hidden,
}: {
  filters: Filters;
  onHide?: (id: string) => void;
  hidden?: boolean;
}) {
  const [rows, setRows] = useState<
    {
      id: string;
      name: string;
      service_date: string | null;
      person_count: number;
      sales_price_per_person: number | null;
      vat_rate: number;
      cost: number | null;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data } = await supabase
        .from("event_menus")
        .select("id, name, service_date, person_count, sales_price_per_person, vat_rate")
        .gte("service_date", new Date().toISOString().slice(0, 10))
        .in("status", ["concept", "definitief"])
        .order("service_date")
        .limit(8);
      if (cancelled) return;

      const withCost = await Promise.all(
        (data ?? []).map(async (m) => {
          let cost: number | null = null;
          if (filters.companyId) {
            const { data: c } = await supabase.rpc("calculate_event_menu_cost", {
              p_menu_id: m.id,
              p_company_id: filters.companyId,
            });
            cost = (c as number | null) ?? null;
          }
          return { ...m, cost };
        })
      );
      if (!cancelled) {
        setRows(withCost);
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [filters.companyId]);

  return (
    <DashboardWidget
      id="menus"
      title="Aankomende menu's & buffetten"
      count={rows.length}
      href="/menus"
      hidden={hidden}
      onHide={onHide}
    >
      <WidgetTable
        loading={loading}
        empty="Geen aankomende menu's of buffetten."
        headers={["Menu", "Datum", "Personen", "Kostprijs p.p.", "Foodcost", ""]}
      >
        {rows.map((m) => {
          const cpp = m.cost !== null && m.person_count > 0 ? m.cost / m.person_count : null;
          const exclVat = m.sales_price_per_person
            ? m.sales_price_per_person / (1 + m.vat_rate / 100)
            : null;
          const fc = cpp !== null && exclVat && exclVat > 0 ? (cpp / exclVat) * 100 : null;
          return (
            <tr key={m.id} className="border-t border-border">
              <td className="px-4 py-2 font-medium">
                <Link href={`/menus/${m.id}`} className="hover:text-teal hover:underline">
                  {m.name}
                </Link>
              </td>
              <td className="px-4 py-2 text-muted">
                {m.service_date
                  ? new Date(m.service_date).toLocaleDateString("nl-NL")
                  : "—"}
              </td>
              <td className="px-4 py-2 text-right tabular">{m.person_count}</td>
              <td className="px-4 py-2 text-right tabular">
                {cpp !== null ? `€ ${cpp.toFixed(2)}` : "—"}
              </td>
              <td className="px-4 py-2 text-right tabular">
                {fc !== null ? (
                  <span className={fc > 33 ? "text-danger" : "text-success"}>
                    {fc.toFixed(1)}%
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-2 text-right">
                <Link
                  href={`/menus/${m.id}`}
                  className="whitespace-nowrap text-xs text-teal hover:underline"
                >
                  Werklijst →
                </Link>
              </td>
            </tr>
          );
        })}
      </WidgetTable>
    </DashboardWidget>
  );
}

/** Blok 8: leveranciers met hun laatste prijswijziging en aantal artikelen. */
export function SuppliersWidget({
  onHide,
  hidden,
}: {
  onHide?: (id: string) => void;
  hidden?: boolean;
}) {
  const [rows, setRows] = useState<
    { id: string; name: string; productCount: number; lastChange: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const [{ data: suppliers }, { data: prices }] = await Promise.all([
        supabase.from("suppliers").select("id, name").order("name"),
        supabase
          .from("supplier_products")
          .select("supplier_id, valid_from")
          .is("valid_to", null),
      ]);
      if (cancelled) return;

      const counts = new Map<string, { n: number; last: string | null }>();
      for (const p of prices ?? []) {
        if (!p.supplier_id) continue;
        const e = counts.get(p.supplier_id) ?? { n: 0, last: null };
        e.n++;
        if (!e.last || p.valid_from > e.last) e.last = p.valid_from;
        counts.set(p.supplier_id, e);
      }
      setRows(
        (suppliers ?? [])
          .map((s) => ({
            id: s.id,
            name: s.name,
            productCount: counts.get(s.id)?.n ?? 0,
            lastChange: counts.get(s.id)?.last ?? null,
          }))
          .sort((a, b) => b.productCount - a.productCount)
          .slice(0, 10)
      );
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DashboardWidget
      id="leveranciers"
      title="Leveranciers"
      href="/leveranciers"
      hidden={hidden}
      onHide={onHide}
    >
      <WidgetTable
        loading={loading}
        empty="Nog geen leveranciers."
        headers={["Leverancier", "", "Artikelen", "Laatste prijs"]}
      >
        {rows.map((s) => (
          <tr key={s.id} className="border-t border-border">
            <td className="px-4 py-2 font-medium">
              <Link
                href={withReturnTo(`/leveranciers/${s.id}/bewerken`)}
                className="hover:text-teal hover:underline"
              >
                {s.name}
              </Link>
            </td>
            <td />
            <td className="px-4 py-2 text-right tabular">{s.productCount}</td>
            <td className="px-4 py-2 text-right text-xs text-muted">
              {s.lastChange
                ? new Date(s.lastChange).toLocaleDateString("nl-NL")
                : "—"}
            </td>
          </tr>
        ))}
      </WidgetTable>
    </DashboardWidget>
  );
}

/**
 * Dashboardpaneel Afvalregistratie: waarde, aantallen en wat eruit springt.
 * Toont uitsluitend werkelijk geregistreerde afvaldata — er wordt niets
 * geschat en er zit geen voorraad in.
 */
export function WasteWidget({
  filters,
  companyIds,
  onHide,
  hidden,
}: {
  filters: Filters;
  /** null = alle bedrijven; zelfde bedrijfskeuze als de andere tellers. */
  companyIds: string[] | null;
  onHide?: (id: string) => void;
  hidden?: boolean;
}) {
  const [summary, setSummary] = useState<{
    total_value: number;
    registration_count: number;
    total_kg: number;
    total_liter: number;
    total_pieces: number;
    previous_value: number;
    ingredient_value: number;
    halfproduct_value: number;
  } | null>(null);
  const [topProducts, setTopProducts] = useState<{ name: string; value: number }[]>([]);
  const [topReasons, setTopReasons] = useState<{ name: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const companyKey = companyIds ? companyIds.join(",") : "alle";
  // Zelfde filter als het afvaloverzicht na doorklikken: bedrijf + laatste N dagen.
  const wasteFilter: WasteFilter = useMemo(
    () => ({
      companyIds: companyKey === "alle" ? null : companyKey.split(","),
      period: { key: "dagen", days: filters.days },
    }),
    [companyKey, filters.days],
  );

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      const supabase = createClient();
      const range = periodRange(wasteFilter.period);
      const prev = previousRange(range);
      const [{ data: cur }, { data: before }] = await Promise.all([
        supabase.rpc("waste_overview", {
          p_company_ids: wasteFilter.companyIds,
          p_from: range.from,
          p_to: range.to,
          p_type: "afval",
        }),
        supabase.rpc("waste_overview", {
          p_company_ids: wasteFilter.companyIds,
          p_from: prev.from,
          p_to: prev.to,
          p_type: "afval",
        }),
      ]);
      if (cancelled) return;
      const rows = (cur as WasteOverviewRow[]) ?? [];
      const t = wasteTotals(rows);
      setSummary({
        total_value: t.value,
        registration_count: t.count,
        total_kg: t.kg,
        total_liter: t.liter,
        total_pieces: t.pieces,
        previous_value: wasteTotals((before as WasteOverviewRow[]) ?? []).value,
        ingredient_value: wasteTotals(rows.filter((r) => r.product_id)).value,
        halfproduct_value: wasteTotals(rows.filter((r) => r.recipe_id)).value,
      });
      const byProduct = new Map<string, number>();
      const byReason = new Map<string, number>();
      for (const r of rows) {
        const v = Number(r.waste_value ?? 0);
        if (r.item_name) byProduct.set(r.item_name, (byProduct.get(r.item_name) ?? 0) + v);
        if (r.reason_name) byReason.set(r.reason_name, (byReason.get(r.reason_name) ?? 0) + v);
      }
      const top = (m: Map<string, number>) =>
        [...m.entries()]
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5);
      setTopProducts(top(byProduct));
      setTopReasons(top(byReason));
      setLoading(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [wasteFilter]);
  const href = wasteHref(wasteFilter);

  const delta =
    summary && summary.previous_value > 0
      ? ((summary.total_value - summary.previous_value) / summary.previous_value) * 100
      : null;

  return (
    <DashboardWidget
      id="afval"
      title="Afvalregistratie"
      href={href}
      hidden={hidden}
      onHide={onHide}
    >
      {loading ? (
        <p className="px-4 py-6 text-center text-sm text-muted">Laden…</p>
      ) : !summary || summary.registration_count === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">
          Nog geen afval geregistreerd in deze periode.
        </p>
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <Link href={href} className="hover:underline">
              <span className="tabular text-2xl font-semibold text-danger">
                € {summary.total_value.toFixed(2)}
              </span>
            </Link>
            {delta !== null && (
              <span
                className={cn(
                  "flex items-center gap-0.5 text-sm",
                  delta > 0 ? "text-danger" : "text-success"
                )}
              >
                {delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {Math.abs(delta).toFixed(0)}% t.o.v. vorige periode
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Metric label="Registraties" value={String(summary.registration_count)} />
            <Metric label="Kilo" value={summary.total_kg.toFixed(1)} />
            <Metric label="Liter" value={summary.total_liter.toFixed(1)} />
            <Metric label="Stuks" value={summary.total_pieces.toFixed(0)} />
          </div>

          {delta !== null && delta > 25 && (
            <p className="flex items-start gap-1.5 rounded-md bg-copper/10 p-2 text-xs text-copper">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              De afvalwaarde ligt {delta.toFixed(0)}% hoger dan de vorige periode.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-muted">
                Meeste waarde
              </p>
              <ul className="space-y-0.5 text-sm">
                {topProducts.map((p) => (
                  <li key={p.name} className="flex justify-between gap-2">
                    <span className="truncate">{p.name}</span>
                    <span className="tabular shrink-0 text-muted">
                      € {p.value.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-muted">Redenen</p>
              <ul className="space-y-0.5 text-sm">
                {topReasons.map((r) => (
                  <li key={r.name} className="flex justify-between gap-2">
                    <span className="truncate">{r.name}</span>
                    <span className="tabular shrink-0 text-muted">
                      € {r.value.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="text-xs text-muted">
            Ingrediënten € {summary.ingredient_value.toFixed(2)} · halfproducten €{" "}
            {summary.halfproduct_value.toFixed(2)}
          </p>
        </div>
      )}
    </DashboardWidget>
  );
}

/** Blok: Factuurmailbox — hoeveel e-mailfacturen in welke status, met
 * signalering zodra er iets met 'Controle nodig', 'Fout' of 'Dubbele
 * factuur' binnen is gekomen. */
export function MailboxWidget({
  filters,
  onHide,
  hidden,
}: {
  filters: Filters;
  onHide?: (id: string) => void;
  hidden?: boolean;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      const supabase = createClient();
      const groupId = await getCurrentGroupId(supabase);
      if (!groupId) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { data } = await supabase.rpc("mailbox_status_summary", {
        p_group_id: groupId,
        p_company_id: filters.companyId,
        p_days: filters.days,
      });
      if (cancelled) return;
      const map: Record<string, number> = {};
      for (const row of data ?? []) map[row.status] = row.aantal;
      setCounts(map);
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [filters.companyId, filters.days]);

  const needsAttention =
    (counts.wacht_op_leverancier ?? 0) + (counts.fout ?? 0) + (counts.dubbele_factuur ?? 0);
  const verwerkt = counts.verwerkt ?? 0;
  const totaal = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <DashboardWidget
      id="factuurmailbox"
      title="Factuurmailbox"
      count={needsAttention > 0 ? needsAttention : undefined}
      href="/leveranciers/facturen/mailbox"
      hidden={hidden}
      onHide={onHide}
    >
      {loading ? (
        <p className="px-4 py-6 text-center text-sm text-muted">Laden…</p>
      ) : totaal === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">
          Nog geen e-mailfacturen ontvangen in deze periode.
        </p>
      ) : (
        <div className="space-y-2 p-4">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <Metric label="Verwerkt" value={String(verwerkt)} />
            <Metric label="Controle nodig" value={String(counts.wacht_op_leverancier ?? 0)} />
            <Metric label="Fout / dubbel" value={String((counts.fout ?? 0) + (counts.dubbele_factuur ?? 0))} />
          </div>
          {needsAttention > 0 && (
            <Link
              href="/leveranciers/facturen/mailbox?tab=controle"
              className="flex items-center gap-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-warning hover:underline"
            >
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              {needsAttention} e-mailfactuur{needsAttention === 1 ? "" : "en"} wacht
              {needsAttention === 1 ? "" : "en"} op jouw aandacht
            </Link>
          )}
        </div>
      )}
    </DashboardWidget>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background px-2 py-1.5">
      <p className="tabular font-semibold">{value}</p>
      <p className="text-muted">{label}</p>
    </div>
  );
}

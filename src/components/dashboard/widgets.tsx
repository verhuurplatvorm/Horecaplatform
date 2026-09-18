"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, TriangleAlert } from "lucide-react";
import { DashboardWidget, WidgetTable } from "./dashboard-widget";
import { createClient } from "@/lib/supabase/client";
import { withReturnTo } from "@/lib/use-return-navigation";
import { cn } from "@/lib/utils";

interface Filters {
  companyId: string | null;
  days: number;
  supplierName: string | null;
  category: string | null;
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
    }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    createClient()
      .rpc("dashboard_price_changes", {
        p_days: filters.days,
        p_limit: alertsOnly ? 25 : 10,
        p_direction: direction,
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
  }, [filters.days, filters.supplierName, direction, alertsOnly]);

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
        headers={["Ingrediënt", "Leverancier", "Oud → nieuw", "Verschil", "Datum"]}
      >
        {rows.map((r) => (
          <tr key={`${r.product_id}-${r.changed_on}`} className="border-t border-border">
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
          </tr>
        ))}
      </WidgetTable>
    </DashboardWidget>
  );
}

/** Blok 4: gerechten met een foodcost boven de norm. */
export function MarginProblemsWidget({
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
      recipe_id: string;
      recipe_name: string;
      category: string | null;
      cost_price: number;
      sales_price: number;
      foodcost_pct: number;
      margin_pct: number;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    createClient()
      .rpc("dashboard_margin_problems", {
        p_company_id: filters.companyId,
        p_foodcost_norm: 33,
        p_limit: 15,
      })
      .then(({ data }) => {
        if (cancelled) return;
        let list = data ?? [];
        if (filters.category) list = list.filter((r) => r.category === filters.category);
        setRows(list);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters.companyId, filters.category]);

  return (
    <DashboardWidget
      id="marge"
      title="Gerechten met een margeprobleem"
      count={rows.length}
      href="/recepturen"
      hidden={hidden}
      onHide={onHide}
    >
      <WidgetTable
        loading={loading}
        empty="Alle gerechten zitten binnen de foodcostnorm."
        headers={["Gerecht", "Map", "Kostprijs", "Verkoop excl.", "Foodcost", "Marge"]}
      >
        {rows.map((r) => (
          <tr key={r.recipe_id} className="border-t border-border">
            <td className="px-4 py-2 font-medium">
              <Link
                href={withReturnTo(`/recepturen/${r.recipe_id}/bewerken`)}
                className="hover:text-teal hover:underline"
              >
                {r.recipe_name}
              </Link>
            </td>
            <td className="px-4 py-2 text-muted">{r.category ?? "—"}</td>
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
    </DashboardWidget>
  );
}

/** Blok 6: receptregels die bij een import niet gekoppeld konden worden. */
export function UnmatchedIngredientsWidget({
  onHide,
  hidden,
}: {
  onHide?: (id: string) => void;
  hidden?: boolean;
}) {
  const [rows, setRows] = useState<
    {
      line_id: string;
      unmatched_name: string;
      quantity: number;
      unit_name: string | null;
      recipe_id: string;
      recipe_name: string;
      recipe_kind: string;
      changed_at: string;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("dashboard_unmatched_ingredients")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (cancelled) return;
        setRows(data ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DashboardWidget
      id="nietherkend"
      title="Niet-herkende ingrediënten"
      count={rows.length}
      hidden={hidden}
      onHide={onHide}
    >
      <WidgetTable
        loading={loading}
        empty="Alle receptregels zijn gekoppeld aan een ingrediënt."
        headers={["Ingevoerde naam", "Uit", "Hoeveelheid", "Datum", ""]}
      >
        {rows.map((r) => (
          <tr key={r.line_id} className="border-t border-border">
            <td className="px-4 py-2 font-medium">{r.unmatched_name}</td>
            <td className="px-4 py-2 text-muted">
              <Link
                href={withReturnTo(
                  r.recipe_kind === "halfproduct"
                    ? `/halfproducten/${r.recipe_id}/bewerken`
                    : `/recepturen/${r.recipe_id}/bewerken`
                )}
                className="hover:text-teal hover:underline"
              >
                {r.recipe_name}
              </Link>
            </td>
            <td className="px-4 py-2 text-right tabular">
              {r.quantity} {r.unit_name ?? ""}
            </td>
            <td className="px-4 py-2 text-right text-xs text-muted">
              {new Date(r.changed_at).toLocaleDateString("nl-NL")}
            </td>
            <td className="px-4 py-2 text-right">
              <Link
                href={withReturnTo(
                  r.recipe_kind === "halfproduct"
                    ? `/halfproducten/${r.recipe_id}/bewerken`
                    : `/recepturen/${r.recipe_id}/bewerken`
                )}
                className="text-xs text-teal hover:underline"
              >
                Koppelen →
              </Link>
            </td>
          </tr>
        ))}
      </WidgetTable>
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
  onHide,
  hidden,
}: {
  filters: Filters;
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

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      const supabase = createClient();
      const to = new Date();
      const from = new Date(to);
      from.setDate(to.getDate() - filters.days + 1);
      const iso = (d: Date) => d.toISOString().slice(0, 10);

      const { data: sum } = await supabase.rpc("waste_summary", {
        p_company_id: filters.companyId,
        p_from: iso(from),
        p_to: iso(to),
        p_type: "afval",
      });
      if (cancelled) return;
      setSummary(sum?.[0] ?? null);

      // Top producten en redenen uit dezelfde periode.
      const { data: regs } = await supabase
        .from("waste_registrations")
        .select("product_id, recipe_id, reason_id, waste_value")
        .gte("registered_at", `${iso(from)}T00:00:00`)
        .eq("registration_type", "afval")
        .eq("is_cancelled", false);
      if (cancelled || !regs) {
        setLoading(false);
        return;
      }

      const byProduct = new Map<string, number>();
      const byReason = new Map<string, number>();
      for (const r of regs) {
        const key = r.product_id ?? r.recipe_id;
        if (key) byProduct.set(key, (byProduct.get(key) ?? 0) + (r.waste_value ?? 0));
        if (r.reason_id)
          byReason.set(r.reason_id, (byReason.get(r.reason_id) ?? 0) + (r.waste_value ?? 0));
      }

      const productIds = [...byProduct.keys()];
      const [{ data: prods }, { data: recs }, { data: reasons }] = await Promise.all([
        productIds.length
          ? supabase.from("products").select("id, name, custom_name").in("id", productIds)
          : Promise.resolve({ data: [] }),
        productIds.length
          ? supabase.from("recipes").select("id, name").in("id", productIds)
          : Promise.resolve({ data: [] }),
        supabase.from("waste_reasons").select("id, name"),
      ]);
      if (cancelled) return;

      const nameById = new Map<string, string>();
      for (const p of prods ?? []) nameById.set(p.id, p.custom_name?.trim() || p.name);
      for (const r of recs ?? []) nameById.set(r.id, r.name);
      const reasonName = new Map((reasons ?? []).map((r) => [r.id, r.name]));

      setTopProducts(
        [...byProduct.entries()]
          .map(([id, value]) => ({ name: nameById.get(id) ?? "onbekend", value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5)
      );
      setTopReasons(
        [...byReason.entries()]
          .map(([id, value]) => ({ name: reasonName.get(id) ?? "onbekend", value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5)
      );
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [filters.companyId, filters.days]);

  const delta =
    summary && summary.previous_value > 0
      ? ((summary.total_value - summary.previous_value) / summary.previous_value) * 100
      : null;

  return (
    <DashboardWidget
      id="afval"
      title="Afvalregistratie"
      href="/afval"
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
            <Link href="/afval" className="hover:underline">
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background px-2 py-1.5">
      <p className="tabular font-semibold">{value}</p>
      <p className="text-muted">{label}</p>
    </div>
  );
}

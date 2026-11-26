"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DashboardFilterBar } from "@/components/dashboard/filter-bar";
import { parseDashboardScope, type DashboardScope } from "@/lib/dashboard-links";
import { fetchPriceAlerts, priceAlertCount, type PriceAlerts } from "@/lib/dashboard-data";
import { withReturnTo } from "@/lib/use-return-navigation";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { PriceChangeHistory } from "@/lib/types/database";
import { AgreedPriceDeviations } from "@/components/price-import/agreed-price-deviations";
import { formatUnitPrice } from "@/lib/units/format";

interface EnrichedChange extends PriceChangeHistory {
  baseUnit: string | null;
  productName: string;
  supplierName: string;
  companyName: string | null;
  deltaPct: number | null;
}

type DirectionFilter = "alle" | "duurder" | "goedkoper" | "ongewijzigd";
type SortKey = "datum" | "grootste_stijging" | "grootste_daling";

export default function PrijswijzigingenPage() {
  return (
    <Suspense fallback={null}>
      <WijzigingenRouter />
    </Suspense>
  );
}

/** Vanaf het dashboard: ?filter=alarmen met bedrijf, periode, kaart en leverancier. */
function WijzigingenRouter() {
  const params = useSearchParams();
  if (params.get("filter") === "alarmen") return <PriceAlarmsView scope={parseDashboardScope(params)} />;
  return <PrijswijzigingenList />;
}

function PriceAlarmsView({ scope }: { scope: DashboardScope }) {
  const [data, setData] = useState<PriceAlerts | null>(null);
  const key = JSON.stringify(scope);
  useEffect(() => {
    let cancelled = false;
    fetchPriceAlerts(createClient(), JSON.parse(key) as DashboardScope)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData({ alerts: [], agreed: [] }));
    return () => {
      cancelled = true;
    };
  }, [key]);
  return (
    <>
      <Topbar title="Prijsalarmen" />
      <main className="space-y-4 p-6">
        <DashboardFilterBar
          title="Prijsalarmen"
          count={data ? priceAlertCount(data) : null}
          scope={scope}
          clearHref="/leveranciers/prijzen/wijzigingen"
          note={
            data
              ? `${data.alerts.length} prijswijziging${data.alerts.length === 1 ? "" : "en"} boven de alarmgrens + ${data.agreed.length} afwijking${data.agreed.length === 1 ? "" : "en"} van afgesproken prijzen`
              : undefined
          }
        />
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-5 py-2 font-medium">Ingrediënt</th>
                    <th className="px-5 py-2 font-medium">Leverancier</th>
                    <th className="px-5 py-2 text-right font-medium">Oud → nieuw</th>
                    <th className="px-5 py-2 text-right font-medium">Verschil</th>
                    <th className="px-5 py-2 text-right font-medium">Datum</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.alerts ?? []).map((r) => (
                    <tr key={r.price_row_id} className="border-t border-border">
                      <td className="px-5 py-2 font-medium">
                        <Link
                          href={withReturnTo(`/producten/${r.product_id}/bewerken`)}
                          className="hover:text-teal hover:underline"
                        >
                          {r.product_name}
                        </Link>
                      </td>
                      <td className="px-5 py-2 text-muted">{r.supplier_name ?? "—"}</td>
                      <td className="tabular px-5 py-2 text-right text-xs">
                        <span className="text-muted line-through">€ {r.old_price.toFixed(2)}</span> → €{" "}
                        {r.new_price.toFixed(2)}
                      </td>
                      <td
                        className={cn(
                          "tabular px-5 py-2 text-right font-semibold",
                          r.difference_pct > 0 ? "text-danger" : "text-success",
                        )}
                      >
                        {r.difference_pct > 0 ? "+" : ""}
                        {r.difference_pct.toFixed(1)}%
                      </td>
                      <td className="px-5 py-2 text-right text-xs text-muted">
                        {new Date(r.changed_on).toLocaleDateString("nl-NL")}
                      </td>
                    </tr>
                  ))}
                  {data && data.alerts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-muted">
                        Geen prijswijzigingen boven de alarmgrens met deze filters.
                      </td>
                    </tr>
                  )}
                  {!data && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-muted">
                        Laden…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        {data && <AgreedPriceDeviations rows={data.agreed} days={scope.days ?? 30} />}
      </main>
    </>
  );
}

function PrijswijzigingenList() {
  const [changes, setChanges] = useState<EnrichedChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState<DirectionFilter>("alle");
  const [supplierFilter, setSupplierFilter] = useState("alle");
  const [sortKey, setSortKey] = useState<SortKey>("datum");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data } = await supabase
        .from("price_change_history")
        .select("*")
        .not("old_price_per_base_unit", "is", null)
        .order("valid_from", { ascending: false })
        .limit(300);
      if (cancelled || !data) {
        setLoading(false);
        return;
      }

      const productIds = [...new Set(data.map((d) => d.product_id))];
      const supplierIds = [...new Set(data.map((d) => d.supplier_id))];
      const companyIds = [...new Set(data.map((d) => d.company_id).filter(Boolean))] as string[];

      const [{ data: products }, { data: suppliers }, { data: companies }] =
        await Promise.all([
          supabase.from("products").select("id, name, base_unit").in("id", productIds),
          supabase.from("suppliers").select("id, name").in("id", supplierIds),
          companyIds.length
            ? supabase.from("companies").select("id, name").in("id", companyIds)
            : Promise.resolve({ data: [] }),
        ]);
      if (cancelled) return;

      const productMap = new Map((products ?? []).map((p) => [p.id, p.name]));
      const unitMap = new Map((products ?? []).map((p) => [p.id, (p as { base_unit?: string | null }).base_unit ?? null]));
      const supplierMap = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
      const companyMap = new Map((companies ?? []).map((c) => [c.id, c.name]));

      const enriched: EnrichedChange[] = data.map((d) => ({
        ...d,
        productName: productMap.get(d.product_id) ?? "onbekend ingrediënt",
        baseUnit: unitMap.get(d.product_id) ?? null,
        supplierName: supplierMap.get(d.supplier_id) ?? "onbekende leverancier",
        companyName: d.company_id ? companyMap.get(d.company_id) ?? null : null,
        deltaPct:
          d.old_price_per_base_unit && d.old_price_per_base_unit > 0
            ? ((d.new_price_per_base_unit! - d.old_price_per_base_unit) /
                d.old_price_per_base_unit) *
              100
            : null,
      }));

      setChanges(enriched);
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const supplierNames = useMemo(
    () => [...new Set(changes.map((c) => c.supplierName))].sort(),
    [changes]
  );

  const filtered = useMemo(() => {
    let result = changes;
    if (direction === "duurder") result = result.filter((c) => (c.deltaPct ?? 0) > 0);
    else if (direction === "goedkoper") result = result.filter((c) => (c.deltaPct ?? 0) < 0);
    else if (direction === "ongewijzigd")
      result = result.filter((c) => (c.deltaPct ?? 0) === 0);

    if (supplierFilter !== "alle")
      result = result.filter((c) => c.supplierName === supplierFilter);

    return [...result].sort((a, b) => {
      if (sortKey === "grootste_stijging") return (b.deltaPct ?? 0) - (a.deltaPct ?? 0);
      if (sortKey === "grootste_daling") return (a.deltaPct ?? 0) - (b.deltaPct ?? 0);
      return new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime();
    });
  }, [changes, direction, supplierFilter, sortKey]);

  return (
    <>
      <Topbar title="Prijswijzigingen" />
      <main className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-md border border-border bg-surface p-1">
            {(["alle", "duurder", "goedkoper", "ongewijzigd"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium capitalize",
                  direction === d ? "bg-teal text-white" : "text-muted hover:text-foreground"
                )}
              >
                {d}
              </button>
            ))}
          </div>
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          >
            <option value="alle">Alle leveranciers</option>
            {supplierNames.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          >
            <option value="datum">Meest recent</option>
            <option value="grootste_stijging">Grootste stijging</option>
            <option value="grootste_daling">Grootste daling</option>
          </select>
        </div>

        <AgreedPriceDeviations />

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
<table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Ingrediënt</th>
                  <th className="px-5 py-3 font-medium">Leverancier</th>
                  <th className="px-5 py-3 font-medium">Bedrijf</th>
                  <th className="px-5 py-3 font-medium">Oude prijs</th>
                  <th className="px-5 py-3 font-medium">Nieuwe prijs</th>
                  <th className="px-5 py-3 font-medium">Inkoopprijs (verpakking)</th>
                  <th className="px-5 py-3 font-medium">Wijziging</th>
                  <th className="px-5 py-3 font-medium">Ingangsdatum</th>
                  <th className="px-5 py-3 font-medium">Reden</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-5 py-3 font-medium">
                      {c.productName}
                      {c.is_acknowledged && (
                        <span
                          className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-xs font-normal text-success"
                          title="Afgehandeld: geaccepteerd als nieuwe standaard of alarm weggehaald"
                        >
                          afgehandeld
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted">{c.supplierName}</td>
                    <td className="px-5 py-3 text-muted">{c.companyName ?? "groepsbreed"}</td>
                    <td className="px-5 py-3 tabular text-muted">
                      {formatUnitPrice(c.old_price_per_base_unit, c.baseUnit)}
                    </td>
                    <td className="px-5 py-3 tabular">
                      {formatUnitPrice(c.new_price_per_base_unit, c.baseUnit)}
                    </td>
                    <td className="px-5 py-3 tabular text-muted">
                      {c.old_purchase_price !== null && (
                        <>
                          <span className="line-through">
                            € {c.old_purchase_price.toFixed(2)}
                          </span>
                          {" → "}
                        </>
                      )}
                      <span className="font-medium text-foreground">
                        € {c.new_purchase_price.toFixed(2)}
                      </span>
                      {c.new_packaging_description && (
                        <span className="ml-1 text-xs">
                          ({c.new_packaging_description})
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {c.deltaPct === null || c.deltaPct === 0 ? (
                        <span className="flex items-center gap-1 text-muted">
                          <Minus className="h-3.5 w-3.5" /> ongewijzigd
                        </span>
                      ) : c.deltaPct > 0 ? (
                        <span className="flex items-center gap-1 text-danger">
                          <TrendingUp className="h-3.5 w-3.5" /> +{c.deltaPct.toFixed(1)}% duurder
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-success">
                          <TrendingDown className="h-3.5 w-3.5" /> {c.deltaPct.toFixed(1)}% goedkoper
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {new Date(c.valid_from).toLocaleDateString("nl-NL")}
                    </td>
                    <td className="px-5 py-3 text-muted">{c.change_reason ?? "—"}</td>
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr>
                    <td colSpan={9} className="px-5 py-6 text-center text-muted">
                      Geen prijswijzigingen gevonden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
</div>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

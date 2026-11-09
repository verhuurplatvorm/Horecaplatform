"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DashboardWidget } from "./dashboard-widget";
import { PriorityBadge } from "@/components/price-comparison/priority-badge";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { PriceComparisonRow } from "@/lib/types/database";
import {
  computeTotals,
  daysAgoIso,
  euro,
  normalizeComparisonRow,
  overchargeOf,
  periodForDays,
  presetComparisonFilters,
  statusOf,
  type ComparisonFilters,
} from "@/lib/price-comparison";

/**
 * Dashboardpaneel Prijscontrole: waar betalen we te veel, hoeveel, bij wie,
 * en wat moet eerst. Alle cijfers openen de pagina Prijsvergelijking met
 * het bijbehorende filter. Alleen lezen.
 */
export function PriceCheckWidget({
  filters,
  hidden,
  onHide,
}: {
  filters: {
    companyId: string | null;
    days: number;
    supplierName: string | null;
  };
  hidden?: boolean;
  onHide?: (id: string) => void;
}) {
  const [rows, setRows] = useState<PriceComparisonRow[] | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = `${filters.days}|${filters.companyId ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    createClient()
      .rpc("price_comparison", {
        p_from: daysAgoIso(filters.days),
        p_to: daysAgoIso(0),
        p_company_ids: filters.companyId ? [filters.companyId] : null,
      })
      .then(({ data }) => {
        if (cancelled) return;
        setRows(
          ((data ?? []) as PriceComparisonRow[]).map(normalizeComparisonRow),
        );
        setLoadedFor(`${filters.days}|${filters.companyId ?? ""}`);
      });
    return () => {
      cancelled = true;
    };
  }, [filters.days, filters.companyId]);

  const scoped = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          !filters.supplierName || r.supplier_name === filters.supplierName,
      ),
    [rows, filters.supplierName],
  );
  const totals = useMemo(() => computeTotals(scoped), [scoped]);

  const top10 = useMemo(
    () =>
      scoped
        .filter((r) => overchargeOf(r) > 0)
        .sort(
          (a, b) =>
            a.priority - b.priority || overchargeOf(b) - overchargeOf(a),
        )
        .slice(0, 10),
    [scoped],
  );

  const bySupplier = useMemo(() => {
    const map = new Map<
      string,
      { name: string; count: number; overcharged: number }
    >();
    for (const r of scoped) {
      const s = statusOf(r);
      if (s !== "open" && s !== "betwist") continue;
      if (Number(r.impact ?? 0) <= 0) continue;
      const e = map.get(r.supplier_name) ?? {
        name: r.supplier_name,
        count: 0,
        overcharged: 0,
      };
      e.count++;
      e.overcharged += overchargeOf(r);
      map.set(r.supplier_name, e);
    }
    return [...map.values()]
      .sort((a, b) => b.overcharged - a.overcharged)
      .slice(0, 5);
  }, [scoped]);

  const base: Partial<ComparisonFilters> = {
    ...periodForDays(filters.days),
    supplier: filters.supplierName ?? "alle",
  };
  const go = (patch: Partial<ComparisonFilters>) => () =>
    presetComparisonFilters({ ...base, ...patch });

  const loading = loadedFor !== key;

  return (
    <DashboardWidget
      id="prijscontrole"
      title="Prijscontrole"
      count={totals.critical || null}
      href="/prijsvergelijking"
      hidden={hidden}
      onHide={onHide}
    >
      {loading && rows === null ? (
        <p className="px-4 py-6 text-sm text-muted">Bezig met vergelijken…</p>
      ) : scoped.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">
          Geen facturen met een prijslijst of contractprijs in deze periode.
        </p>
      ) : (
        <div className={cn("space-y-4 p-4", loading && "opacity-60")}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <Tile
              label="Mogelijk te veel"
              value={euro(totals.overcharged)}
              tone={totals.overcharged > 0 ? "danger" : undefined}
              onClick={go({ status: "aandacht" })}
            />
            <Tile
              label="Voordelig"
              value={euro(totals.favourable)}
              tone="success"
              onClick={go({ status: "alles", priority: "4" })}
            />
            <Tile
              label="Netto"
              value={euro(totals.net, true)}
              onClick={go({ status: "alles" })}
            />
            <Tile
              label="Kritiek"
              value={String(totals.critical)}
              tone={totals.critical ? "danger" : undefined}
              onClick={go({ status: "open", priority: "1" })}
            />
            <Tile
              label="Hoog"
              value={String(totals.high)}
              tone={totals.high ? "warning" : undefined}
              onClick={go({ status: "open", priority: "2" })}
            />
            <Tile
              label="Betwist (claims)"
              value={euro(totals.disputed)}
              onClick={go({ status: "betwist" })}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                Grootste afwijkingen
              </p>
              {top10.length === 0 ? (
                <p className="text-sm text-success">
                  Geen openstaande afwijkingen.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {top10.map((r) => (
                      <tr key={r.row_id} className="border-t border-border">
                        <td className="py-1.5 pr-2">
                          <PriorityBadge priority={r.priority} />
                        </td>
                        <td className="py-1.5 pr-2">
                          <Link
                            href={`/leveranciers/prijzen/importeren/${r.batch_id}`}
                            className="font-medium hover:text-teal hover:underline"
                          >
                            {r.product_name ?? r.description}
                          </Link>
                          <div className="text-xs text-muted">
                            {r.supplier_name} · {euro(r.ref_price)} →{" "}
                            {euro(r.invoice_price)}
                          </div>
                        </td>
                        <td className="whitespace-nowrap py-1.5 text-right tabular font-semibold text-danger">
                          {euro(overchargeOf(r), true)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                Leveranciers met de meeste afwijkingen
              </p>
              {bySupplier.length === 0 ? (
                <p className="text-sm text-muted">—</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {bySupplier.map((s) => (
                      <tr key={s.name} className="border-t border-border">
                        <td className="py-1.5 pr-2">
                          <Link
                            href="/prijsvergelijking"
                            onClick={go({
                              supplier: s.name,
                              status: "aandacht",
                            })}
                            className="font-medium hover:text-teal hover:underline"
                          >
                            {s.name}
                          </Link>
                          <div className="text-xs text-muted">
                            {s.count} regels te duur
                          </div>
                        </td>
                        <td className="whitespace-nowrap py-1.5 text-right tabular font-semibold text-danger">
                          {euro(s.overcharged)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardWidget>
  );
}

function Tile({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  tone?: "danger" | "success" | "warning";
  onClick: () => void;
}) {
  return (
    <Link
      href="/prijsvergelijking"
      onClick={onClick}
      className="rounded-md border border-border bg-background px-3 py-2 transition-colors hover:border-teal"
    >
      <p className="text-xs text-muted">{label}</p>
      <p
        className={cn(
          "tabular text-lg font-semibold",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
    </Link>
  );
}

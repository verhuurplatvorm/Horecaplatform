"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileText,
  Flag,
  RotateCcw,
  Scale,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { PageActions } from "@/components/layout/page-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { PriceComparisonRow } from "@/lib/types/database";
import { PriorityBadge } from "@/components/price-comparison/priority-badge";
import {
  COMPARISON_FILTER_KEY,
  loadComparisonFilters,
  normalizeComparisonRow,
  type ComparisonFilters,
  type StatusFilter,
  PERIOD_LABEL,
  PRIORITY_META,
  STATUS_LABEL,
  computeTotals,
  euro,
  pct,
  periodRange,
  shortDate,
  statusOf,
  type PeriodKey,
} from "@/lib/price-comparison";

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  aandacht: "Vraagt aandacht",
  open: "Open",
  controle: "Controle nodig",
  betwist: "Betwist",
  geaccepteerd: "Geaccepteerd",
  akkoord: "Akkoord",
  alles: "Alles",
};

function matchesStatus(row: PriceComparisonRow, filter: StatusFilter): boolean {
  const s = statusOf(row);
  if (filter === "alles") return true;
  if (filter === "aandacht")
    return s === "open" || s === "controle" || s === "betwist";
  return s === filter;
}

export default function PrijsvergelijkingPage() {
  const {
    scope,
    activeCompanyIds,
    loading: companiesLoading,
  } = useCompanyScope();
  const [filters, setFilters] = useState<ComparisonFilters>(
    loadComparisonFilters,
  );
  const [rows, setRows] = useState<PriceComparisonRow[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const range = useMemo(
    () =>
      periodRange(filters.period, {
        from: filters.customFrom,
        to: filters.customTo,
      }),
    [filters.period, filters.customFrom, filters.customTo],
  );

  const companyKey = scope.mode === "group" ? "" : activeCompanyIds.join(",");
  const fetchKey = `${range.from}|${range.to}|${companyKey}`;
  const loading = loadedKey !== fetchKey;

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        COMPARISON_FILTER_KEY,
        JSON.stringify(filters),
      );
    } catch {
      /* sessionStorage niet beschikbaar: filters gewoon niet onthouden */
    }
  }, [filters]);

  useEffect(() => {
    if (companiesLoading || !range.from || !range.to) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .rpc("price_comparison", {
        p_from: range.from,
        p_to: range.to,
        p_company_ids: companyKey ? companyKey.split(",") : null,
      })
      .then(({ data, error: rpcError }) => {
        if (cancelled) return;
        if (rpcError) {
          setError(rpcError.message);
          setRows([]);
        } else {
          setError(null);
          setRows(
            ((data ?? []) as PriceComparisonRow[]).map(normalizeComparisonRow),
          );
        }
        setLoadedKey(`${range.from}|${range.to}|${companyKey}`);
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, companyKey, companiesLoading]);

  const update = (patch: Partial<ComparisonFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));
  const updateLocal = update;

  const supplierNames = useMemo(
    () =>
      [...new Set(rows.map((r) => r.supplier_name))].sort((a, b) =>
        a.localeCompare(b, "nl"),
      ),
    [rows],
  );

  const supplierRows = useMemo(
    () =>
      filters.supplier === "alle"
        ? rows
        : rows.filter((r) => r.supplier_name === filters.supplier),
    [rows, filters.supplier],
  );

  const totals = useMemo(() => computeTotals(supplierRows), [supplierRows]);

  const visible = useMemo(() => {
    const min = Number(filters.minImpact.replace(",", "."));
    return supplierRows
      .filter(
        (r) =>
          filters.priority === "alle" ||
          String(r.priority) === filters.priority,
      )
      .filter((r) => matchesStatus(r, filters.status))
      .filter((r) => !min || Math.abs(Number(r.impact ?? 0)) >= min)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return (
          Math.abs(Number(b.impact ?? 0)) - Math.abs(Number(a.impact ?? 0))
        );
      });
  }, [supplierRows, filters.priority, filters.status, filters.minImpact]);

  const priorityCounts = useMemo(() => {
    const c: Record<string, number> = {
      "1": 0,
      "2": 0,
      "3": 0,
      "4": 0,
      "5": 0,
    };
    for (const r of supplierRows)
      if (matchesStatus(r, filters.status)) c[String(r.priority)]++;
    return c;
  }, [supplierRows, filters.status]);

  const invoices = useMemo(() => {
    const map = new Map<
      string,
      {
        batchId: string;
        invoiceNumber: string | null;
        date: string;
        supplier: string;
        rows: PriceComparisonRow[];
      }
    >();
    for (const r of visible) {
      const entry = map.get(r.batch_id) ?? {
        batchId: r.batch_id,
        invoiceNumber: r.invoice_number,
        date: r.invoice_date,
        supplier: r.supplier_name,
        rows: [],
      };
      entry.rows.push(r);
      map.set(r.batch_id, entry);
    }
    return [...map.values()]
      .map((inv) => ({
        ...inv,
        totals: computeTotals(inv.rows),
        top: Math.min(...inv.rows.map((x) => x.priority)),
      }))
      .sort(
        (a, b) => a.top - b.top || b.totals.overcharged - a.totals.overcharged,
      );
  }, [visible]);

  const review = useCallback(
    async (
      row: PriceComparisonRow,
      status: "geaccepteerd" | "betwist" | null,
    ) => {
      setBusyRow(row.row_id);
      const supabase = createClient();
      const { error: writeError } =
        status === null
          ? await supabase
              .from("price_comparison_reviews")
              .delete()
              .eq("row_id", row.row_id)
          : await supabase.from("price_comparison_reviews").upsert({
              row_id: row.row_id,
              status,
              reviewed_at: new Date().toISOString(),
            });
      setBusyRow(null);
      if (writeError) {
        setError(`Opslaan lukte niet: ${writeError.message}`);
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.row_id === row.row_id ? { ...r, review_status: status } : r,
        ),
      );
    },
    [],
  );

  return (
    <>
      <Topbar title="Prijsvergelijking" />
      <PageActions>
        <Link href="/prijsvergelijking/contracten">
          <Button variant="secondary" size="sm">
            <Scale className="h-4 w-4" /> Contractprijzen
          </Button>
        </Link>
      </PageActions>
      <main className="space-y-4 p-4 md:p-6">
        {/* Kerncijfers */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <SummaryTile
            label="Mogelijk te veel betaald"
            value={euro(totals.overcharged)}
            tone="danger"
            onClick={() => updateLocal({ status: "open", priority: "alle" })}
          />
          <SummaryTile
            label="Voordelig gefactureerd"
            value={euro(totals.favourable)}
            tone="success"
          />
          <SummaryTile label="Netto verschil" value={euro(totals.net, true)} />
          <SummaryTile
            label="Kritiek / hoog open"
            value={`${totals.critical} / ${totals.high}`}
            tone={totals.critical ? "danger" : undefined}
            onClick={() => updateLocal({ status: "open", priority: "1" })}
          />
          <SummaryTile
            label="Controle nodig"
            value={String(totals.toCheck)}
            tone={totals.toCheck ? "warning" : undefined}
            onClick={() =>
              updateLocal({ status: "controle", priority: "alle" })
            }
          />
        </div>
        {totals.disputed > 0 && (
          <p className="text-sm text-muted">
            Betwist (terug te vragen):{" "}
            <span className="font-semibold text-foreground">
              {euro(totals.disputed)}
            </span>
          </p>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filters.period}
            onChange={(e) => update({ period: e.target.value as PeriodKey })}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          >
            {(Object.keys(PERIOD_LABEL) as PeriodKey[]).map((k) => (
              <option key={k} value={k}>
                {PERIOD_LABEL[k]}
              </option>
            ))}
          </select>
          {filters.period === "eigen" && (
            <>
              <input
                type="date"
                value={filters.customFrom}
                onChange={(e) => update({ customFrom: e.target.value })}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              />
              <span className="text-sm text-muted">t/m</span>
              <input
                type="date"
                value={filters.customTo}
                onChange={(e) => update({ customTo: e.target.value })}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              />
            </>
          )}
          <select
            value={filters.supplier}
            onChange={(e) => updateLocal({ supplier: e.target.value })}
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
            value={filters.status}
            onChange={(e) =>
              updateLocal({ status: e.target.value as StatusFilter })
            }
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          >
            {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((k) => (
              <option key={k} value={k}>
                {STATUS_FILTER_LABEL[k]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm text-muted">
            vanaf €
            <input
              inputMode="decimal"
              value={filters.minImpact}
              onChange={(e) => updateLocal({ minImpact: e.target.value })}
              placeholder="0"
              className="h-9 w-16 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
            />
          </label>
          <div className="flex gap-1 rounded-md border border-border bg-surface p-1">
            <PriorityChip
              active={filters.priority === "alle"}
              onClick={() => updateLocal({ priority: "alle" })}
              label="Alle"
            />
            {(["1", "2", "3", "4", "5"] as const).map((p) => (
              <PriorityChip
                key={p}
                active={filters.priority === p}
                onClick={() => updateLocal({ priority: p })}
                label={`${PRIORITY_META[Number(p) as 1].short} (${priorityCounts[p]})`}
                dot={PRIORITY_META[Number(p) as 1].dot}
              />
            ))}
          </div>
          <div className="ml-auto flex gap-1 rounded-md border border-border bg-surface p-1">
            {(["regels", "facturen"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => updateLocal({ view: v })}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium",
                  filters.view === v
                    ? "bg-teal text-white"
                    : "text-muted hover:text-foreground",
                )}
              >
                {v === "regels" ? "Per regel" : "Per factuur"}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {filters.view === "regels" ? (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-2 py-2 font-medium">Prio</th>
                      <th className="px-2 py-2 font-medium">Leverancier</th>
                      <th className="px-2 py-2 font-medium">Art.nr</th>
                      <th className="px-2 py-2 font-medium">Product</th>
                      <th className="px-2 py-2 font-medium">Verpakking</th>
                      <th className="px-2 py-2 text-right font-medium">
                        Referentie
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Factuur
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Verschil
                      </th>

                      <th className="px-2 py-2 text-right font-medium">
                        Aantal
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Afwijking
                      </th>
                      <th className="px-2 py-2 font-medium">Datum</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">Actie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <ComparisonRow
                        key={r.row_id}
                        row={r}
                        busy={busyRow === r.row_id}
                        onReview={review}
                      />
                    ))}
                    {!loading && visible.length === 0 && (
                      <tr>
                        <td
                          colSpan={13}
                          className="px-4 py-8 text-center text-muted"
                        >
                          {rows.length === 0
                            ? "Geen factuurregels met een referentieprijs in deze periode. Importeer een prijslijst of leg een contractprijs vast."
                            : "Niets gevonden met deze filters."}
                        </td>
                      </tr>
                    )}
                    {loading && (
                      <tr>
                        <td
                          colSpan={13}
                          className="px-4 py-8 text-center text-muted"
                        >
                          Bezig met vergelijken…
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-2 py-2 font-medium">Prio</th>
                      <th className="px-2 py-2 font-medium">Leverancier</th>
                      <th className="px-2 py-2 font-medium">Factuur</th>
                      <th className="px-2 py-2 font-medium">Datum</th>
                      <th className="px-2 py-2 text-right font-medium">
                        Regels
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Te veel
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Voordelig
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Netto
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Controle nodig
                      </th>
                      <th className="px-2 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.batchId} className="border-t border-border">
                        <td className="px-2 py-2">
                          <PriorityBadge
                            priority={inv.top as PriceComparisonRow["priority"]}
                          />
                        </td>
                        <td className="px-2 py-2">{inv.supplier}</td>
                        <td className="px-2 py-2 font-medium">
                          {inv.invoiceNumber ?? "—"}
                        </td>
                        <td className="px-2 py-2 text-muted">
                          {shortDate(inv.date)}
                        </td>
                        <td className="px-2 py-2 text-right tabular">
                          {inv.rows.length}
                        </td>
                        <td className="px-2 py-2 text-right tabular text-danger">
                          {euro(inv.totals.overcharged)}
                        </td>
                        <td className="px-2 py-2 text-right tabular text-success">
                          {euro(inv.totals.favourable)}
                        </td>
                        <td className="px-2 py-2 text-right tabular font-semibold">
                          {euro(inv.totals.net, true)}
                        </td>
                        <td className="px-2 py-2 text-right tabular">
                          {inv.totals.toCheck || ""}
                        </td>
                        <td className="px-2 py-2">
                          <Link
                            href={`/leveranciers/prijzen/importeren/${inv.batchId}`}
                            className="inline-flex items-center gap-1 text-teal hover:underline"
                          >
                            <FileText className="h-3.5 w-3.5" /> Bekijken
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {!loading && invoices.length === 0 && (
                      <tr>
                        <td
                          colSpan={10}
                          className="px-4 py-8 text-center text-muted"
                        >
                          Niets gevonden met deze filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted">
          Vergeleken wordt met de contractprijs, of anders de laatste
          prijslijst/webshopprijs die gold op de factuurdatum (exclusief btw,
          per verpakking). Factuurregels zonder referentieprijs staan hier niet
          in. Bedragen van regels met &ldquo;Controle nodig&rdquo; en
          geaccepteerde regels tellen niet mee in de totalen.
        </p>
      </main>
    </>
  );
}

function SummaryTile({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  tone?: "danger" | "success" | "warning";
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-lg border border-border bg-surface px-4 py-3 text-left",
        onClick && "transition-colors hover:border-teal",
      )}
    >
      <div className="text-xs text-muted">{label}</div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold tabular",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </div>
    </Comp>
  );
}

function PriorityChip({
  active,
  onClick,
  label,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium",
        active ? "bg-teal text-white" : "text-muted hover:text-foreground",
      )}
    >
      {dot && <span className={cn("h-2 w-2 rounded-full", dot)} />}
      {label}
    </button>
  );
}

function ComparisonRow({
  row: r,
  busy,
  onReview,
}: {
  row: PriceComparisonRow;
  busy: boolean;
  onReview: (
    row: PriceComparisonRow,
    status: "geaccepteerd" | "betwist" | null,
  ) => void;
}) {
  const status = statusOf(r);
  const impact = Number(r.impact ?? 0);
  return (
    <tr
      className={cn(
        "border-t border-border align-top",
        r.priority === 1 && status === "open" && "bg-danger/5",
      )}
    >
      <td className="px-2 py-2">
        <PriorityBadge priority={r.priority} />
      </td>
      <td className="whitespace-nowrap px-2 py-2">{r.supplier_name}</td>
      <td className="px-2 py-2 tabular text-muted">
        {r.article_number ?? "—"}
      </td>
      <td className="min-w-52 px-2 py-2">
        <div className="font-medium">{r.product_name ?? r.description}</div>
        {r.description &&
          r.product_name &&
          r.description.toLowerCase().replace(/\s+/g, "") !==
            r.product_name.toLowerCase().replace(/\s+/g, "") && (
            <div className="text-xs text-muted">{r.description}</div>
          )}
        {r.reasons.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-warning">
            {r.reasons.map((reason) => (
              <span key={reason}>• {reason}</span>
            ))}
          </div>
        )}
      </td>
      <td className="px-2 py-2 text-muted">{r.packaging ?? "—"}</td>
      <td className="whitespace-nowrap px-2 py-2 text-right tabular">
        {euro(r.ref_price)}
        <div className="text-xs text-muted">
          {r.ref_source === "contract" ? "contract" : "prijslijst"}{" "}
          {shortDate(r.ref_date)}
        </div>
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-right tabular font-medium">
        {euro(r.invoice_price)}
      </td>
      <td
        className={cn(
          "whitespace-nowrap px-2 py-2 text-right tabular",
          r.diff_per_unit > 0.005 && "text-danger",
          r.diff_per_unit < -0.005 && "text-success",
        )}
      >
        {euro(r.diff_per_unit, true)}
        <div className="text-xs text-muted">{pct(r.diff_pct)}</div>
      </td>
      <td className="px-2 py-2 text-right tabular">
        {r.quantity === null ? "—" : r.quantity.toLocaleString("nl-NL")}
      </td>
      <td
        className={cn(
          "whitespace-nowrap px-2 py-2 text-right tabular font-semibold",
          impact > 0 && "text-danger",
          impact < 0 && "text-success",
        )}
      >
        {r.impact === null ? "—" : euro(impact, true)}
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-muted">
        {shortDate(r.invoice_date)}
      </td>
      <td className="whitespace-nowrap px-2 py-2">
        <span
          className={cn(
            "text-xs font-medium",
            status === "controle" && "text-warning",
            status === "betwist" && "text-danger",
            (status === "akkoord" || status === "geaccepteerd") &&
              "text-success",
          )}
        >
          {status === "controle" && (
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          )}
          {STATUS_LABEL[status]}
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-2">
        <div className="flex items-center gap-1">
          {r.review_status ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onReview(r, null)}
              title="Beoordeling terugzetten"
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted hover:bg-black/5"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Terugzetten
            </button>
          ) : (
            status !== "akkoord" && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onReview(r, "geaccepteerd")}
                  title="Accepteren: het verschil is in orde"
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-success hover:bg-success/10"
                >
                  <Check className="h-3.5 w-3.5" /> Accepteren
                </button>
                {r.diff_per_unit > 0.005 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onReview(r, "betwist")}
                    title="Betwisten: terugvragen bij de leverancier"
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-danger hover:bg-danger/10"
                  >
                    <Flag className="h-3.5 w-3.5" /> Betwisten
                  </button>
                )}
              </>
            )
          )}
          <Link
            href={`/leveranciers/prijzen/importeren/${r.batch_id}`}
            title={`Factuur ${r.invoice_number ?? ""} bekijken`}
            className="inline-flex items-center rounded px-2 py-1 text-xs text-teal hover:bg-teal/10"
          >
            <FileText className="h-3.5 w-3.5" />
          </Link>
        </div>
      </td>
    </tr>
  );
}

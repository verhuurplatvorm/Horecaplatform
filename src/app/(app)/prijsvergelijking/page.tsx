"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Flag,
  RotateCcw,
  Scale,
  X,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { PageActions } from "@/components/layout/page-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import {
  ConfigurableTable,
  type DataColumn,
} from "@/components/ui/configurable-table";
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
  groupDeviations,
  referenceLabel,
  type DeviationGroup,
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
  zonder_referentie: "Zonder referentieprijs",
  alles: "Alles",
};

type ReviewStatus = "geaccepteerd" | "betwist" | null;
type TableRow = PriceComparisonRow & { id: string };

/** Max. aantal regels per schrijfactie, zodat verzoeken niet te groot worden. */
const BULK_CHUNK = 200;

/** Kan deze regel betwist worden? Alleen bij een prijsverhoging. */
const canDisputeRow = (r: PriceComparisonRow) => (r.diff_per_unit ?? 0) > 0.005;

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
    companies,
    loading: companiesLoading,
  } = useCompanyScope();
  const companyName = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name])),
    [companies],
  );
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [filters, setFilters] = useState<ComparisonFilters>(
    loadComparisonFilters,
  );
  const [rows, setRows] = useState<PriceComparisonRow[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
        // Ook regels zonder referentieprijs, voor de teller en het filter.
        p_include_unreferenced: true,
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

  // Terugkerende open afwijkingen per bedrijf, leverancier, artikel en verpakking.
  const groups = useMemo(() => groupDeviations(visible), [visible]);

  const review = useCallback(
    async (row: PriceComparisonRow, status: ReviewStatus) => {
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

  // ---- Bulk: selecteren en in één keer beoordelen ----
  const tableRows = useMemo<TableRow[]>(
    () => visible.map((r) => ({ ...r, id: r.row_id })),
    [visible],
  );

  // Alleen geselecteerde regels die nog binnen de filters vallen tellen mee.
  const selectedRows = useMemo(
    () => visible.filter((r) => selected.has(r.row_id)),
    [visible, selected],
  );
  const bulkTargets = useMemo(
    () => ({
      geaccepteerd: selectedRows.filter(
        (r) =>
          statusOf(r) !== "akkoord" &&
          statusOf(r) !== "zonder_referentie" &&
          r.review_status !== "geaccepteerd",
      ),
      betwist: selectedRows.filter(
        (r) => canDisputeRow(r) && r.review_status !== "betwist",
      ),
      reset: selectedRows.filter((r) => r.review_status),
    }),
    [selectedRows],
  );
  const selectedImpact = useMemo(
    () =>
      selectedRows.reduce(
        (sum, r) => sum + Math.max(0, Number(r.impact ?? 0)),
        0,
      ),
    [selectedRows],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const allIn = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of ids) {
        if (allIn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const bulkReview = useCallback(
    async (status: ReviewStatus) => {
      const targets =
        status === null
          ? bulkTargets.reset
          : status === "geaccepteerd"
            ? bulkTargets.geaccepteerd
            : bulkTargets.betwist;
      if (targets.length === 0) return;

      const verb =
        status === null
          ? "terugzetten naar open"
          : status === "geaccepteerd"
            ? "accepteren"
            : "betwisten";
      const skipped = selectedRows.length - targets.length;
      const question =
        `${targets.length} regel${targets.length === 1 ? "" : "s"} ${verb}?` +
        (skipped > 0
          ? `\n\n${skipped} geselecteerde regel${skipped === 1 ? " wordt" : "s worden"} overgeslagen` +
            (status === "betwist"
              ? " (geen prijsverhoging of al betwist)."
              : " (niet van toepassing).")
          : "");
      if (!window.confirm(question)) return;

      setBulkBusy(true);
      setError(null);
      setNotice(null);
      const supabase = createClient();
      const ids = targets.map((r) => r.row_id);
      const done: string[] = [];
      let failMessage: string | null = null;

      for (let i = 0; i < ids.length; i += BULK_CHUNK) {
        const chunk = ids.slice(i, i + BULK_CHUNK);
        const reviewedAt = new Date().toISOString();
        const { error: writeError } =
          status === null
            ? await supabase
                .from("price_comparison_reviews")
                .delete()
                .in("row_id", chunk)
            : await supabase.from("price_comparison_reviews").upsert(
                chunk.map((row_id) => ({
                  row_id,
                  status,
                  reviewed_at: reviewedAt,
                })),
              );
        if (writeError) {
          failMessage = writeError.message;
          break;
        }
        done.push(...chunk);
      }

      const doneSet = new Set(done);
      setRows((prev) =>
        prev.map((r) =>
          doneSet.has(r.row_id) ? { ...r, review_status: status } : r,
        ),
      );
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of done) next.delete(id);
        return next;
      });
      setBulkBusy(false);

      if (failMessage) {
        setError(
          `Opslaan lukte niet helemaal (${done.length} van ${ids.length} verwerkt): ${failMessage}`,
        );
      } else {
        const past =
          status === null
            ? "teruggezet"
            : status === "geaccepteerd"
              ? "geaccepteerd"
              : "betwist";
        setNotice(
          `${done.length} regel${done.length === 1 ? "" : "s"} ${past}.`,
        );
      }
    },
    [bulkTargets, selectedRows.length],
  );

  const columns = useMemo<DataColumn<TableRow>[]>(
    () => buildColumns({ busyRow, bulkBusy, onReview: review }),
    [busyRow, bulkBusy, review],
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
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
          <SummaryTile
            label="Zonder referentieprijs"
            value={String(totals.noReference)}
            tone={totals.noReference ? "warning" : undefined}
            onClick={() =>
              updateLocal({ status: "zonder_referentie", priority: "alle" })
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
            {(["regels", "artikelen", "facturen"] as const).map((v) => (
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
                {v === "regels"
                  ? "Per regel"
                  : v === "artikelen"
                    ? "Per artikel"
                    : "Per factuur"}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {notice && (
          <div className="flex items-center justify-between rounded-md border border-success/30 bg-success/5 px-4 py-2 text-sm text-success">
            {notice}
            <button
              type="button"
              onClick={() => setNotice(null)}
              title="Sluiten"
              className="opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {filters.view !== "facturen" && selectedRows.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-teal/40 bg-teal/5 px-3 py-2 text-sm">
                <span className="font-medium">
                  {selectedRows.length} geselecteerd
                </span>
                {selectedImpact > 0 && (
                  <span className="text-muted">
                    · {euro(selectedImpact)} te veel
                  </span>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={bulkBusy || bulkTargets.geaccepteerd.length === 0}
                    onClick={() => bulkReview("geaccepteerd")}
                    className="text-success"
                  >
                    <Check className="h-4 w-4" /> Accepteren (
                    {bulkTargets.geaccepteerd.length})
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={bulkBusy || bulkTargets.betwist.length === 0}
                    onClick={() => bulkReview("betwist")}
                    className="text-danger"
                  >
                    <Flag className="h-4 w-4" /> Betwisten (
                    {bulkTargets.betwist.length})
                  </Button>
                  {bulkTargets.reset.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={bulkBusy}
                      onClick={() => bulkReview(null)}
                      className="text-muted"
                    >
                      <RotateCcw className="h-4 w-4" /> Terugzetten (
                      {bulkTargets.reset.length})
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={bulkBusy}
                    onClick={() => setSelected(new Set())}
                  >
                    Selectie wissen
                  </Button>
                </div>
              </div>
        )}

        {filters.view === "artikelen" ? (
          <DeviationGroups
            groups={groups}
            loading={loading}
            companyName={companyName}
            open={openGroups}
            onToggle={(key) =>
              setOpenGroups((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            selected={selected}
            onSelectGroup={(g) => toggleSelectAll(g.rows.map((r) => r.row_id))}
            onToggleRow={toggleSelect}
            busyRow={busyRow}
            bulkBusy={bulkBusy}
            onReview={review}
          />
        ) : filters.view === "regels" ? (
          <div className="space-y-2">
            <ConfigurableTable<TableRow>
              storageKey="prijsvergelijking-regels"
              rows={loading ? [] : tableRows}
              columns={columns}
              selectedIds={selected}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              countLabel="regels"
              rowClassName={(r) =>
                r.priority === 1 && statusOf(r) === "open"
                  ? "bg-danger/5"
                  : undefined
              }
              emptyLabel={
                loading
                  ? "Bezig met vergelijken…"
                  : rows.length === 0
                    ? "Geen factuurregels met een referentieprijs in deze periode. Importeer een prijslijst of leg een contractprijs vast."
                    : "Niets gevonden met deze filters."
              }
            />
          </div>
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
          Vergeleken wordt met een geldige contractprijs (gaat altijd voor), of
          anders de laatste prijslijst/webshopprijs die gold op de factuurdatum
          (exclusief btw, per verpakking). Regels zonder referentieprijs staan
          onder &ldquo;Zonder referentieprijs&rdquo; en tellen niet mee in
          &ldquo;Mogelijk te veel betaald&rdquo;; regels met &ldquo;Controle
          nodig&rdquo; en geaccepteerde regels ook niet. &ldquo;Per
          artikel&rdquo; bundelt open afwijkingen per bedrijf, leverancier,
          artikelnummer en verpakking; de beoordeling blijft per factuurregel.
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

/**
 * Kolommen van de regel-weergave. Elke kolom kan de gebruiker via
 * "Kolommen" aan- of uitzetten, verslepen en breder/smaller maken.
 */
function buildColumns({
  busyRow,
  bulkBusy,
  onReview,
}: {
  busyRow: string | null;
  bulkBusy: boolean;
  onReview: (row: PriceComparisonRow, status: ReviewStatus) => void;
}): DataColumn<TableRow>[] {
  return [
    {
      key: "prio",
      label: "Prio",
      width: 100,
      value: (r) => r.priority,
      render: (r) => <PriorityBadge priority={r.priority} />,
    },
    {
      key: "leverancier",
      label: "Leverancier",
      width: 150,
      value: (r) => r.supplier_name,
    },
    {
      key: "artnr",
      label: "Art.nr",
      width: 80,
      value: (r) => r.article_number,
      render: (r) => (
        <span className="tabular text-muted">{r.article_number ?? "—"}</span>
      ),
    },
    {
      key: "product",
      label: "Product",
      width: 260,
      value: (r) => r.product_name ?? r.description,
      render: (r) => (
        <div>
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
        </div>
      ),
    },
    {
      key: "verpakking",
      label: "Verpakking",
      width: 110,
      value: (r) => r.packaging,
      render: (r) => <span className="text-muted">{r.packaging ?? "—"}</span>,
    },
    {
      key: "referentie",
      label: "Referentie",
      width: 120,
      align: "right",
      value: (r) => r.ref_price,
      render: (r) => <ReferenceCell row={r} />,
    },
    {
      key: "factuur",
      label: "Factuur",
      width: 90,
      align: "right",
      value: (r) => r.invoice_price,
      render: (r) => (
        <span className="font-medium">{euro(r.invoice_price)}</span>
      ),
    },
    {
      key: "verschil",
      label: "Verschil",
      width: 95,
      align: "right",
      value: (r) => r.diff_per_unit,
      render: (r) => (
        <span
          className={cn(
            (r.diff_per_unit ?? 0) > 0.005 && "text-danger",
            (r.diff_per_unit ?? 0) < -0.005 && "text-success",
          )}
        >
          {euro(r.diff_per_unit, true)}
          <div className="text-xs text-muted">{pct(r.diff_pct)}</div>
        </span>
      ),
    },
    {
      key: "aantal",
      label: "Aantal",
      width: 70,
      align: "right",
      value: (r) => r.quantity,
      render: (r) =>
        r.quantity === null ? "—" : r.quantity.toLocaleString("nl-NL"),
    },
    {
      key: "afwijking",
      label: "Afwijking",
      width: 100,
      align: "right",
      value: (r) => (r.impact === null ? null : Number(r.impact)),
      render: (r) => {
        const impact = Number(r.impact ?? 0);
        return (
          <span
            className={cn(
              "font-semibold",
              impact > 0 && "text-danger",
              impact < 0 && "text-success",
            )}
          >
            {r.impact === null ? "—" : euro(impact, true)}
          </span>
        );
      },
    },
    {
      key: "datum",
      label: "Datum",
      width: 90,
      value: (r) => r.invoice_date,
      render: (r) => (
        <span className="text-muted">{shortDate(r.invoice_date)}</span>
      ),
    },
    {
      key: "factuurnr",
      label: "Factuurnr",
      width: 110,
      hiddenByDefault: true,
      value: (r) => r.invoice_number,
    },
    {
      key: "status",
      label: "Status",
      width: 120,
      value: (r) => STATUS_LABEL[statusOf(r)],
      render: (r) => {
        const status = statusOf(r);
        return (
          <span
            className={cn(
              "text-xs font-medium",
              (status === "controle" || status === "zonder_referentie") &&
                "text-warning",
              status === "betwist" && "text-danger",
              (status === "akkoord" || status === "geaccepteerd") &&
                "text-success",
            )}
          >
            {(status === "controle" || status === "zonder_referentie") && (
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
            )}
            {STATUS_LABEL[status]}
          </span>
        );
      },
    },
    {
      key: "actie",
      label: "Actie",
      width: 230,
      noFilter: true,
      value: () => null,
      render: (r) => {
        const status = statusOf(r);
        const busy = bulkBusy || busyRow === r.row_id;
        return (
          <div className="flex items-center gap-1">
            {status === "zonder_referentie" ? (
              <Link
                href="/prijsvergelijking/contracten"
                title="Leg een contractprijs vast of importeer een prijslijst"
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-teal hover:bg-teal/10"
              >
                <Scale className="h-3.5 w-3.5" /> Contractprijs
              </Link>
            ) : r.review_status ? (
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
                  {canDisputeRow(r) && (
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
        );
      },
    },
  ];
}

/** Welke referentie is gebruikt en vanaf wanneer die geldt. */
function ReferenceCell({ row }: { row: PriceComparisonRow }) {
  if (row.ref_source === "geen" || row.ref_price === null) {
    return (
      <span className="text-xs text-warning" title={row.reasons.join("\n")}>
        geen referentie
      </span>
    );
  }
  const packDiffers =
    row.ref_packaging &&
    row.packaging &&
    row.ref_packaging.toLowerCase().replace(/\s/g, "") !==
      row.packaging.toLowerCase().replace(/\s/g, "");
  return (
    <>
      {euro(row.ref_price)}
      <div className="text-xs text-muted" title={referenceLabel(row)}>
        {row.ref_source === "contract" ? (
          <span className="font-medium text-teal">contract</span>
        ) : (
          "prijslijst"
        )}{" "}
        {row.ref_source === "contract" ? "vanaf " : "van "}
        {shortDate(row.ref_date)}
        {row.ref_valid_to && <> t/m {shortDate(row.ref_valid_to)}</>}
      </div>
      {packDiffers && (
        <div className="text-xs text-muted">ref. {row.ref_packaging}</div>
      )}
    </>
  );
}

/** Weergave "Per artikel": terugkerende open afwijkingen gebundeld. */
function DeviationGroups({
  groups,
  loading,
  companyName,
  open,
  onToggle,
  selected,
  onSelectGroup,
  onToggleRow,
  busyRow,
  bulkBusy,
  onReview,
}: {
  groups: DeviationGroup[];
  loading: boolean;
  companyName: Map<string, string>;
  open: Set<string>;
  onToggle: (key: string) => void;
  selected: Set<string>;
  onSelectGroup: (g: DeviationGroup) => void;
  onToggleRow: (id: string) => void;
  busyRow: string | null;
  bulkBusy: boolean;
  onReview: (row: PriceComparisonRow, status: ReviewStatus) => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2 font-medium">Prio</th>
                <th className="px-2 py-2 font-medium">Bedrijf</th>
                <th className="px-2 py-2 font-medium">Leverancier</th>
                <th className="px-2 py-2 font-medium">Art.nr</th>
                <th className="px-2 py-2 font-medium">Product</th>
                <th className="px-2 py-2 font-medium">Verpakking</th>
                <th className="px-2 py-2 text-right font-medium">Factuurregels</th>
                <th className="px-2 py-2 text-right font-medium">Totaal verschil</th>
                <th className="px-2 py-2 font-medium">Periode</th>
                <th className="px-2 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const isOpen = open.has(g.key);
                const allSelected = g.rows.every((r) => selected.has(r.row_id));
                return (
                  <GroupRows
                    key={g.key}
                    group={g}
                    isOpen={isOpen}
                    allSelected={allSelected}
                    company={g.companyId ? companyName.get(g.companyId) ?? "—" : "Groep"}
                    onToggle={() => onToggle(g.key)}
                    onSelectGroup={() => onSelectGroup(g)}
                    selected={selected}
                    onToggleRow={onToggleRow}
                    busyRow={busyRow}
                    bulkBusy={bulkBusy}
                    onReview={onReview}
                  />
                );
              })}
              {groups.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-muted">
                    {loading
                      ? "Bezig met vergelijken…"
                      : "Geen open prijsafwijkingen met deze filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function GroupRows({
  group: g,
  isOpen,
  allSelected,
  company,
  onToggle,
  onSelectGroup,
  selected,
  onToggleRow,
  busyRow,
  bulkBusy,
  onReview,
}: {
  group: DeviationGroup;
  isOpen: boolean;
  allSelected: boolean;
  company: string;
  onToggle: () => void;
  onSelectGroup: () => void;
  selected: Set<string>;
  onToggleRow: (id: string) => void;
  busyRow: string | null;
  bulkBusy: boolean;
  onReview: (row: PriceComparisonRow, status: ReviewStatus) => void;
}) {
  return (
    <>
      <tr
        className={cn(
          "cursor-pointer border-t border-border hover:bg-black/[0.02]",
          g.topPriority === 1 && "bg-danger/5",
        )}
        onClick={onToggle}
      >
        <td className="px-2 py-2 text-muted">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className="px-2 py-2">
          <PriorityBadge priority={g.topPriority} />
        </td>
        <td className="px-2 py-2 text-muted">{company}</td>
        <td className="px-2 py-2">{g.supplierName}</td>
        <td className="px-2 py-2 tabular text-muted">{g.articleNumber ?? "—"}</td>
        <td className="px-2 py-2 font-medium">
          {g.productName ?? "—"}
          {g.invoiceCount > 1 && (
            <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning">
              terugkerend · {g.invoiceCount} facturen
            </span>
          )}
        </td>
        <td className="px-2 py-2 text-muted">{g.packaging ?? "—"}</td>
        <td className="px-2 py-2 text-right tabular">{g.lineCount}</td>
        <td
          className={cn(
            "px-2 py-2 text-right tabular font-semibold",
            g.totalDiff > 0 && "text-danger",
            g.totalDiff < 0 && "text-success",
          )}
        >
          {euro(g.totalDiff, true)}
        </td>
        <td className="px-2 py-2 text-xs text-muted">
          {g.firstDate === g.lastDate
            ? shortDate(g.firstDate)
            : `${shortDate(g.firstDate)} – ${shortDate(g.lastDate)}`}
        </td>
        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onSelectGroup}
            className="text-xs text-teal hover:underline"
            title="Alle factuurregels van deze groep (de)selecteren voor beoordelen"
          >
            {allSelected ? "Deselecteren" : "Selecteren"}
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-background">
          <td />
          <td colSpan={10} className="px-2 pb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left uppercase tracking-wide text-muted">
                  <th className="w-6 py-1" />
                  <th className="py-1 font-medium">Factuur</th>
                  <th className="py-1 font-medium">Datum</th>
                  <th className="py-1 text-right font-medium">Referentie</th>
                  <th className="py-1 text-right font-medium">Factuurprijs</th>
                  <th className="py-1 text-right font-medium">Aantal</th>
                  <th className="py-1 text-right font-medium">Verschil</th>
                  <th className="py-1 font-medium">Status</th>
                  <th className="py-1 font-medium" />
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => {
                  const status = statusOf(r);
                  const busy = bulkBusy || busyRow === r.row_id;
                  return (
                    <tr key={r.row_id} className="border-t border-border/60">
                      <td className="py-1">
                        <input
                          type="checkbox"
                          checked={selected.has(r.row_id)}
                          onChange={() => onToggleRow(r.row_id)}
                        />
                      </td>
                      <td className="py-1 font-medium">{r.invoice_number ?? "—"}</td>
                      <td className="py-1 text-muted">{shortDate(r.invoice_date)}</td>
                      <td className="py-1 text-right">
                        <ReferenceCell row={r} />
                      </td>
                      <td className="py-1 text-right tabular">{euro(r.invoice_price)}</td>
                      <td className="py-1 text-right tabular">
                        {r.quantity === null ? "—" : r.quantity.toLocaleString("nl-NL")}
                      </td>
                      <td
                        className={cn(
                          "py-1 text-right tabular font-medium",
                          Number(r.impact ?? 0) > 0 && "text-danger",
                          Number(r.impact ?? 0) < 0 && "text-success",
                        )}
                      >
                        {r.impact === null ? "—" : euro(Number(r.impact), true)}
                      </td>
                      <td className="py-1">{STATUS_LABEL[status]}</td>
                      <td className="py-1">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onReview(r, "geaccepteerd")}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-success hover:bg-success/10"
                          >
                            <Check className="h-3.5 w-3.5" /> Accepteren
                          </button>
                          {canDisputeRow(r) && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onReview(r, "betwist")}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-danger hover:bg-danger/10"
                            >
                              <Flag className="h-3.5 w-3.5" /> Betwisten
                            </button>
                          )}
                          <Link
                            href={`/leveranciers/prijzen/importeren/${r.batch_id}`}
                            title={`Factuur ${r.invoice_number ?? ""} bekijken`}
                            className="inline-flex items-center rounded px-1.5 py-0.5 text-teal hover:bg-teal/10"
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

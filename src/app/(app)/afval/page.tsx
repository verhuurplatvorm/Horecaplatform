"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { WasteQuickEntry } from "@/components/waste/quick-entry";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  PERIOD_PRESETS,
  parseWasteFilter,
  periodLabel,
  periodRange,
  wasteHref,
  wasteTotals,
  type WasteFilter,
} from "@/lib/waste/period";
import type { ConsumptionType, WasteOverviewRow } from "@/lib/types/database";

export default function AfvalPage() {
  return (
    <>
      <Topbar title="Afval & personeelsmaaltijden" />
      <Suspense fallback={<p className="p-6 text-sm text-muted">Laden…</p>}>
        <AfvalOverzicht />
      </Suspense>
    </>
  );
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });

/**
 * Snelinvoer bovenaan; daaronder het overzicht met dezelfde filters voor
 * bedrijf en periode als het dashboardblok (waste_overview). De filters
 * staan in de URL, zodat de doorklik vanaf het dashboard precies dezelfde
 * registraties en hetzelfde totaal laat zien.
 */
function AfvalOverzicht() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { companies, scope, activeCompanyIds } = useCompanyScope();

  // URL is leidend zodra er een periode in staat (dashboard of eerder gekozen);
  // anders begint het overzicht bij de bedrijfskeuze bovenin.
  const fromUrl = params.has("periode") || params.has("dagen");
  const filter: WasteFilter = useMemo(() => {
    const f = parseWasteFilter(params);
    if (fromUrl) return f;
    return {
      companyIds: scope.mode === "companies" && activeCompanyIds.length ? activeCompanyIds : null,
      period: f.period,
    };
  }, [params, fromUrl, scope.mode, activeCompanyIds]);

  const regType: ConsumptionType = params.get("soort") === "personeelsmaaltijd" ? "personeelsmaaltijd" : "afval";
  const [reasonId, setReasonId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [result, setResult] = useState<{ key: string; rows: WasteOverviewRow[] } | null>(null);
  const [reload, setReload] = useState(0);

  const range = periodRange(filter.period);
  const companyKey = filter.companyIds?.join(",") ?? "alle";
  const loadKey = `${companyKey}|${range.from}|${range.to}|${regType}|${reload}`;

  const navigate = useCallback(
    (next: WasteFilter, soort: ConsumptionType = regType) => {
      const href = wasteHref(next, soort === "personeelsmaaltijd" ? { soort } : {});
      router.replace(href.replace("/afval", pathname), { scroll: false });
    },
    [router, pathname, regType],
  );

  useEffect(() => {
    let cancelled = false;
    void createClient()
      .rpc("waste_overview", {
        p_company_ids: filter.companyIds,
        p_from: range.from,
        p_to: range.to,
        p_type: regType,
      })
      .then(({ data }) => {
        if (!cancelled) setResult({ key: loadKey, rows: (data as WasteOverviewRow[]) ?? [] });
      });
    return () => {
      cancelled = true;
    };
    // loadKey bevat alle invoer van de query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey]);

  const loading = result?.key !== loadKey;
  const all = useMemo(() => (loading ? [] : (result?.rows ?? [])), [loading, result]);
  const rows = all.filter(
    (r) => (!reasonId || r.reason_id === reasonId) && (!staffId || r.registered_by === staffId),
  );
  const totals = wasteTotals(rows);
  const reasons = useMemo(
    () => [...new Map(all.filter((r) => r.reason_id).map((r) => [r.reason_id!, r.reason_name ?? ""])).entries()],
    [all],
  );
  const staff = useMemo(
    () => [...new Map(all.filter((r) => r.registered_by).map((r) => [r.registered_by!, r.staff_name ?? ""])).entries()],
    [all],
  );
  const single = filter.companyIds?.length === 1 ? filter.companyIds[0] : null;

  function exportCsv() {
    const header = [
      "Datum", "Tijd", "Medewerker", "Product", "Type", "Hoeveelheid",
      "Eenheid", "Reden", "Waarde", "Bedrijf", "Opmerking",
    ];
    const lines = rows.map((r) => {
      const d = new Date(r.registered_at);
      return [
        d.toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam" }),
        d.toLocaleTimeString("nl-NL", { timeZone: "Europe/Amsterdam" }),
        r.staff_name ?? "", r.item_name ?? "", r.item_kind, String(r.quantity), r.unit_name ?? "",
        r.reason_name ?? "", r.waste_value != null ? Number(r.waste_value).toFixed(2) : "",
        r.company_name ?? "", r.note ?? "",
      ];
    });
    const csv = [header, ...lines]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = regType === "afval" ? "afvalregistraties.csv" : "personeelsmaaltijden.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-3 sm:p-6">
      <WasteQuickEntry
        preferredCompanyId={single}
        initialType={regType}
        onSaved={() => setReload((n) => n + 1)}
      />

      {/* Filters: zelfde betekenis als op het dashboard */}
      <div className="space-y-2 rounded-md border border-border bg-surface px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs uppercase tracking-wide text-muted">Bedrijf</span>
          {[{ id: null as string | null, name: "Alle bedrijven" }, ...companies].map((c) => {
            const on = c.id === null ? filter.companyIds === null : single === c.id;
            return (
              <button
                key={c.id ?? "alle"}
                type="button"
                onClick={() => navigate({ ...filter, companyIds: c.id ? [c.id] : null })}
                className={cn(
                  "h-10 rounded-full border px-4 text-sm",
                  on ? "border-navy bg-navy font-medium text-white" : "border-border bg-background",
                )}
              >
                {c.name}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs uppercase tracking-wide text-muted">Periode</span>
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => navigate({ ...filter, period: { key: p.key } })}
              className={cn(
                "h-10 rounded-full border px-4 text-sm",
                filter.period.key === p.key
                  ? "border-navy bg-navy font-medium text-white"
                  : "border-border bg-background",
              )}
            >
              {p.label}
            </button>
          ))}
          {filter.period.key === "dagen" && (
            <span className="h-10 rounded-full border border-navy bg-navy px-4 py-2 text-sm font-medium text-white">
              {periodLabel(filter.period)}
            </span>
          )}
          <span className="text-xs text-muted">
            {new Date(`${range.from}T12:00:00`).toLocaleDateString("nl-NL")} t/m{" "}
            {new Date(`${range.to}T12:00:00`).toLocaleDateString("nl-NL")}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 border-b border-border">
          {(
            [
              ["afval", "Afval / derving"],
              ["personeelsmaaltijd", "Personeelsmaaltijden"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => navigate(filter, key)}
              className={cn(
                "border-b-2 px-3 py-2 text-sm",
                regType === key
                  ? "border-teal font-medium text-teal"
                  : "border-transparent text-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          {regType === "afval" && reasons.length > 0 && (
            <select
              value={reasonId}
              onChange={(e) => setReasonId(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">Alle redenen</option>
              {reasons.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
          {staff.length > 0 && (
            <select
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">Alle medewerkers</option>
              {staff.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
          <Button variant="secondary" onClick={exportCsv}>
            <Download className="h-4 w-4" />
            Exporteren
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Datum/tijd</th>
                  <th className="px-4 py-2 font-medium">Bedrijf</th>
                  <th className="px-4 py-2 font-medium">Medewerker</th>
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 text-right font-medium">Hoeveelheid</th>
                  {regType === "afval" && <th className="px-4 py-2 font-medium">Reden</th>}
                  <th className="px-4 py-2 text-right font-medium">
                    {regType === "afval" ? "Afvalwaarde" : "Kosten"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-2 text-muted">{fmtDate(r.registered_at)}</td>
                    <td className="px-4 py-2">{r.company_name ?? "—"}</td>
                    <td className="px-4 py-2">{r.staff_name ?? "—"}</td>
                    <td className="px-4 py-2 font-medium">
                      {r.item_name ?? "—"}
                      <span className="ml-2 text-xs font-normal text-muted">{r.item_kind}</span>
                      {r.note && <span className="ml-2 text-xs font-normal text-muted">{r.note}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular">
                      {Number(r.quantity).toLocaleString("nl-NL")} {r.unit_name ?? ""}
                    </td>
                    {regType === "afval" && <td className="px-4 py-2 text-muted">{r.reason_name ?? "—"}</td>}
                    <td className="px-4 py-2 text-right tabular font-medium">
                      {r.waste_value != null ? `€ ${Number(r.waste_value).toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={regType === "afval" ? 7 : 6} className="px-4 py-8 text-center text-muted">
                      {loading ? "Registraties laden…" : "Geen registraties voor deze filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-3">
            <span className="text-sm text-muted">{totals.count} registratie(s)</span>
            <span className="tabular text-lg font-semibold text-danger">
              € {totals.value.toFixed(2)} {regType === "afval" ? "afvalwaarde" : "personeelskosten"}
            </span>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

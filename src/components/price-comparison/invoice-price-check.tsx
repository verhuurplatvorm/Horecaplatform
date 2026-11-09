"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Scale } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PriorityBadge } from "@/components/price-comparison/priority-badge";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { PriceComparisonRow } from "@/lib/types/database";
import {
  computeTotals,
  daysAgoIso,
  euro,
  normalizeComparisonRow,
  pct,
  presetComparisonFilters,
  statusOf,
  STATUS_LABEL,
} from "@/lib/price-comparison";

/**
 * Prijscontrole van één factuur: elke regel naast de contract- of
 * prijslijstprijs die gold op de factuurdatum. Alleen lezen — hier wordt
 * niets aan prijzen veranderd.
 */
export function InvoicePriceCheck({
  batchId,
  invoiceDate,
}: {
  batchId: string;
  invoiceDate: string;
}) {
  const [rows, setRows] = useState<PriceComparisonRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const date = new Date(invoiceDate);
    // Ruim venster rond de factuurdatum, zodat "herhaaldelijk te duur" en
    // "mogelijk dubbel" ook naar andere facturen kunnen kijken.
    createClient()
      .rpc("price_comparison", {
        p_from: daysAgoIso(120, date),
        p_to: daysAgoIso(-60, date),
        p_company_ids: null,
      })
      .then(({ data }) => {
        if (cancelled) return;
        setRows(
          ((data ?? []) as PriceComparisonRow[])
            .filter((r) => r.batch_id === batchId)
            .map(normalizeComparisonRow),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [batchId, invoiceDate]);

  const totals = useMemo(() => computeTotals(rows ?? []), [rows]);
  const deviating = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.priority < 5 || statusOf(r) === "controle")
        .sort(
          (a, b) =>
            a.priority - b.priority ||
            Math.abs(Number(b.impact ?? 0)) - Math.abs(Number(a.impact ?? 0)),
        ),
    [rows],
  );

  if (rows === null) return null;

  const supplierName = rows[0]?.supplier_name;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2 font-medium">
            <Scale className="h-4 w-4 text-teal" /> Prijscontrole
          </div>
          {rows.length === 0 ? (
            <span className="text-sm text-muted">
              Geen prijslijst of contractprijs om deze factuur mee te
              vergelijken.
            </span>
          ) : deviating.length === 0 ? (
            <span className="flex items-center gap-1 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> Alle {rows.length} vergeleken
              regels kloppen met de afgesproken prijs
            </span>
          ) : (
            <>
              <Figure
                label="Te veel"
                value={euro(totals.overcharged)}
                tone="danger"
              />
              <Figure
                label="Voordelig"
                value={euro(totals.favourable)}
                tone="success"
              />
              <Figure label="Netto" value={euro(totals.net, true)} />
              <span className="text-xs text-muted">
                {rows.length} regels vergeleken, {deviating.length} wijken af
                {totals.toCheck > 0 && `, ${totals.toCheck} controle nodig`}
              </span>
            </>
          )}
          {rows.length > 0 && (
            <Link
              href="/prijsvergelijking"
              onClick={() =>
                presetComparisonFilters({
                  supplier: supplierName ?? "alle",
                  status: "aandacht",
                })
              }
              className="ml-auto text-xs text-teal hover:underline"
            >
              Naar prijsvergelijking
            </Link>
          )}
        </div>

        {deviating.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-2 py-1.5 font-medium">Prio</th>
                  <th className="px-2 py-1.5 font-medium">Product</th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    Referentie
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    Factuur
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    Verschil
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">Aantal</th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    Afwijking
                  </th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {deviating.map((r) => {
                  const status = statusOf(r);
                  const impact = Number(r.impact ?? 0);
                  return (
                    <tr
                      key={r.row_id}
                      className="border-t border-border align-top"
                    >
                      <td className="px-2 py-1.5">
                        <PriorityBadge priority={r.priority} />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium">
                          {r.product_name ?? r.description}
                        </div>
                        {r.reasons.length > 0 && (
                          <div className="text-xs text-warning">
                            {r.reasons.join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular">
                        {euro(r.ref_price)}
                        <div className="text-xs text-muted">{r.ref_source}</div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular font-medium">
                        {euro(r.invoice_price)}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-2 py-1.5 text-right tabular",
                          r.diff_per_unit > 0.005 && "text-danger",
                          r.diff_per_unit < -0.005 && "text-success",
                        )}
                      >
                        {euro(r.diff_per_unit, true)}
                        <div className="text-xs text-muted">
                          {pct(r.diff_pct)}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular">
                        {r.quantity === null
                          ? "—"
                          : r.quantity.toLocaleString("nl-NL")}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-2 py-1.5 text-right tabular font-semibold",
                          impact > 0 && "text-danger",
                          impact < 0 && "text-success",
                        )}
                      >
                        {r.impact === null ? "—" : euro(impact, true)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                        {status === "controle" && (
                          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-warning" />
                        )}
                        {STATUS_LABEL[status]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "success";
}) {
  return (
    <div className="text-sm">
      <span className="text-muted">{label} </span>
      <span
        className={cn(
          "font-semibold tabular",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </span>
    </div>
  );
}

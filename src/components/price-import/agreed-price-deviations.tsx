"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Prijsalarmen uit facturen: regels die afwijken van een afgesproken prijs
 * (vaste prijslijst of contractprijs) en nog niet zijn beoordeeld
 * (agreed_price_deviations, migratie 0143). Deze tellen mee in de
 * "Prijsalarmen" op het dashboard. Beoordelen (accepteren / betwisten)
 * gebeurt in de prijsvergelijking.
 */

interface Row {
  row_id: string;
  batch_id: string;
  invoice_number: string | null;
  invoice_date: string;
  supplier_name: string;
  product_name: string | null;
  description: string | null;
  invoice_price: number;
  ref_price: number;
  ref_source: "contract" | "prijslijst";
  diff_pct: number | null;
  impact: number | null;
  reasons: string[];
}

const euro = (n: number | null) =>
  n === null ? "—" : `€ ${Number(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function AgreedPriceDeviations({
  rows: givenRows,
  days = 30,
}: {
  /** Vanaf het dashboard: precies de regels die de tegel telt. */
  rows?: Row[];
  days?: number;
} = {}) {
  const [loadedRows, setRows] = useState<Row[] | null>(null);
  const rows = givenRows ?? loadedRows;

  useEffect(() => {
    if (givenRows) return;
    let cancelled = false;
    createClient()
      .rpc("agreed_price_deviations", { p_days: 30 })
      .then(({ data }) => {
        if (!cancelled) setRows(((data ?? []) as Row[]).sort((a, b) => b.invoice_date.localeCompare(a.invoice_date)));
      });
    return () => {
      cancelled = true;
    };
  }, [givenRows]);

  if (!rows || rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 text-copper" />
          Afwijkingen van afgesproken prijzen ({rows.length})
        </CardTitle>
        <Link href="/prijsvergelijking" className="text-sm text-teal hover:underline">
          Beoordelen in de prijsvergelijking →
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        <p className="px-5 pb-2 text-xs text-muted">
          Factuurregels van de afgelopen {days} dagen die niet overeenkomen met de vaste prijslijst of
          contractprijs. Ze blijven een prijsalarm tot ze beoordeeld zijn, of tot een nieuwe prijslijst
          met deze prijs is ingevoerd.
        </p>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-2 font-medium">Ingrediënt</th>
                <th className="px-5 py-2 font-medium">Leverancier</th>
                <th className="px-5 py-2 font-medium">Factuur</th>
                <th className="px-5 py-2 text-right font-medium">Afgesproken</th>
                <th className="px-5 py-2 text-right font-medium">Gefactureerd</th>
                <th className="px-5 py-2 text-right font-medium">Verschil</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const up = r.invoice_price > r.ref_price;
                return (
                  <tr key={r.row_id} className="border-t border-border">
                    <td className="px-5 py-2">
                      <span className="font-medium">{r.product_name ?? r.description ?? "—"}</span>
                      <span className="block text-xs text-muted">
                        {r.ref_source === "contract" ? "contractprijs" : "vaste prijslijst"}
                      </span>
                    </td>
                    <td className="px-5 py-2 text-muted">{r.supplier_name}</td>
                    <td className="px-5 py-2">
                      <Link
                        href={`/leveranciers/prijzen/importeren/${r.batch_id}`}
                        className="text-teal hover:underline"
                      >
                        {r.invoice_number ?? "factuur"}
                      </Link>
                      <span className="block text-xs text-muted">
                        {new Date(r.invoice_date).toLocaleDateString("nl-NL")}
                      </span>
                    </td>
                    <td className="tabular px-5 py-2 text-right text-muted">{euro(r.ref_price)}</td>
                    <td className="tabular px-5 py-2 text-right font-medium">{euro(r.invoice_price)}</td>
                    <td className={cn("tabular whitespace-nowrap px-5 py-2 text-right", up ? "text-danger" : "text-success")}>
                      {up ? "+" : ""}
                      {r.diff_pct !== null ? `${Number(r.diff_pct).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%` : "—"}
                      {r.impact !== null && Number(r.impact) !== 0 && (
                        <span className="block text-xs">{euro(Number(r.impact))} totaal</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

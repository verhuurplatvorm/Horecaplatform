"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardFilterBar } from "@/components/dashboard/filter-bar";
import { createClient } from "@/lib/supabase/client";
import { fetchMarginProblems } from "@/lib/dashboard-data";
import { withReturnTo } from "@/lib/use-return-navigation";
import type { DashboardScope } from "@/lib/dashboard-links";
import type { DashboardMarginProblemRow } from "@/lib/types/database";

/**
 * Gerechten → filter "Margeprobleem" (vanaf het dashboard). Exact dezelfde
 * rijen als de tegel en het dashboardblok: zelfde databasefunctie, zelfde
 * bedrijf, actuele kaart en categorie.
 */
export function MarginProblemsList({ scope, clearHref }: { scope: DashboardScope; clearHref: string }) {
  const [rows, setRows] = useState<DashboardMarginProblemRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(scope);

  useEffect(() => {
    let cancelled = false;
    const s = JSON.parse(key) as DashboardScope;
    fetchMarginProblems(createClient(), s)
      .then((r) => !cancelled && setRows(r))
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const norm = rows?.[0]?.norm_pct ?? 33;
  return (
    <div className="space-y-3">
      <DashboardFilterBar
        title="Gerechten met een margeprobleem"
        count={rows ? rows.length : null}
        scope={scope}
        clearHref={clearHref}
        note={`foodcost boven ${norm}% · alleen volledige kostprijzen`}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Gerecht</th>
                  <th className="px-4 py-2 font-medium">Map</th>
                  <th className="px-4 py-2 font-medium">Bedrijf</th>
                  <th className="px-4 py-2 text-right font-medium">Kostprijs</th>
                  <th className="px-4 py-2 text-right font-medium">Verkoop excl. btw</th>
                  <th className="px-4 py-2 text-right font-medium">Foodcost</th>
                  <th className="px-4 py-2 text-right font-medium">Marge</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r) => (
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
                    <td className="px-4 py-2 text-muted">{r.company_name}</td>
                    <td className="px-4 py-2 text-right tabular">€ {r.cost_price.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right tabular">€ {r.sales_price.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right tabular font-semibold text-danger">
                      {r.foodcost_pct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2 text-right tabular text-muted">{r.margin_pct.toFixed(1)}%</td>
                  </tr>
                ))}
                {rows && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted">
                      Geen gerechten boven de foodcostnorm met deze filters.
                    </td>
                  </tr>
                )}
                {!rows && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted">
                      Bezig met rekenen…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-muted">
        Bij meerdere bedrijven staat elk gerecht één keer in de lijst, met het bedrijf waar de
        foodcost het hoogst is (gerekend met de inkoopprijzen van dat bedrijf).
      </p>
    </div>
  );
}

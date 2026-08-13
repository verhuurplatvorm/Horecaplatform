"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { usePermissions } from "@/components/permissions/permissions-context";

const FOODCOST_NORM = 33;

interface CompanySummary {
  companyId: string;
  companyName: string;
  dishCount: number;
  avgCostPrice: number | null;
  avgSalesPrice: number | null;
  avgFoodCostPct: number | null;
  aboveNormCount: number;
  missingPriceCount: number;
}

/**
 * Vergelijkt gemiddelde kostprijs, verkoopprijs en foodcost% van alle
 * goedgekeurde gerechten, per bedrijf naast elkaar — in tegenstelling
 * tot /dashboard/prijzen, dat maar één (het actieve) bedrijf toont.
 * Gebruikt dezelfde calculate_recipe_cost-functie als de rest van het
 * platform, dus de cijfers sluiten aan bij wat elders getoond wordt.
 */
export default function FinancieelBedrijvenPage() {
  const { can, loading: permissionsLoading } = usePermissions();
  const canViewFinancial = can("leveranciers").canViewFinancial;
  const [summaries, setSummaries] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (permissionsLoading || !canViewFinancial) return;
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      const supabase = createClient();

      const [{ data: companies, error: companiesError }, { data: recipes }] = await Promise.all([
        supabase.from("companies").select("id, name").order("name"),
        supabase
          .from("recipes")
          .select("id, sales_price, vat_rate")
          .eq("recipe_kind", "gerecht")
          .eq("status", "goedgekeurd"),
      ]);

      if (cancelled) return;
      if (companiesError || !companies) {
        setError("Kan bedrijven niet laden.");
        setLoading(false);
        return;
      }
      if (!recipes || recipes.length === 0) {
        setSummaries(
          companies.map((c) => ({
            companyId: c.id,
            companyName: c.name,
            dishCount: 0,
            avgCostPrice: null,
            avgSalesPrice: null,
            avgFoodCostPct: null,
            aboveNormCount: 0,
            missingPriceCount: 0,
          }))
        );
        setLoading(false);
        return;
      }

      const results = await Promise.all(
        companies.map(async (company) => {
          const costs = await Promise.all(
            recipes.map((r) =>
              supabase
                .rpc("calculate_recipe_cost", { p_recipe_id: r.id, p_company_id: company.id })
                .then(({ data }) => data as number | null)
            )
          );

          let costSum = 0;
          let costCount = 0;
          let salesSum = 0;
          let salesCount = 0;
          let foodCostSum = 0;
          let foodCostCount = 0;
          let aboveNormCount = 0;
          let missingPriceCount = 0;

          recipes.forEach((r, i) => {
            const cost = costs[i];
            if (cost !== null && cost !== undefined) {
              costSum += cost;
              costCount++;
            }
            if (r.sales_price) {
              salesSum += r.sales_price;
              salesCount++;
              const priceExclVat = r.sales_price / (1 + (r.vat_rate ?? 9) / 100);
              if (cost !== null && cost !== undefined && priceExclVat > 0) {
                const pct = (cost / priceExclVat) * 100;
                foodCostSum += pct;
                foodCostCount++;
                if (pct > FOODCOST_NORM) aboveNormCount++;
              }
            } else {
              missingPriceCount++;
            }
          });

          const summary: CompanySummary = {
            companyId: company.id,
            companyName: company.name,
            dishCount: recipes.length,
            avgCostPrice: costCount > 0 ? costSum / costCount : null,
            avgSalesPrice: salesCount > 0 ? salesSum / salesCount : null,
            avgFoodCostPct: foodCostCount > 0 ? foodCostSum / foodCostCount : null,
            aboveNormCount,
            missingPriceCount,
          };
          return summary;
        })
      );

      if (!cancelled) {
        setSummaries(results);
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [canViewFinancial, permissionsLoading]);

  return (
    <>
      <Topbar title="Kostprijs & foodcost per bedrijf" />
      <main className="space-y-4 p-6">
        {!permissionsLoading && !canViewFinancial ? (
          <p className="flex items-center gap-2 rounded-md bg-copper/10 p-3 text-sm text-copper">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            Je rol heeft geen toegang tot financiële gegevens.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              Gemiddelde kostprijs, verkoopprijs en foodcost% van alle goedgekeurde
              gerechten, per bedrijf naast elkaar. Voor prijsontwikkeling over tijd
              binnen één bedrijf, zie{" "}
              <a href="/dashboard/prijzen" className="text-teal hover:underline">
                Prijsontwikkeling &amp; foodcost
              </a>
              .
            </p>

            {loading && (
              <p className="text-sm text-muted">
                Kostprijzen worden berekend, dit kan even duren…
              </p>
            )}

            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted">
                        <th className="px-5 py-3 font-medium">Bedrijf</th>
                        <th className="px-5 py-3 font-medium">Gerechten</th>
                        <th className="px-5 py-3 font-medium">Gem. kostprijs</th>
                        <th className="px-5 py-3 font-medium">Gem. verkoopprijs</th>
                        <th className="px-5 py-3 font-medium">Gem. foodcost%</th>
                        <th className="px-5 py-3 font-medium">Boven norm</th>
                        <th className="px-5 py-3 font-medium">Zonder verkoopprijs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaries.map((s) => (
                        <tr key={s.companyId} className="border-t border-border">
                          <td className="px-5 py-3 font-medium">{s.companyName}</td>
                          <td className="px-5 py-3 tabular text-muted">{s.dishCount}</td>
                          <td className="px-5 py-3 tabular">
                            {s.avgCostPrice !== null ? `€ ${s.avgCostPrice.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-5 py-3 tabular">
                            {s.avgSalesPrice !== null ? `€ ${s.avgSalesPrice.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-5 py-3 tabular">
                            {s.avgFoodCostPct !== null ? (
                              <span
                                className={
                                  s.avgFoodCostPct > FOODCOST_NORM
                                    ? "text-danger"
                                    : "text-success"
                                }
                              >
                                {s.avgFoodCostPct.toFixed(1)}%
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-5 py-3 tabular">
                            {s.aboveNormCount > 0 ? (
                              <span className="flex items-center gap-1 text-copper">
                                <TriangleAlert className="h-3.5 w-3.5" /> {s.aboveNormCount}
                              </span>
                            ) : (
                              "0"
                            )}
                          </td>
                          <td className="px-5 py-3 tabular text-muted">
                            {s.missingPriceCount}
                          </td>
                        </tr>
                      ))}
                      {summaries.length === 0 && !loading && (
                        <tr>
                          <td colSpan={7} className="px-5 py-6 text-center text-muted">
                            {error ?? "Geen bedrijven of gerechten gevonden."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </>
  );
}

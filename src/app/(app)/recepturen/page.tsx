"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import type { Recipe } from "@/lib/types/database";

type RecipeListItem = Pick<
  Recipe,
  | "id"
  | "name"
  | "category"
  | "status"
  | "is_central"
  | "company_id"
  | "sales_price"
  | "portion_size"
  | "portion_unit"
>;

interface RecipeWithCost extends RecipeListItem {
  costPrice: number | null;
}

export default function RecepturenPage() {
  const { activeCompanyIds, scope, companies, loading: scopeLoading } =
    useCompanyScope();
  const [recipes, setRecipes] = useState<RecipeWithCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Voor de kostprijsberekening is een concreet bedrijf nodig (recepten
  // kunnen groepsbreed of lokaal zijn, maar inkoopprijzen kunnen per
  // bedrijf verschillen). Bij een groepsbrede weergave gebruiken we het
  // eerst zichtbare bedrijf als referentie.
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const referenceCompanyName = companies.find(
    (c) => c.id === referenceCompanyId
  )?.name;

  useEffect(() => {
    if (scopeLoading) return;
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from("recipes")
        .select("id, name, category, status, is_central, company_id, sales_price, portion_size, portion_unit")
        .order("name")
        .limit(100);

      if (cancelled) return;
      if (fetchError || !data) {
        setError(true);
        setLoading(false);
        return;
      }

      if (!referenceCompanyId) {
        setRecipes(data.map((r) => ({ ...r, costPrice: null })));
        setLoading(false);
        return;
      }

      const withCost = await Promise.all(
        data.map(async (recipe) => {
          const { data: cost } = await supabase.rpc("calculate_recipe_cost", {
            p_recipe_id: recipe.id,
            p_company_id: referenceCompanyId,
          });
          return { ...recipe, costPrice: cost ?? null };
        })
      );

      if (!cancelled) {
        setRecipes(withCost);
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [referenceCompanyId, scopeLoading]);

  return (
    <>
      <Topbar title="Recepturen" />
      <main className="p-6">
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Receptuur</th>
                  <th className="px-5 py-3 font-medium">Categorie</th>
                  <th className="px-5 py-3 font-medium">Bereik</th>
                  <th className="px-5 py-3 font-medium">Kostprijs</th>
                  <th className="px-5 py-3 font-medium">Verkoopprijs</th>
                  <th className="px-5 py-3 font-medium">Foodcost %</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recipes.map((r) => {
                  const foodCostPct =
                    r.costPrice !== null && r.sales_price
                      ? (r.costPrice / r.sales_price) * 100
                      : null;
                  return (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-5 py-3 font-medium">{r.name}</td>
                      <td className="px-5 py-3 text-muted">{r.category ?? "—"}</td>
                      <td className="px-5 py-3 text-muted">
                        {r.is_central ? "Centrale standaard" : "Lokale variant"}
                      </td>
                      <td className="px-5 py-3 tabular">
                        {loading
                          ? "…"
                          : r.costPrice !== null
                          ? `€ ${r.costPrice.toFixed(2)}`
                          : "—"}
                      </td>
                      <td className="px-5 py-3 tabular">
                        {r.sales_price ? `€ ${r.sales_price.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-5 py-3 tabular">
                        {foodCostPct !== null ? (
                          <span
                            className={
                              foodCostPct > 33 ? "text-danger" : "text-success"
                            }
                          >
                            {foodCostPct.toFixed(1)}%
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  );
                })}
                {recipes.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan recepturen niet laden — controleer de Supabase-koppeling."
                        : "Nog geen recepturen vastgelegd."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <p className="mt-3 text-xs text-muted">
          {referenceCompanyId
            ? `Kostprijzen zijn live berekend voor ${
                scope.mode === "group"
                  ? `${referenceCompanyName} (eerste bedrijf in groepsweergave)`
                  : referenceCompanyName
              }, op basis van de actuele inkoopprijzen.`
            : "Selecteer een bedrijf via de bedrijfsselector rechtsboven om actuele kostprijzen te zien."}
        </p>
      </main>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    goedgekeurd: "bg-success/10 text-success",
    concept: "bg-copper/10 text-copper",
    vervallen: "bg-muted/10 text-muted",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${styles[status] ?? styles.concept}`}>
      {status}
    </span>
  );
}

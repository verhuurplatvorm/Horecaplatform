"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Package, Plus, SoupIcon } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Recipe } from "@/lib/types/database";

type RecipeListItem = Pick<
  Recipe,
  | "id"
  | "name"
  | "category"
  | "status"
  | "recipe_kind"
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
  const [kindFilter, setKindFilter] = useState<"alle" | "gerecht" | "halfproduct">(
    "alle"
  );

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
        .select(
          "id, name, category, status, recipe_kind, is_central, company_id, sales_price, portion_size, portion_unit"
        )
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

  const filteredRecipes = useMemo(
    () =>
      kindFilter === "alle"
        ? recipes
        : recipes.filter((r) => r.recipe_kind === kindFilter),
    [recipes, kindFilter]
  );

  return (
    <>
      <Topbar title="Recepturen" />
      <main className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex gap-1 rounded-md border border-border bg-surface p-1">
            {(["alle", "gerecht", "halfproduct"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium capitalize",
                  kindFilter === k
                    ? "bg-teal text-white"
                    : "text-muted hover:text-foreground"
                )}
              >
                {k === "alle" ? "Alle" : k === "gerecht" ? "Gerechten" : "Halfproducten"}
              </button>
            ))}
          </div>
          <Link href="/recepturen/nieuw">
            <Button>
              <Plus className="h-4 w-4" />
              Nieuwe receptuur
            </Button>
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Naam</th>
                  <th className="px-5 py-3 font-medium">Soort</th>
                  <th className="px-5 py-3 font-medium">Categorie</th>
                  <th className="px-5 py-3 font-medium">Bereik</th>
                  <th className="px-5 py-3 font-medium">Kostprijs</th>
                  <th className="px-5 py-3 font-medium">Verkoopprijs</th>
                  <th className="px-5 py-3 font-medium">Foodcost %</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecipes.map((r) => {
                  const foodCostPct =
                    r.costPrice !== null && r.sales_price
                      ? (r.costPrice / r.sales_price) * 100
                      : null;
                  return (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-5 py-3 font-medium">
                        <Link
                          href={`/recepturen/${r.id}/bewerken`}
                          className="hover:text-teal hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                            r.recipe_kind === "gerecht"
                              ? "bg-teal/10 text-teal"
                              : "bg-copper/10 text-copper"
                          )}
                        >
                          {r.recipe_kind === "gerecht" ? (
                            <Package className="h-3 w-3" />
                          ) : (
                            <SoupIcon className="h-3 w-3" />
                          )}
                          {r.recipe_kind === "gerecht" ? "Gerecht" : "Halfproduct"}
                        </span>
                      </td>
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
                {filteredRecipes.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} className="px-5 py-6 text-center text-muted">
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
  const labels: Record<string, string> = {
    goedgekeurd: "actief",
    concept: "concept",
    vervallen: "gearchiveerd",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${styles[status] ?? styles.concept}`}>
      {labels[status] ?? status}
    </span>
  );
}

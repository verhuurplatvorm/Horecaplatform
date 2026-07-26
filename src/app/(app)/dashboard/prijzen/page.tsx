"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { PriceChangeHistory } from "@/lib/types/database";

const FOODCOST_NORM = 33;
const PERIODS = [
  { value: 7, label: "Laatste 7 dagen" },
  { value: 30, label: "Laatste 30 dagen" },
  { value: 90, label: "Laatste kwartaal" },
  { value: 365, label: "Laatste jaar" },
];

interface IngredientChange extends PriceChangeHistory {
  productName: string;
  supplierName: string;
  deltaPct: number;
}

interface RecipeChange {
  id: string;
  name: string;
  kind: "gerecht" | "halfproduct";
  oldCost: number;
  newCost: number;
  delta: number;
  deltaPct: number;
  salesPrice: number | null;
  vatRate: number;
  foodCostPct: number | null;
}

export default function PrijzenDashboardPage() {
  const { activeCompanyIds, companies, loading: scopeLoading } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const referenceCompanyName = companies.find((c) => c.id === referenceCompanyId)?.name;

  const [periodDays, setPeriodDays] = useState(30);
  const [ingredientChanges, setIngredientChanges] = useState<IngredientChange[]>([]);
  const [recipeChanges, setRecipeChanges] = useState<RecipeChange[]>([]);
  const [loading, setLoading] = useState(true);

  const asofDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - periodDays);
    return d.toISOString().slice(0, 10);
  }, [periodDays]);

  useEffect(() => {
    if (scopeLoading || !referenceCompanyId) return;
    let cancelled = false;

    async function run() {
      setLoading(true);
      const supabase = createClient();

      const { data: changes } = await supabase
        .from("price_change_history")
        .select("*")
        .not("old_price_per_base_unit", "is", null)
        .gte("valid_from", asofDate)
        .order("valid_from", { ascending: false })
        .limit(500);

      if (cancelled) return;

      let enrichedIngredients: IngredientChange[] = [];
      if (changes && changes.length > 0) {
        const productIds = [...new Set(changes.map((c) => c.product_id))];
        const supplierIds = [...new Set(changes.map((c) => c.supplier_id))];
        const [{ data: products }, { data: suppliers }] = await Promise.all([
          supabase.from("products").select("id, name").in("id", productIds),
          supabase.from("suppliers").select("id, name").in("id", supplierIds),
        ]);
        const productMap = new Map((products ?? []).map((p) => [p.id, p.name]));
        const supplierMap = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

        enrichedIngredients = changes.map((c) => ({
          ...c,
          productName: productMap.get(c.product_id) ?? "onbekend",
          supplierName: supplierMap.get(c.supplier_id) ?? "onbekend",
          deltaPct:
            c.old_price_per_base_unit && c.old_price_per_base_unit > 0
              ? ((c.new_price_per_base_unit! - c.old_price_per_base_unit) /
                  c.old_price_per_base_unit) *
                100
              : 0,
        }));
      }

      const { data: recipes } = await supabase
        .from("recipes")
        .select("id, name, recipe_kind, sales_price, vat_rate")
        .order("name");

      let enrichedRecipes: RecipeChange[] = [];
      if (recipes && recipes.length > 0) {
        enrichedRecipes = await Promise.all(
          recipes.map(async (r) => {
            const [{ data: newCost }, { data: oldCost }] = await Promise.all([
              supabase.rpc("calculate_recipe_cost", {
                p_recipe_id: r.id,
                p_company_id: referenceCompanyId,
              }),
              supabase.rpc("calculate_recipe_cost_asof", {
                p_recipe_id: r.id,
                p_company_id: referenceCompanyId,
                p_asof_date: asofDate,
              }),
            ]);
            const nc = newCost ?? 0;
            const oc = oldCost ?? 0;
            const delta = nc - oc;
            const priceExclVat = r.sales_price
              ? r.sales_price / (1 + (r.vat_rate ?? 9) / 100)
              : null;
            return {
              id: r.id,
              name: r.name,
              kind: r.recipe_kind,
              oldCost: oc,
              newCost: nc,
              delta,
              deltaPct: oc > 0 ? (delta / oc) * 100 : 0,
              salesPrice: r.sales_price,
              vatRate: r.vat_rate ?? 9,
              foodCostPct: priceExclVat && priceExclVat > 0 ? (nc / priceExclVat) * 100 : null,
            };
          })
        );
      }

      if (!cancelled) {
        setIngredientChanges(enrichedIngredients);
        setRecipeChanges(enrichedRecipes.filter((r) => Math.abs(r.delta) > 0.0001));
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [referenceCompanyId, scopeLoading, asofDate]);

  const stijgersIngredienten = [...ingredientChanges]
    .filter((c) => c.deltaPct > 0)
    .sort((a, b) => b.deltaPct - a.deltaPct);
  const dalersIngredienten = [...ingredientChanges]
    .filter((c) => c.deltaPct < 0)
    .sort((a, b) => a.deltaPct - b.deltaPct);

  const halfproductChanges = recipeChanges.filter((r) => r.kind === "halfproduct");
  const gerechtChanges = recipeChanges.filter((r) => r.kind === "gerecht");
  const gerechtenBovenNorm = gerechtChanges.filter(
    (r) => r.foodCostPct !== null && r.foodCostPct > FOODCOST_NORM
  );

  const gemiddeldeStijging =
    stijgersIngredienten.length > 0
      ? stijgersIngredienten.reduce((s, c) => s + c.deltaPct, 0) / stijgersIngredienten.length
      : 0;
  const gemiddeldeDaling =
    dalersIngredienten.length > 0
      ? dalersIngredienten.reduce((s, c) => s + c.deltaPct, 0) / dalersIngredienten.length
      : 0;

  return (
    <>
      <Topbar title="Prijzendashboard" />
      <main className="p-6 space-y-6">
        {!referenceCompanyId ? (
          <p className="text-sm text-muted">
            Selecteer een bedrijf via de bedrijfsselector rechtsboven.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">
                Voor {referenceCompanyName}, vergeleken met {periodDays} dagen geleden.
              </p>
              <select
                value={periodDays}
                onChange={(e) => setPeriodDays(Number(e.target.value))}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              >
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <SummaryCard label="Ingrediënten duurder" value={stijgersIngredienten.length} tone="bad" />
              <SummaryCard label="Ingrediënten goedkoper" value={dalersIngredienten.length} tone="good" />
              <SummaryCard label="Gem. stijging" value={`+${gemiddeldeStijging.toFixed(1)}%`} tone="bad" />
              <SummaryCard label="Gem. daling" value={`${gemiddeldeDaling.toFixed(1)}%`} tone="good" />
              <SummaryCard label="Halfproducten gewijzigd" value={halfproductChanges.length} />
              <SummaryCard label="Gerechten gewijzigd" value={gerechtChanges.length} />
              <SummaryCard
                label={`Boven ${FOODCOST_NORM}% foodcost`}
                value={gerechtenBovenNorm.length}
                tone={gerechtenBovenNorm.length > 0 ? "bad" : "good"}
              />
              <SummaryCard
                label="Grootste stijger"
                value={
                  stijgersIngredienten[0]
                    ? `+${stijgersIngredienten[0].deltaPct.toFixed(0)}%`
                    : "—"
                }
                sub={stijgersIngredienten[0]?.productName}
                tone="bad"
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <ChangeTable title="Top prijsstijgers — ingrediënten" rows={stijgersIngredienten.slice(0, 10)} />
              <ChangeTable title="Top prijsdalers — ingrediënten" rows={dalersIngredienten.slice(0, 10)} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Halfproducten — kostprijswijziging</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <RecipeChangeTable rows={halfproductChanges} basePath="/halfproducten" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Gerechten — kostprijs, foodcost &amp; marge</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <RecipeChangeTable rows={gerechtChanges} basePath="/recepturen" showFoodcost />
              </CardContent>
            </Card>

            {loading && <p className="text-sm text-muted">Bijwerken…</p>}
          </>
        )}
      </main>
    </>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "good" | "bad";
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
        <p
          className={cn(
            "tabular text-2xl font-semibold",
            tone === "bad" ? "text-danger" : tone === "good" ? "text-success" : "text-foreground"
          )}
        >
          {value}
        </p>
        {sub && <p className="truncate text-xs text-muted">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ChangeTable({ title, rows }: { title: string; rows: IngredientChange[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((c) => (
              <IngredientRow key={c.id} change={c} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-center text-muted">Geen wijzigingen</td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function IngredientRow({ change }: { change: IngredientChange }) {
  return (
    <tr className="border-t border-border">
      <td className="px-5 py-3">
        <Link
          href={`/producten/${change.product_id}/bewerken`}
          className="font-medium hover:text-teal hover:underline"
        >
          {change.productName}
        </Link>
        <p className="text-xs text-muted">{change.supplierName}</p>
      </td>
      <td className="px-5 py-3 tabular text-muted">
        € {change.old_price_per_base_unit?.toFixed(4)}
      </td>
      <td className="px-5 py-3 tabular">€ {change.new_price_per_base_unit?.toFixed(4)}</td>
      <td className="px-5 py-3">
        <span
          className={cn(
            "flex items-center gap-1 tabular",
            change.deltaPct > 0 ? "text-danger" : "text-success"
          )}
        >
          {change.deltaPct > 0 ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" />
          )}
          {change.deltaPct > 0 ? "+" : ""}
          {change.deltaPct.toFixed(1)}%
        </span>
      </td>
    </tr>
  );
}

function RecipeChangeTable({
  rows,
  basePath,
  showFoodcost,
}: {
  rows: RecipeChange[];
  basePath: string;
  showFoodcost?: boolean;
}) {
  const sorted = [...rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-muted">
          <th className="px-5 py-3 font-medium">Naam</th>
          <th className="px-5 py-3 font-medium">Oude kostprijs</th>
          <th className="px-5 py-3 font-medium">Nieuwe kostprijs</th>
          <th className="px-5 py-3 font-medium">Verschil</th>
          {showFoodcost && <th className="px-5 py-3 font-medium">Foodcost</th>}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.id} className="border-t border-border">
            <td className="px-5 py-3">
              <Link
                href={`${basePath}/${r.id}/bewerken`}
                className="font-medium hover:text-teal hover:underline"
              >
                {r.name}
              </Link>
            </td>
            <td className="px-5 py-3 tabular text-muted">€ {r.oldCost.toFixed(2)}</td>
            <td className="px-5 py-3 tabular">€ {r.newCost.toFixed(2)}</td>
            <td className="px-5 py-3">
              <span
                className={cn(
                  "flex items-center gap-1 tabular",
                  r.delta > 0 ? "text-danger" : "text-success"
                )}
              >
                {r.delta > 0 ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" />
                )}
                {r.delta > 0 ? "+" : ""}€{r.delta.toFixed(2)} ({r.deltaPct.toFixed(1)}%)
              </span>
            </td>
            {showFoodcost && (
              <td className="px-5 py-3">
                {r.foodCostPct !== null ? (
                  <span
                    className={cn(
                      "flex items-center gap-1 tabular",
                      r.foodCostPct > FOODCOST_NORM ? "text-copper" : "text-success"
                    )}
                  >
                    {r.foodCostPct > FOODCOST_NORM && <TriangleAlert className="h-3.5 w-3.5" />}
                    {r.foodCostPct.toFixed(1)}%
                  </span>
                ) : (
                  "—"
                )}
              </td>
            )}
          </tr>
        ))}
        {sorted.length === 0 && (
          <tr>
            <td colSpan={showFoodcost ? 5 : 4} className="px-5 py-6 text-center text-muted">
              Geen kostprijswijzigingen in deze periode.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

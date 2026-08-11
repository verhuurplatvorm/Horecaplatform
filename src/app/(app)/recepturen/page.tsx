"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Search, Trash2, Upload } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
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
  | "vat_rate"
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
  const [query, setQuery] = useState("");
  const [activeFolder, setActiveFolder] = useState<string>("__alle__");

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
      // Alleen gerechten — halfproducten hebben een eigen module
      // (spec: "Halfproducten mogen geen onderdeel zijn van de gewone
      // receptenlijst").
      // Gepagineerd ophalen — Supabase geeft maximaal 1000 rijen per
      // query terug en een vaste limiet kapt de lijst stilzwijgend af.
      const PAGE_SIZE = 1000;
      const data: Recipe[] = [];
      let fetchError = null;
      let from = 0;
      while (true) {
        const { data: page, error: pageError } = await supabase
          .from("recipes")
          .select(
            "id, name, category, status, is_central, company_id, sales_price, vat_rate, portion_size, portion_unit"
          )
          .eq("recipe_kind", "gerecht")
          .order("name")
          .range(from, from + PAGE_SIZE - 1);
        if (pageError) {
          fetchError = pageError;
          break;
        }
        if (!page || page.length === 0) break;
        data.push(...(page as Recipe[]));
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

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

  /**
   * Recept verwijderen — met vooraf-controle op de plekken die het
   * verwijderen blokkeren (database: on delete restrict), zodat de
   * gebruiker een leesbare uitleg krijgt in plaats van een technische
   * databasefout: menukaarten, gebruik als ingrediënt in een ander
   * recept, en gekoppelde verkoopproducten.
   */
  async function handleDeleteRecipe(recipe: RecipeWithCost) {
    const supabase = createClient();

    const [{ count: onMenus }, { count: usedAsIngredient }, { count: salesLinks }] =
      await Promise.all([
        supabase
          .from("menu_items")
          .select("id", { count: "exact", head: true })
          .eq("recipe_id", recipe.id),
        supabase
          .from("recipe_ingredients")
          .select("id", { count: "exact", head: true })
          .eq("sub_recipe_id", recipe.id),
        supabase
          .from("sales_product_components")
          .select("id", { count: "exact", head: true })
          .eq("recipe_id", recipe.id),
      ]);

    const blockers: string[] = [];
    if (onMenus) blockers.push(`staat op ${onMenus} menukaartregel(s)`);
    if (usedAsIngredient)
      blockers.push(`wordt als ingrediënt gebruikt in ${usedAsIngredient} ander(e) recept(en)`);
    if (salesLinks) blockers.push(`heeft ${salesLinks} gekoppeld(e) verkoopproduct(en)`);

    if (blockers.length > 0) {
      window.alert(
        `"${recipe.name}" kan niet verwijderd worden: het recept ${blockers.join(", ")}. ` +
          `Haal het daar eerst weg en probeer het opnieuw.`
      );
      return;
    }

    const ok = window.confirm(
      `"${recipe.name}" definitief verwijderen?\n\n` +
        `De ingrediëntregels en eventuele productiehistorie van dit recept ` +
        `worden ook verwijderd. Dit kan niet ongedaan gemaakt worden.`
    );
    if (!ok) return;

    const { error: deleteError } = await supabase
      .from("recipes")
      .delete()
      .eq("id", recipe.id);
    if (deleteError) {
      window.alert("Verwijderen mislukt: " + deleteError.message);
      return;
    }
    setRecipes((prev) => prev.filter((r) => r.id !== recipe.id));
  }

  /**
   * Map verwijderen — de recepten zelf blijven bestaan en verhuizen naar
   * "Zonder map" (de categorie wordt leeggemaakt). Recepten verwijderen
   * gaat bewust per recept, nooit per hele map tegelijk.
   */
  async function handleDeleteFolder(folder: string) {
    const count = recipes.filter((r) => r.category?.trim() === folder).length;
    const ok = window.confirm(
      `Map "${folder}" verwijderen?\n\n` +
        `De ${count} recept(en) in deze map worden NIET verwijderd — ze ` +
        `verhuizen naar "Zonder map".`
    );
    if (!ok) return;
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("recipes")
      .update({ category: null })
      .eq("category", folder)
      .eq("recipe_kind", "gerecht");
    if (updateError) {
      window.alert("Map verwijderen mislukt: " + updateError.message);
      return;
    }
    setRecipes((prev) =>
      prev.map((r) => (r.category?.trim() === folder ? { ...r, category: null } : r))
    );
    setActiveFolder("__alle__");
  }

  const q = query.trim().toLowerCase();
  const searchedRecipes = q
    ? recipes.filter((r) =>
        [r.name, r.category, r.status]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(q))
      )
    : recipes;

  // Mappen (categorieën) als tabbladen: elk recept staat alleen in zijn
  // eigen map, met "Alle mappen" als totaaloverzicht en "Zonder map"
  // voor recepten zonder categorie.
  const folders = Array.from(
    new Set(recipes.map((r) => r.category?.trim()).filter((c): c is string => !!c))
  ).sort((a, b) => a.localeCompare(b, "nl"));
  const hasUnfiled = recipes.some((r) => !r.category?.trim());
  const filteredRecipes =
    activeFolder === "__alle__"
      ? searchedRecipes
      : activeFolder === "__zonder__"
        ? searchedRecipes.filter((r) => !r.category?.trim())
        : searchedRecipes.filter((r) => r.category?.trim() === activeFolder);

  return (
    <>
      <Topbar title="Recepten (Gerechten)" />
      <main className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek op naam, categorie of status…"
              className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
            />
          </div>
          <Link href="/halfproducten/importeren">
            <Button variant="secondary">
              <Upload className="h-4 w-4" />
              Importeren (Excel)
            </Button>
          </Link>
          <Link href="/recepturen/nieuw">
            <Button>
              <Plus className="h-4 w-4" />
              Nieuw gerecht
            </Button>
          </Link>
        </div>

        {(folders.length > 0 || hasUnfiled) && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveFolder("__alle__")}
              className={`rounded-full px-3 py-1.5 text-sm ${
                activeFolder === "__alle__"
                  ? "bg-teal text-white"
                  : "bg-surface text-muted hover:bg-background"
              }`}
            >
              Alle mappen ({searchedRecipes.length})
            </button>
            {folders.map((folder) => {
              const count = searchedRecipes.filter(
                (r) => r.category?.trim() === folder
              ).length;
              return (
                <button
                  key={folder}
                  onClick={() => setActiveFolder(folder)}
                  className={`rounded-full px-3 py-1.5 text-sm ${
                    activeFolder === folder
                      ? "bg-teal text-white"
                      : "bg-surface text-muted hover:bg-background"
                  }`}
                >
                  {folder} ({count})
                </button>
              );
            })}
            {activeFolder !== "__alle__" && activeFolder !== "__zonder__" && (
              <button
                onClick={() => handleDeleteFolder(activeFolder)}
                title={'Map "' + activeFolder + '" verwijderen (recepten verhuizen naar Zonder map)'}
                className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Map verwijderen
              </button>
            )}
            {hasUnfiled && (
              <button
                onClick={() => setActiveFolder("__zonder__")}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  activeFolder === "__zonder__"
                    ? "bg-teal text-white"
                    : "bg-surface text-muted hover:bg-background"
                }`}
              >
                Zonder map ({searchedRecipes.filter((r) => !r.category?.trim()).length})
              </button>
            )}
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
<table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Naam</th>
                  <th className="px-5 py-3 font-medium">Categorie</th>
                  <th className="px-5 py-3 font-medium">Bereik</th>
                  <th className="px-5 py-3 font-medium">Kostprijs</th>
                  <th className="px-5 py-3 font-medium">Verkoopprijs</th>
                  <th className="px-5 py-3 font-medium">Foodcost %</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filteredRecipes.map((r) => {
                  const priceExclVat =
                    r.sales_price && r.vat_rate !== null
                      ? r.sales_price / (1 + r.vat_rate / 100)
                      : r.sales_price;
                  const foodCostPct =
                    r.costPrice !== null && priceExclVat
                      ? (r.costPrice / priceExclVat) * 100
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
                      <td className="px-5 py-3">
                        <button
                          onClick={() => handleDeleteRecipe(r)}
                          title="Recept verwijderen"
                          className="text-muted hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredRecipes.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan gerechten niet laden — controleer de Supabase-koppeling."
                        : q
                        ? "Geen gerechten gevonden voor deze zoekopdracht."
                        : "Nog geen gerechten vastgelegd."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
</div>
          </CardContent>
        </Card>
        <p className="mt-3 text-xs text-muted">
          {referenceCompanyId
            ? `Kostprijzen zijn live berekend voor ${
                scope.mode === "group"
                  ? `${referenceCompanyName} (eerste bedrijf in groepsweergave)`
                  : referenceCompanyName
              }, op basis van de actuele inkoopprijzen. Halfproducten beheer je nu apart onder "Halfproducten".`
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

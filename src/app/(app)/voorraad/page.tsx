"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, TriangleAlert, Search } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import type { ProductionLabel } from "@/lib/types/database";

interface AllergenSummary {
  bevat: string[];
  sporen: string[];
}

interface ProductionRow {
  movementId: string;
  recipeId: string;
  recipeName: string;
  storageMethod: string | null;
  unitName: string | null;
  quantity: number;
  batchNumber: string | null;
  productionAt: string;
  expiryAt: string | null;
  producedBy: string | null;
  extraText: string | null;
  allergens: AllergenSummary | null;
}

export default function ProductiesPage() {
  const { activeCompanyIds, scope, companies, loading: scopeLoading } =
    useCompanyScope();
  const [rows, setRows] = useState<ProductionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const referenceCompanyName = companies.find(
    (c) => c.id === referenceCompanyId
  )?.name;

  useEffect(() => {
    if (scopeLoading || !referenceCompanyId) return;
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const { data: movements } = await supabase
        .from("stock_movements")
        .select("*")
        .eq("company_id", referenceCompanyId)
        .eq("movement_type", "productie")
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelled || !movements || movements.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const recipeIds = [
        ...new Set(movements.map((m) => m.recipe_id).filter(Boolean)),
      ] as string[];
      const movementIds = movements.map((m) => m.id);

      const [{ data: recipes }, { data: units }, { data: labels }, { data: userProfiles }] =
        await Promise.all([
          supabase
            .from("recipes")
            .select("id, name, recipe_kind, storage_method, base_unit_id")
            .in("id", recipeIds),
          supabase.from("units").select("id, name"),
          supabase
            .from("production_labels")
            .select("*")
            .in("stock_movement_id", movementIds)
            .order("printed_at", { ascending: false }),
          supabase.from("user_profiles").select("id, full_name"),
        ]);
      if (cancelled) return;

      const recipeMap = new Map((recipes ?? []).map((r) => [r.id, r]));
      const unitNameById = new Map((units ?? []).map((u) => [u.id, u.name]));
      const userNameById = new Map(
        (userProfiles ?? []).map((u) => [u.id, u.full_name])
      );

      // Meest recente label per productieboeking (voor herdrukken).
      const latestLabelByMovement = new Map<string, ProductionLabel>();
      for (const l of labels ?? []) {
        if (!latestLabelByMovement.has(l.stock_movement_id)) {
          latestLabelByMovement.set(l.stock_movement_id, l as ProductionLabel);
        }
      }

      // Alleen halfproducten, meest recente productie bovenaan (al zo
      // gesorteerd door de query, maar expliciet gehouden na filtering).
      const halfproductMovements = movements.filter(
        (m) => m.recipe_id && recipeMap.get(m.recipe_id)?.recipe_kind === "halfproduct"
      );

      const uniqueRecipeIds = [
        ...new Set(halfproductMovements.map((m) => m.recipe_id!)),
      ];
      const allergensByRecipe = new Map<string, AllergenSummary>();
      await Promise.all(
        uniqueRecipeIds.map(async (id) => {
          const { data } = await supabase.rpc("calculate_recipe_allergens", {
            p_recipe_id: id,
          });
          if (data) allergensByRecipe.set(id, data as AllergenSummary);
        })
      );

      const result: ProductionRow[] = halfproductMovements.map((m) => {
        const recipe = recipeMap.get(m.recipe_id!);
        const label = latestLabelByMovement.get(m.id);
        const producedByNames = label
          ? [
              ...(label.produced_by_user_ids ?? []).map(
                (id: string) => userNameById.get(id) ?? null
              ),
              ...(label.produced_by_manual_names ?? []),
            ].filter(Boolean)
          : [];

        return {
          movementId: m.id,
          recipeId: m.recipe_id!,
          recipeName: recipe?.name ?? m.recipe_id!,
          storageMethod: recipe?.storage_method ?? null,
          unitName: recipe?.base_unit_id
            ? unitNameById.get(recipe.base_unit_id) ?? null
            : null,
          quantity: m.quantity_change,
          batchNumber: m.batch_number,
          productionAt: label?.production_at ?? m.created_at,
          expiryAt: label?.expiry_at ?? m.expiry_date ?? null,
          producedBy:
            m.produced_by ??
            (producedByNames.length > 0 ? producedByNames.join(", ") : null),
          extraText: label?.extra_text ?? null,
          allergens: allergensByRecipe.get(m.recipe_id!) ?? null,
        };
      });

      setRows(result);
      setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [referenceCompanyId, scopeLoading]);

  const q = query.trim().toLowerCase();
  const filteredRows = q
    ? rows.filter((r) =>
        [r.recipeName, r.batchNumber, r.producedBy, r.storageMethod]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(q))
      )
    : rows;

  return (
    <>
      <Topbar title="Producties" />
      <main className="p-6 space-y-4">
        {!referenceCompanyId ? (
          <p className="text-sm text-muted">
            Selecteer een bedrijf via de bedrijfsselector rechtsboven om
            producties te zien.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative max-w-sm flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Zoek op halfproduct, batchnummer of producent…"
                  className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
                />
              </div>
              <Link href="/voorraad/productie/nieuw">
                <Button>
                  <Plus className="h-4 w-4" />
                  Productie registreren
                </Button>
              </Link>
            </div>
            <p className="text-sm text-muted">
              Producties van halfproducten voor{" "}
              {scope.mode === "group"
                ? `${referenceCompanyName} (eerste bedrijf in groepsweergave)`
                : referenceCompanyName}
              , nieuwste bovenaan.
            </p>

            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
<table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-5 py-3 font-medium">Halfproduct</th>
                      <th className="px-5 py-3 font-medium">Geproduceerd door</th>
                      <th className="px-5 py-3 font-medium">Productiedatum</th>
                      <th className="px-5 py-3 font-medium">Houdbaar tot</th>
                      <th className="px-5 py-3 font-medium">Bewaren</th>
                      <th className="px-5 py-3 font-medium">Allergenen</th>
                      <th className="px-5 py-3 font-medium">Hoeveelheid</th>
                      <th className="px-5 py-3 font-medium">Batchnummer</th>
                      <th className="px-5 py-3 font-medium">Extra tekst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r) => {
                      const expiringSoon =
                        r.expiryAt && new Date(r.expiryAt) < new Date();
                      return (
                        <tr key={r.movementId} className="border-t border-border">
                          <td className="px-5 py-3 font-medium">
                            <Link
                              href={`/halfproducten/${r.recipeId}/bewerken`}
                              className="hover:text-teal hover:underline"
                            >
                              {r.recipeName}
                            </Link>
                          </td>
                          <td className="px-5 py-3 text-muted">
                            {r.producedBy ?? "—"}
                          </td>
                          <td className="px-5 py-3 text-muted">
                            {new Date(r.productionAt).toLocaleString("nl-NL")}
                          </td>
                          <td className="px-5 py-3">
                            {r.expiryAt ? (
                              <span
                                className={
                                  expiringSoon
                                    ? "flex items-center gap-1 text-danger"
                                    : "text-foreground"
                                }
                              >
                                {expiringSoon && (
                                  <TriangleAlert className="h-3.5 w-3.5" />
                                )}
                                {new Date(r.expiryAt).toLocaleDateString("nl-NL")}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-5 py-3 text-muted">
                            {r.storageMethod ?? "—"}
                          </td>
                          <td className="px-5 py-3 text-muted">
                            {r.allergens && r.allergens.bevat.length > 0
                              ? `Bevat ${r.allergens.bevat.join(", ")}`
                              : "Geen bekende allergenen"}
                          </td>
                          <td className="px-5 py-3 tabular">
                            {r.quantity} {r.unitName ?? ""}
                          </td>
                          <td className="px-5 py-3 text-muted">
                            {r.batchNumber ?? "—"}
                          </td>
                          <td className="px-5 py-3 text-muted">
                            {r.extraText ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRows.length === 0 && !loading && (
                      <tr>
                        <td colSpan={9} className="px-5 py-6 text-center text-muted">
                          {q
                            ? "Geen producties gevonden voor deze zoekopdracht."
                            : "Nog geen producties geregistreerd voor dit bedrijf."}
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

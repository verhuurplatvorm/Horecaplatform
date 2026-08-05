import { notFound } from "next/navigation";
import { PackageX } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { RecipeForm } from "@/components/recipes/recipe-form";
import {
  HalfproductIngredientenModule,
  ProductiesGeschiedenis,
} from "@/components/recipes/halfproduct-producties-blok";
import { UsedInOverview } from "@/components/recipes/used-in-overview";
import { createClient } from "@/lib/supabase/server";
import type { Recipe, RecipeIngredient } from "@/lib/types/database";

export default async function BewerkHalfproductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: recipe }, { data: ingredients }] = await Promise.all([
    supabase.from("recipes").select("*").eq("id", id).single(),
    supabase
      .from("recipe_ingredients")
      .select("*")
      .eq("recipe_id", id)
      .order("sort_order"),
  ]);

  if (!recipe) notFound();

  let unitName: string | null = null;
  if (recipe.base_unit_id) {
    const { data: unit } = await supabase
      .from("units")
      .select("name")
      .eq("id", recipe.base_unit_id)
      .single();
    unitName = unit?.name ?? null;
  }

  return (
    <>
      <Topbar title={`Bewerken: ${recipe.name}`} />
      <main className="max-w-6xl space-y-4 p-6">
        <div className="flex items-center gap-2 rounded-md border border-copper/30 bg-copper/10 px-3 py-2 text-sm text-copper">
          <PackageX className="h-4 w-4 shrink-0" />
          Halfproduct — alleen intern, niet verkoopbaar. Wordt nooit op een
          menukaart getoond en verschijnt niet als verkoopproduct.
        </div>
        <HalfproductIngredientenModule
          recipeId={id}
          standardYield={recipe.yield_quantity}
          unitName={unitName}
        />
        <RecipeForm
          initialRecipe={recipe as Recipe}
          initialIngredients={(ingredients as RecipeIngredient[]) ?? []}
          lockedKind="halfproduct"
        />
        <UsedInOverview recipeId={id} />
        <ProductiesGeschiedenis recipeId={id} unitName={unitName} />
      </main>
    </>
  );
}

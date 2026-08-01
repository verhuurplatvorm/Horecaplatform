import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { RecipeForm } from "@/components/recipes/recipe-form";
import {
  ProductiesBlok,
  ProductieWidget,
} from "@/components/recipes/halfproduct-producties-blok";
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
        <ProductiesBlok recipeId={id} unitName={unitName} />
        <ProductieWidget recipeId={id} standardYield={recipe.yield_quantity} unitName={unitName} />
        <RecipeForm
          initialRecipe={recipe as Recipe}
          initialIngredients={(ingredients as RecipeIngredient[]) ?? []}
          lockedKind="halfproduct"
        />
      </main>
    </>
  );
}

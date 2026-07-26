import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { RecipeForm } from "@/components/recipes/recipe-form";
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

  return (
    <>
      <Topbar title={`Bewerken: ${recipe.name}`} />
      <main className="max-w-4xl p-6">
        <RecipeForm
          initialRecipe={recipe as Recipe}
          initialIngredients={(ingredients as RecipeIngredient[]) ?? []}
          lockedKind="halfproduct"
        />
      </main>
    </>
  );
}

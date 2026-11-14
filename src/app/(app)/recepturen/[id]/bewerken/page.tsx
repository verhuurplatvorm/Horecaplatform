import { notFound, redirect } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { StickerQuickButton } from "@/components/stickers/sticker-quick-button";
import { RecipeForm } from "@/components/recipes/recipe-form";
import { RecipeMenuPlacements } from "@/components/recipes/recipe-menu-placements";
import { createClient } from "@/lib/supabase/server";
import { isOperator } from "@/lib/auth/operator";
import { RecipeReadOnly } from "@/components/operator/recipe-read-only";
import type { Recipe, RecipeIngredient } from "@/lib/types/database";

export default async function BewerkReceptuurPage({
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
  if (recipe.recipe_kind === "halfproduct") {
    redirect(`/halfproducten/${id}/bewerken`);
  }

  // Operator: alleen bekijken, geen bewerkscherm.
  if (await isOperator(supabase)) {
    return (
      <>
        <Topbar title={recipe.name} />
        <main className="p-4 md:p-6">
          <RecipeReadOnly
            recipe={recipe as Recipe}
            ingredients={(ingredients as RecipeIngredient[]) ?? []}
          />
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar title={`Bewerken: ${recipe.name}`} />
      <main className="space-y-4 p-6">
        <div className="flex justify-end">
          <StickerQuickButton recipeId={id} />
        </div>
        <RecipeForm
          initialRecipe={recipe as Recipe}
          initialIngredients={(ingredients as RecipeIngredient[]) ?? []}
          lockedKind="gerecht"
        />
        <RecipeMenuPlacements recipeId={id} recipeSalesPrice={recipe.sales_price} />
      </main>
    </>
  );
}

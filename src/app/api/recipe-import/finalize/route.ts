import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { normalizeUnitKey } from "@/lib/recipe-import/parse-halfproducts";
import { matchIngredient } from "@/lib/recipe-import/match-ingredient";

interface FinalizeIngredient {
  name: string;
  quantity: number;
  unitRaw: string;
  supplierArticleNumber: string | null;
}

interface FinalizeRecipe {
  name: string;
  externalId: string | null;
  ingredients: FinalizeIngredient[];
  linkedRecipeId?: string | null; // koppel aan bestaand i.p.v. nieuw aanmaken
  skip?: boolean;
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  }

  const groupId = await getCurrentGroupId(supabase);
  if (!groupId) {
    return NextResponse.json({ error: "Kan groep niet bepalen." }, { status: 400 });
  }

  const body = await request.json();
  const {
    recipes,
    recipeKind,
    companyId,
  }: {
    recipes: FinalizeRecipe[];
    recipeKind: "halfproduct" | "gerecht";
    companyId: string | null;
  } = body;

  if (!Array.isArray(recipes) || recipes.length === 0) {
    return NextResponse.json({ error: "Geen recepten om te importeren." }, { status: 400 });
  }

  // Eenheden één keer ophalen (key -> id), voor het omzetten van
  // Excel-eenheden (Stuks/Gram/Ml/...) naar de systeem-eenheid.
  const { data: units } = await supabase.from("units").select("id, key");
  const unitIdByKey = new Map((units ?? []).map((u) => [u.key, u.id]));

  const toImport = recipes.filter((r) => !r.skip);

  // Fase 1: alle recepten aanmaken (of koppelen aan een gekozen
  // bestaand recept), zodat namen die als ingrediënt van elkaar
  // gebruikt worden (bv. "Aioli" in "Tomaten aioli") in fase 2 correct
  // naar elkaar kunnen verwijzen, ongeacht de volgorde in het bestand.
  const recipeNameToId = new Map<string, string>();
  const createdRecipeIds: { name: string; id: string; wasLinked: boolean }[] = [];
  let createdCount = 0;
  let linkedCount = 0;
  let failedRecipes = 0;

  for (const recipe of toImport) {
    if (recipe.linkedRecipeId) {
      recipeNameToId.set(recipe.name.trim().toLowerCase(), recipe.linkedRecipeId);
      createdRecipeIds.push({ name: recipe.name, id: recipe.linkedRecipeId, wasLinked: true });
      linkedCount++;
      continue;
    }

    const { data: newRecipe, error: recipeError } = await supabase
      .from("recipes")
      .insert({
        group_id: groupId,
        company_id: companyId || null,
        name: recipe.name,
        recipe_kind: recipeKind,
        status: "concept" as const,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (recipeError || !newRecipe) {
      console.error(`[recipe-import] Kan recept "${recipe.name}" niet aanmaken:`, recipeError?.message);
      failedRecipes++;
      continue;
    }

    recipeNameToId.set(recipe.name.trim().toLowerCase(), newRecipe.id);
    createdRecipeIds.push({ name: recipe.name, id: newRecipe.id, wasLinked: false });
    createdCount++;
  }

  // Fase 2: ingrediëntregels koppelen en opslaan. Elke regel wordt
  // altijd bewaard — ook als er geen product/halfproduct gevonden is —
  // zodat het volledige recept zichtbaar blijft en duidelijk is welke
  // producten nog gekoppeld of aangemaakt moeten worden (rood
  // gemarkeerd op de receptpagina zelf).
  const results: {
    recipeName: string;
    recipeId: string;
    totalIngredients: number;
    matchedIngredients: number;
    unmatchedIngredients: number;
  }[] = [];

  for (const recipe of toImport) {
    const recipeId = recipeNameToId.get(recipe.name.trim().toLowerCase());
    if (!recipeId || recipe.linkedRecipeId) {
      // Gekoppeld aan een bestaand recept: ingrediënten daarvan blijven
      // ongewijzigd, we voegen niets dubbel toe.
      continue;
    }

    let matched = 0;
    let unmatched = 0;

    for (let i = 0; i < recipe.ingredients.length; i++) {
      const ing = recipe.ingredients[i];
      const match = await matchIngredient(
        supabase,
        groupId,
        ing.name,
        ing.supplierArticleNumber,
        recipeNameToId
      );

      const unitKey = normalizeUnitKey(ing.unitRaw);
      const unitId = unitIdByKey.get(unitKey) ?? unitIdByKey.get("stuk") ?? null;

      const { error: lineError } = await supabase.from("recipe_ingredients").insert({
        recipe_id: recipeId,
        product_id: match.type === "product" ? match.id : null,
        sub_recipe_id: match.type === "halfproduct" ? match.id : null,
        unmatched_name: match.type === "unmatched" ? ing.name : null,
        unmatched_article_number: match.type === "unmatched" ? ing.supplierArticleNumber : null,
        quantity: ing.quantity,
        unit_id: unitId,
        unit: "",
        sort_order: i,
      });

      if (lineError) {
        console.error(
          `[recipe-import] Kan ingrediënt "${ing.name}" van "${recipe.name}" niet opslaan:`,
          lineError.message
        );
        continue;
      }

      if (match.type === "unmatched") unmatched++;
      else matched++;
    }

    results.push({
      recipeName: recipe.name,
      recipeId,
      totalIngredients: recipe.ingredients.length,
      matchedIngredients: matched,
      unmatchedIngredients: unmatched,
    });
  }

  console.log(
    `[recipe-import] Klaar: ${createdCount} aangemaakt, ${linkedCount} gekoppeld aan bestaand, ${failedRecipes} mislukt.`
  );

  return NextResponse.json({
    created: createdCount,
    linked: linkedCount,
    failed: failedRecipes,
    results,
  });
}

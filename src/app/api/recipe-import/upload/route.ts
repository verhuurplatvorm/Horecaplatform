import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { parseHalfproductsExcel } from "@/lib/recipe-import/parse-halfproducts";

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

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Geen bestand ontvangen." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let recipes;
  try {
    recipes = parseHalfproductsExcel(buffer);
  } catch (err) {
    console.error("[recipe-import] Kan bestand niet lezen:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Kan bestand niet lezen: ${err.message}`
            : "Kan bestand niet lezen.",
      },
      { status: 400 }
    );
  }

  if (recipes.length === 0) {
    return NextResponse.json(
      {
        error:
          "Geen recepten herkend in dit bestand. Verwacht formaat: per recept een rij \"Item naam: ...\", gevolgd door ingrediëntregels.",
      },
      { status: 422 }
    );
  }

  console.log(
    `[recipe-import] ${recipes.length} recept(en) herkend, ${recipes.reduce((s, r) => s + r.ingredients.length, 0)} ingrediëntregels totaal.`
  );

  // Niet-blokkerende dubbel-detectie op receptnaam — de gebruiker kiest
  // zelf of het toch een nieuw, apart recept is.
  const recipesWithMatches = await Promise.all(
    recipes.map(async (recipe) => {
      const { data: candidates } = await supabase.rpc("match_recipe_by_name", {
        p_group_id: groupId,
        p_name: recipe.name,
      });
      return { ...recipe, candidates: candidates ?? [] };
    })
  );

  return NextResponse.json({ recipes: recipesWithMatches });
}

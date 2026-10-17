import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { matchIngredient } from "@/lib/recipe-import/match-ingredient";

// Loopt over alle halfproducten en zoekt voor elke nog niet gekoppelde
// ingrediëntregel opnieuw een zekere match (artikelnummer of exacte naam,
// ook op andere halfproducten). Alleen zekere koppelingen; geen gok.
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  const groupId = await getCurrentGroupId(supabase);
  if (!groupId) return NextResponse.json({ error: "Kan groep niet bepalen." }, { status: 400 });

  // Welke recepten worden doorgelopen: halfproducten (standaard) of gerechten.
  const body = await request.json().catch(() => ({}));
  const targetKind: "halfproduct" | "gerecht" = body?.recipeKind === "gerecht" ? "gerecht" : "halfproduct";

  const { data: halfs } = await supabase
    .from("recipes")
    .select("id, name, created_at")
    .eq("group_id", groupId)
    .eq("recipe_kind", "halfproduct")
    .order("created_at", { ascending: true })
    .limit(5000);

  // Namen van halfproducten: die kunnen als ingrediënt in elk recept staan.
  const nameToId = new Map<string, string>();
  for (const h of halfs ?? []) {
    const key = h.name.trim().toLowerCase();
    if (!nameToId.has(key)) nameToId.set(key, h.id);
  }
  let targetIds = (halfs ?? []).map((h) => h.id);
  if (targetKind === "gerecht") {
    const { data: gerechten } = await supabase
      .from("recipes")
      .select("id")
      .eq("group_id", groupId)
      .eq("recipe_kind", "gerecht")
      .limit(5000);
    targetIds = (gerechten ?? []).map((g) => g.id);
  }

  const lines: {
    id: string;
    recipe_id: string;
    unmatched_name: string;
    unmatched_article_number: string | null;
  }[] = [];
  for (let i = 0; i < targetIds.length; i += 150) {
    const { data } = await supabase
      .from("recipe_ingredients")
      .select("id, recipe_id, unmatched_name, unmatched_article_number")
      .in("recipe_id", targetIds.slice(i, i + 150))
      .not("unmatched_name", "is", null)
      .limit(10000);
    for (const l of data ?? []) {
      if (l.unmatched_name) lines.push(l as (typeof lines)[number]);
    }
  }

  const cache = new Map<string, Awaited<ReturnType<typeof matchIngredient>>>();
  const touched = new Set<string>();
  let linked = 0;
  let stillOpen = 0;

  for (const line of lines) {
    const key = `${line.unmatched_name.trim().toLowerCase()}|${line.unmatched_article_number ?? ""}`;
    let match = cache.get(key);
    if (!match) {
      match = await matchIngredient(
        supabase,
        groupId,
        line.unmatched_name,
        line.unmatched_article_number,
        nameToId
      );
      cache.set(key, match);
    }
    // Een halfproduct mag zichzelf niet als ingrediënt krijgen.
    if (match.type === "unmatched" || !match.id || (match.type === "halfproduct" && match.id === line.recipe_id)) {
      stillOpen++;
      continue;
    }
    const { error } = await supabase
      .from("recipe_ingredients")
      .update({
        product_id: match.type === "ingrediënt" ? match.id : null,
        sub_recipe_id: match.type === "halfproduct" ? match.id : null,
        unmatched_name: null,
        unmatched_article_number: null,
      })
      .eq("id", line.id);
    if (error) {
      stillOpen++;
      continue;
    }
    linked++;
    touched.add(line.recipe_id);
  }

  return NextResponse.json({
    checkedLines: lines.length,
    linked,
    stillOpen,
    recipesUpdated: touched.size,
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { displayNameFor } from "@/lib/menu-import/dish-matching";

interface FinalizeDish {
  name: string;
  description: string | null;
  price: number | null;
  category: string;
  /** Rubriek op de kaart (map op de menukaart). */
  section?: string | null;
  /** Soortmap in Gerechten voor een nieuw gerecht. */
  recipeFolder?: string | null;
  linkedRecipeId?: string | null;
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
    menuCardName,
    companyId,
    storagePath,
    dishes,
  }: {
    menuCardName: string;
    companyId: string | null;
    storagePath: string | null;
    dishes: FinalizeDish[];
  } = body;

  if (!menuCardName?.trim()) {
    return NextResponse.json({ error: "Naam van de menukaart is verplicht." }, { status: 400 });
  }
  if (!Array.isArray(dishes) || dishes.length === 0) {
    return NextResponse.json({ error: "Geen gerechten om te importeren." }, { status: 400 });
  }

  // Soortmappen in Gerechten voor nieuwe gerechten. Een gerecht hoort bij
  // een map via recipes.category (mapnaam, uniek per groep). Alleen
  // bestaande gewone mappen; ontbrekende worden als losse map aangemaakt.
  const folderByLower = new Map<string, string>();
  {
    const wanted = [
      ...new Set(
        dishes
          .filter((d) => !d.linkedRecipeId && d.recipeFolder?.trim())
          .map((d) => d.recipeFolder!.trim())
      ),
    ];
    for (const name of wanted) {
      const folder = await ensureRecipeFolder(supabase, groupId, name);
      if ("error" in folder) {
        return NextResponse.json({ error: folder.error }, { status: 400 });
      }
      folderByLower.set(name.toLowerCase(), folder.name);
    }
  }
  const sectionOf = (d: FinalizeDish) => d.section?.trim() || d.category;

  const { data: menuCard, error: menuCardError } = await supabase
    .from("menu_cards")
    .insert({
      group_id: groupId,
      company_id: companyId || null,
      name: menuCardName.trim(),
      status: "concept",
      source_file_path: storagePath,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (menuCardError || !menuCard) {
    return NextResponse.json(
      { error: "Kan menukaart niet aanmaken: " + (menuCardError?.message ?? "") },
      { status: 500 }
    );
  }

  // Rubrieken op de kaart in de volgorde waarin ze op de kaart staan.
  const usedCategories = [...new Set(dishes.map(sectionOf))];
  const folderIdByCategory = new Map<string, string>();
  for (let i = 0; i < usedCategories.length; i++) {
    const { data: folder } = await supabase
      .from("menu_folders")
      .insert({
        menu_card_id: menuCard.id,
        name: usedCategories[i],
        sort_order: i,
      })
      .select("id")
      .single();
    if (folder) folderIdByCategory.set(usedCategories[i], folder.id);
  }

  // Namen van gekoppelde bestaande gerechten, om af te wijkende kaartnamen
  // als weergavenaam te bewaren. Het bestaande gerecht zelf (incl.
  // verkoopprijs) wordt niet gewijzigd.
  const linkedIds = [...new Set(dishes.map((d) => d.linkedRecipeId).filter(Boolean))] as string[];
  const linkedNames = new Map<string, string>();
  if (linkedIds.length > 0) {
    const { data: linkedRecipes } = await supabase
      .from("recipes")
      .select("id, name")
      .eq("group_id", groupId)
      .in("id", linkedIds);
    for (const r of linkedRecipes ?? []) linkedNames.set(r.id, r.name);
  }

  let created = 0;
  let linked = 0;
  let failed = 0;

  for (let i = 0; i < dishes.length; i++) {
    const dish = dishes[i];
    const folderId = folderIdByCategory.get(sectionOf(dish));
    if (!folderId) {
      failed++;
      continue;
    }

    let recipeId =
      dish.linkedRecipeId && linkedNames.has(dish.linkedRecipeId) ? dish.linkedRecipeId : null;
    let displayName: string | null = null;

    if (!recipeId) {
      const { data: newRecipe, error: recipeError } = await supabase
        .from("recipes")
        .insert({
          group_id: groupId,
          company_id: companyId || null,
          name: dish.name,
          recipe_kind: "gerecht" as const,
          category: dish.recipeFolder?.trim()
            ? folderByLower.get(dish.recipeFolder.trim().toLowerCase()) ?? null
            : null,
          status: "concept" as const,
          sales_price: dish.price,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (recipeError || !newRecipe) {
        failed++;
        continue;
      }
      recipeId = newRecipe.id;
      created++;
    } else {
      displayName = displayNameFor(dish.name, linkedNames.get(recipeId) ?? dish.name);
      linked++;
    }

    const { error: itemError } = await supabase.from("menu_items").insert({
      folder_id: folderId,
      recipe_id: recipeId,
      display_name: displayName,
      short_description: dish.description,
      price: dish.price,
      sort_order: i,
    });
    if (itemError) failed++;
  }

  return NextResponse.json({ menuCardId: menuCard.id, created, linked, failed });
}

/**
 * Zoekt de gerechtenmap op naam (hoofdletterongevoelig) of maakt hem als
 * losse map aan. Een hoofdmap kan geen gerechten bevatten.
 */
async function ensureRecipeFolder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string,
  name: string
): Promise<{ name: string } | { error: string }> {
  const { data: folders } = await supabase
    .from("recipe_folders")
    .select("id, name, is_main, sort_order")
    .eq("group_id", groupId);
  const all = folders ?? [];
  const existing = all.find((f) => f.name.trim().toLowerCase() === name.toLowerCase());
  if (existing) {
    if (existing.is_main) {
      return {
        error: `"${existing.name}" is een hoofdmap in Gerechten en kan geen gerechten bevatten. Kies een andere map.`,
      };
    }
    return { name: existing.name };
  }
  const { error } = await supabase.from("recipe_folders").insert({
    group_id: groupId,
    name,
    is_main: false,
    parent_id: null,
    sort_order: all.reduce((max, f) => Math.max(max, f.sort_order ?? 0), 0) + 1,
  });
  if (error) return { error: "Kan map in Gerechten niet aanmaken: " + error.message };
  return { name };
}

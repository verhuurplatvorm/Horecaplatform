import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { displayNameFor } from "@/lib/menu-import/dish-matching";

interface FinalizeDish {
  name: string;
  description: string | null;
  price: number | null;
  category: string;
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
    recipeFolderName,
    parentFolderId,
  }: {
    menuCardName: string;
    companyId: string | null;
    storagePath: string | null;
    dishes: FinalizeDish[];
    recipeFolderName?: string | null;
    parentFolderId?: string | null;
  } = body;

  if (!menuCardName?.trim()) {
    return NextResponse.json({ error: "Naam van de menukaart is verplicht." }, { status: 400 });
  }
  if (!Array.isArray(dishes) || dishes.length === 0) {
    return NextResponse.json({ error: "Geen gerechten om te importeren." }, { status: 400 });
  }

  // Map in Gerechten voor de nieuw aan te maken gerechten. Een gerecht hoort
  // bij een map via recipes.category (mapnaam, uniek per groep).
  let recipeCategoryOverride: string | null = null;
  const wantedFolder = recipeFolderName?.trim();
  if (wantedFolder) {
    const folder = await ensureRecipeFolder(supabase, groupId, wantedFolder, parentFolderId ?? null);
    if ("error" in folder) {
      return NextResponse.json({ error: folder.error }, { status: 400 });
    }
    recipeCategoryOverride = folder.name;
  }

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

  const usedCategories = [...new Set(dishes.map((d) => d.category))];
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
    const folderId = folderIdByCategory.get(dish.category);
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
          category: recipeCategoryOverride ?? dish.category,
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
 * Zoekt de gerechtenmap op naam (hoofdletterongevoelig) of maakt hem aan.
 * Een hoofdmap kan geen gerechten bevatten, dus die naam weigeren we.
 */
async function ensureRecipeFolder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string,
  name: string,
  parentFolderId: string | null
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
        error: `"${existing.name}" is een hoofdmap in Gerechten en kan geen gerechten bevatten. Kies een andere mapnaam.`,
      };
    }
    return { name: existing.name };
  }

  const parent = parentFolderId ? all.find((f) => f.id === parentFolderId && f.is_main) : null;
  const { error } = await supabase.from("recipe_folders").insert({
    group_id: groupId,
    name,
    is_main: false,
    parent_id: parent?.id ?? null,
    sort_order: all.reduce((max, f) => Math.max(max, f.sort_order ?? 0), 0) + 1,
  });
  if (error) return { error: "Kan map in Gerechten niet aanmaken: " + error.message };
  return { name };
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentGroupId } from "@/lib/supabase/current-group";

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

    let recipeId = dish.linkedRecipeId ?? null;

    if (!recipeId) {
      const { data: newRecipe, error: recipeError } = await supabase
        .from("recipes")
        .insert({
          group_id: groupId,
          company_id: companyId || null,
          name: dish.name,
          recipe_kind: "gerecht" as const,
          category: dish.category,
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
      linked++;
    }

    const { error: itemError } = await supabase.from("menu_items").insert({
      folder_id: folderId,
      recipe_id: recipeId,
      short_description: dish.description,
      price: dish.price,
      sort_order: i,
    });
    if (itemError) failed++;
  }

  return NextResponse.json({ menuCardId: menuCard.id, created, linked, failed });
}

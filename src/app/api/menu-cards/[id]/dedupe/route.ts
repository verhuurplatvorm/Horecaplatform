import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import {
  candidatesForCompany,
  displayNameFor,
  groupCandidates,
  pickSuggestion,
  type MatchRow,
} from "@/lib/menu-import/dish-matching";

/**
 * Dubbele gerechten op een (geïmporteerde) menukaart koppelen aan de
 * gerechten die al bestonden.
 *
 * GET  → voorstellen: per kaartregel waarvan het gerecht pas bij/na het
 *        aanmaken van de kaart is ontstaan, de best passende oudere gerechten.
 * POST → voert de bevestigde koppelingen uit en verwijdert desgewenst de
 *        lege dubbele concept-gerechten (zonder ingrediënten en nergens
 *        anders gebruikt). Verkoopprijzen worden niet gewijzigd.
 */

// Gerechten die tot zoveel ná het aanmaken van de kaart zijn ontstaan,
// horen bij de import van die kaart.
const IMPORT_WINDOW_MS = 30 * 60 * 1000;

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function loadCard(supabase: Supabase, cardId: string, groupId: string) {
  const { data: card } = await supabase
    .from("menu_cards")
    .select("id, name, company_id, created_at, group_id")
    .eq("id", cardId)
    .eq("group_id", groupId)
    .single();
  if (!card) return null;

  const { data: folders } = await supabase
    .from("menu_folders")
    .select("id, name")
    .eq("menu_card_id", cardId);
  const folderIds = (folders ?? []).map((f) => f.id);
  const folderName = new Map((folders ?? []).map((f) => [f.id, f.name]));

  const { data: items } =
    folderIds.length > 0
      ? await supabase
          .from("menu_items")
          .select("id, folder_id, recipe_id, display_name, price, sort_order")
          .in("folder_id", folderIds)
          .order("sort_order")
      : { data: [] };

  return { card, items: items ?? [], folderName };
}

/** Is dit een leeg concept-gerecht dat alleen op deze kaartregel staat? */
async function emptyDuplicateIds(supabase: Supabase, recipeIds: string[]): Promise<Set<string>> {
  if (recipeIds.length === 0) return new Set();
  const [{ data: recipes }, { data: ingredients }, { data: usages }, { data: salesProducts }] =
    await Promise.all([
      supabase.from("recipes").select("id, status").in("id", recipeIds),
      supabase.from("recipe_ingredients").select("recipe_id").in("recipe_id", recipeIds),
      supabase.from("menu_items").select("recipe_id").in("recipe_id", recipeIds),
      // Verkoopartikels zouden mee verdwijnen (cascade) → dan niet verwijderen.
      supabase
        .from("sales_products")
        .select("auto_generated_from_recipe_id")
        .in("auto_generated_from_recipe_id", recipeIds),
    ]);
  const withIngredients = new Set([
    ...(ingredients ?? []).map((r) => r.recipe_id),
    ...(salesProducts ?? []).map((r) => r.auto_generated_from_recipe_id as string),
  ]);
  const useCount = new Map<string, number>();
  for (const u of usages ?? []) useCount.set(u.recipe_id, (useCount.get(u.recipe_id) ?? 0) + 1);
  return new Set(
    (recipes ?? [])
      .filter(
        (r) =>
          r.status === "concept" && !withIngredients.has(r.id) && (useCount.get(r.id) ?? 0) <= 1
      )
      .map((r) => r.id)
  );
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const groupId = await getCurrentGroupId(supabase);
  if (!groupId) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const loaded = await loadCard(supabase, id, groupId);
  if (!loaded) return NextResponse.json({ error: "Menukaart niet gevonden." }, { status: 404 });
  const { card, items, folderName } = loaded;

  const recipeIds = [...new Set(items.map((i) => i.recipe_id))];
  const { data: recipes } =
    recipeIds.length > 0
      ? await supabase
          .from("recipes")
          .select("id, name, status, created_at, recipe_kind")
          .in("id", recipeIds)
      : { data: [] };
  const recipeById = new Map((recipes ?? []).map((r) => [r.id, r]));

  const cardCreated = new Date(card.created_at).getTime();
  const imported = items.filter((i) => {
    const r = recipeById.get(i.recipe_id);
    if (!r || r.recipe_kind !== "gerecht") return false;
    const t = new Date(r.created_at).getTime();
    return t >= cardCreated - 60_000 && t <= cardCreated + IMPORT_WINDOW_MS;
  });

  if (imported.length === 0) {
    return NextResponse.json({ card, proposals: [] });
  }

  const names = imported.map((i) => recipeById.get(i.recipe_id)!.name);
  const { data: matchRows, error: matchError } = await supabase.rpc("match_menu_dishes_v2", {
    p_group_id: groupId,
    p_names: names,
    p_created_before: new Date(cardCreated - 60_000).toISOString(),
  });
  if (matchError) {
    return NextResponse.json({ error: "Vergelijken mislukt: " + matchError.message }, { status: 500 });
  }
  const perItem = groupCandidates((matchRows as MatchRow[] | null) ?? [], imported.length);
  const deletable = await emptyDuplicateIds(
    supabase,
    imported.map((i) => i.recipe_id)
  );

  const proposals = imported
    .map((item, idx) => {
      const current = recipeById.get(item.recipe_id)!;
      const candidates = candidatesForCompany(perItem[idx], card.company_id).filter(
        (c) => c.recipe_id !== item.recipe_id
      );
      const suggestion = pickSuggestion(candidates, card.company_id);
      return {
        itemId: item.id,
        folderName: folderName.get(item.folder_id) ?? "",
        cardName: item.display_name ?? current.name,
        price: item.price,
        currentRecipe: { id: current.id, name: current.name, status: current.status },
        currentIsEmptyDuplicate: deletable.has(current.id),
        candidates,
        suggestedRecipeId: suggestion.recipeId,
        confidence: suggestion.confidence,
      };
    })
    .filter((p) => p.candidates.length > 0);

  return NextResponse.json({ card, proposals });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const groupId = await getCurrentGroupId(supabase);
  if (!groupId) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const body = (await request.json()) as {
    links: { itemId: string; recipeId: string }[];
    deleteEmptyDuplicates: boolean;
  };
  if (!Array.isArray(body.links) || body.links.length === 0) {
    return NextResponse.json({ error: "Niets geselecteerd om te koppelen." }, { status: 400 });
  }

  const loaded = await loadCard(supabase, id, groupId);
  if (!loaded) return NextResponse.json({ error: "Menukaart niet gevonden." }, { status: 404 });
  const itemById = new Map(loaded.items.map((i) => [i.id, i]));

  const targetIds = [...new Set(body.links.map((l) => l.recipeId))];
  const oldIds = [
    ...new Set(body.links.map((l) => itemById.get(l.itemId)?.recipe_id).filter(Boolean)),
  ] as string[];
  const { data: recipes } = await supabase
    .from("recipes")
    .select("id, name, recipe_kind")
    .eq("group_id", groupId)
    .in("id", [...new Set([...targetIds, ...oldIds])]);
  const recipeById = new Map((recipes ?? []).map((r) => [r.id, r]));

  let linked = 0;
  let failed = 0;
  const replaced: string[] = [];

  for (const link of body.links) {
    const item = itemById.get(link.itemId);
    const target = recipeById.get(link.recipeId);
    if (!item || !target || target.recipe_kind !== "gerecht" || item.recipe_id === target.id) {
      failed++;
      continue;
    }
    const cardName = item.display_name ?? recipeById.get(item.recipe_id)?.name ?? target.name;
    const { error } = await supabase
      .from("menu_items")
      .update({ recipe_id: target.id, display_name: displayNameFor(cardName, target.name) })
      .eq("id", item.id);
    if (error) {
      failed++;
      continue;
    }
    linked++;
    replaced.push(item.recipe_id);
  }

  let deleted = 0;
  let kept = 0;
  if (body.deleteEmptyDuplicates && replaced.length > 0) {
    // Opnieuw controleren ná het omkoppelen: alleen lege concepten die
    // nu nergens meer op een kaart staan.
    const candidates = await emptyDuplicateIds(supabase, [...new Set(replaced)]);
    const { data: stillUsed } = await supabase
      .from("menu_items")
      .select("recipe_id")
      .in("recipe_id", [...candidates]);
    const used = new Set((stillUsed ?? []).map((u) => u.recipe_id));
    for (const recipeId of candidates) {
      if (used.has(recipeId)) {
        kept++;
        continue;
      }
      const { data: gone, error } = await supabase
        .from("recipes")
        .delete()
        .eq("id", recipeId)
        .eq("status", "concept")
        .select("id");
      if (error || !gone || gone.length === 0) kept++;
      else deleted++;
    }
  }

  return NextResponse.json({ linked, failed, deleted, kept });
}

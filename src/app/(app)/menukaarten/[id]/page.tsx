"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  TriangleAlert,
  X,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { MenuCard, MenuFolder, MenuItem, Recipe } from "@/lib/types/database";

const FOODCOST_NORM = 33;

interface ItemWithRecipe extends MenuItem {
  recipe?: Recipe;
  cost: number | null;
}

export default function MenukaartWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: menuCardId } = use(params);
  const router = useRouter();
  const { activeCompanyIds } = useCompanyScope();

  const [card, setCard] = useState<MenuCard | null>(null);
  const [folders, setFolders] = useState<MenuFolder[]>([]);
  const [items, setItems] = useState<ItemWithRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reloadToken, setReloadToken] = useState(0);
  const [addingRecipe, setAddingRecipe] = useState(false);
  const [addingFromRecipeFolder, setAddingFromRecipeFolder] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const referenceCompanyId = card?.company_id ?? activeCompanyIds[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const [{ data: cardData }, { data: folderData }] = await Promise.all([
        supabase.from("menu_cards").select("*").eq("id", menuCardId).single(),
        supabase.from("menu_folders").select("*").eq("menu_card_id", menuCardId).order("sort_order"),
      ]);
      if (cancelled) return;

      const folderIds = (folderData ?? []).map((f) => f.id);
      const { data: itemData } =
        folderIds.length > 0
          ? await supabase.from("menu_items").select("*").in("folder_id", folderIds).order("sort_order")
          : { data: [] };
      if (cancelled) return;

      setCard(cardData as MenuCard);
      setFolders((folderData as MenuFolder[]) ?? []);
      setSelectedFolderId((prev) => prev ?? (folderData && folderData.length > 0 ? folderData[0].id : null));
      if (folderData && folderData.length > 0) {
        setExpanded((prev) => (prev.size > 0 ? prev : new Set([folderData[0].id])));
      }

      const rawItems = (itemData as MenuItem[]) ?? [];
      const recipeIds = [...new Set(rawItems.map((i) => i.recipe_id))];
      let recipeMap = new Map<string, Recipe>();
      if (recipeIds.length > 0) {
        const { data: recipes } = await supabase.from("recipes").select("*").in("id", recipeIds);
        recipeMap = new Map(((recipes as Recipe[]) ?? []).map((r) => [r.id, r]));
      }

      const compId = (cardData as MenuCard | null)?.company_id ?? referenceCompanyId;
      const withCost = await Promise.all(
        rawItems.map(async (i) => {
          let cost: number | null = null;
          if (compId) {
            const { data } = await supabase.rpc("calculate_recipe_cost", {
              p_recipe_id: i.recipe_id,
              p_company_id: compId,
            });
            cost = data ?? null;
          }
          return { ...i, recipe: recipeMap.get(i.recipe_id), cost };
        })
      );

      if (!cancelled) {
        setItems(withCost);
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuCardId, reloadToken]);

  function reload() {
    setReloadToken((t) => t + 1);
  }

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, MenuFolder[]>();
    for (const f of folders) {
      const list = map.get(f.parent_folder_id) ?? [];
      list.push(f);
      map.set(f.parent_folder_id, list);
    }
    return map;
  }, [folders]);

  const itemsByFolder = useMemo(() => {
    const map = new Map<string, ItemWithRecipe[]>();
    for (const i of items) {
      const list = map.get(i.folder_id) ?? [];
      list.push(i);
      map.set(i.folder_id, list);
    }
    return map;
  }, [items]);

  async function handleAddFolder(parentId: string | null) {
    const name = window.prompt("Naam van de nieuwe map:");
    if (!name?.trim()) return;
    const supabase = createClient();
    const siblings = childrenByParent.get(parentId) ?? [];
    const { data } = await supabase
      .from("menu_folders")
      .insert({
        menu_card_id: menuCardId,
        parent_folder_id: parentId,
        name: name.trim(),
        sort_order: siblings.length,
      })
      .select("id")
      .single();
    if (data) {
      setExpanded((prev) => new Set(prev).add(parentId ?? "root"));
      reload();
    }
  }

  async function handleRenameFolder(folder: MenuFolder) {
    const name = window.prompt("Nieuwe naam:", folder.name);
    if (!name?.trim() || name === folder.name) return;
    const supabase = createClient();
    await supabase.from("menu_folders").update({ name: name.trim() }).eq("id", folder.id);
    reload();
  }

  async function handleDeleteFolder(folder: MenuFolder) {
    const childCount = (childrenByParent.get(folder.id) ?? []).length;
    const itemCount = (itemsByFolder.get(folder.id) ?? []).length;
    if (
      !window.confirm(
        `Map "${folder.name}" verwijderen?` +
          (childCount || itemCount
            ? ` Dit verwijdert ook ${childCount} submap(pen) en ${itemCount} gerecht-koppeling(en) (de gerechten zelf blijven bestaan).`
            : "")
      )
    ) {
      return;
    }
    const supabase = createClient();
    await supabase.from("menu_folders").delete().eq("id", folder.id);
    if (selectedFolderId === folder.id) setSelectedFolderId(null);
    reload();
  }

  async function handleMoveFolder(folder: MenuFolder, direction: -1 | 1) {
    const siblings = [...(childrenByParent.get(folder.parent_folder_id) ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order
    );
    const idx = siblings.findIndex((s) => s.id === folder.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const supabase = createClient();
    await Promise.all([
      supabase.from("menu_folders").update({ sort_order: siblings[swapIdx].sort_order }).eq("id", folder.id),
      supabase.from("menu_folders").update({ sort_order: folder.sort_order }).eq("id", siblings[swapIdx].id),
    ]);
    reload();
  }

  async function handleMoveItem(item: ItemWithRecipe, direction: -1 | 1) {
    const siblings = [...(itemsByFolder.get(item.folder_id) ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order
    );
    const idx = siblings.findIndex((s) => s.id === item.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const supabase = createClient();
    await Promise.all([
      supabase.from("menu_items").update({ sort_order: siblings[swapIdx].sort_order }).eq("id", item.id),
      supabase.from("menu_items").update({ sort_order: item.sort_order }).eq("id", siblings[swapIdx].id),
    ]);
    reload();
  }

  async function handleMoveItemToFolder(itemId: string, targetFolderId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item || item.folder_id === targetFolderId) return;
    const targetSiblings = itemsByFolder.get(targetFolderId) ?? [];
    const supabase = createClient();
    // Alleen folder_id (en een nieuwe sort_order aan het eind van de
    // doelmap) wordt aangepast — recept, prijs en overige gegevens van
    // het menukaartitem blijven exact zoals ze waren, geen duplicaat.
    await supabase
      .from("menu_items")
      .update({ folder_id: targetFolderId, sort_order: targetSiblings.length })
      .eq("id", itemId);
    reload();
  }

  async function handleToggleVisible(item: ItemWithRecipe) {
    const supabase = createClient();
    await supabase.from("menu_items").update({ is_visible: !item.is_visible }).eq("id", item.id);
    reload();
  }

  async function handleRemoveItem(item: ItemWithRecipe) {
    if (!window.confirm(`"${item.recipe?.name ?? "dit gerecht"}" van deze map verwijderen?`)) return;
    const supabase = createClient();
    await supabase.from("menu_items").delete().eq("id", item.id);
    reload();
  }

  async function handleDuplicate() {
    if (!card) return;
    const newName = window.prompt("Naam voor de gedupliceerde menukaart:", `${card.name} (kopie)`);
    if (!newName?.trim()) return;
    setDuplicating(true);
    const supabase = createClient();
    const { data: newId, error } = await supabase.rpc("duplicate_menu_card", {
      p_menu_card_id: card.id,
      p_new_name: newName.trim(),
    });
    setDuplicating(false);
    if (!error && newId) {
      router.push(`/menukaarten/${newId}`);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedItems = useMemo(
    () =>
      selectedFolderId
        ? [...(itemsByFolder.get(selectedFolderId) ?? [])].sort((a, b) => a.sort_order - b.sort_order)
        : [],
    [selectedFolderId, itemsByFolder]
  );
  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

  const folderStats = useMemo(() => {
    if (selectedItems.length === 0) return null;
    const withPrice = selectedItems.filter((i) => (i.price ?? i.recipe?.sales_price) && i.cost !== null);
    if (withPrice.length === 0) return null;
    const foodcosts = withPrice.map((i) => {
      const price = i.price ?? i.recipe!.sales_price!;
      const vat = i.recipe?.vat_rate ?? 9;
      const priceExcl = price / (1 + vat / 100);
      return (i.cost! / priceExcl) * 100;
    });
    return {
      count: selectedItems.length,
      avgFoodcost: foodcosts.reduce((a, b) => a + b, 0) / foodcosts.length,
      attentionCount: foodcosts.filter((f) => f > FOODCOST_NORM).length,
    };
  }, [selectedItems]);

  if (loading || !card) {
    return (
      <>
        <Topbar title="Menukaart" />
        <main className="p-6 text-sm text-muted">Laden…</main>
      </>
    );
  }

  return (
    <>
      <Topbar title={card.name} />
      <main className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[280px_1fr] md:p-6">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Link href={`/menukaarten/${menuCardId}/instellingen`} className="flex-1">
              <Button variant="secondary" className="w-full">
                <Settings className="h-3.5 w-3.5" />
                Instellingen
              </Button>
            </Link>
            <Button variant="secondary" onClick={handleDuplicate} disabled={duplicating} title="Dupliceren">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Card>
            <CardContent className="p-2">
              <div className="mb-2 flex items-center justify-between px-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Mappen</p>
                <button onClick={() => handleAddFolder(null)} title="Hoofdmap toevoegen">
                  <FolderPlus className="h-4 w-4 text-muted hover:text-teal" />
                </button>
              </div>
              <FolderList
                parentId={null}
                childrenByParent={childrenByParent}
                itemsByFolder={itemsByFolder}
                expanded={expanded}
                selectedFolderId={selectedFolderId}
                onToggleExpand={toggleExpand}
                onSelect={setSelectedFolderId}
                onAddSubfolder={handleAddFolder}
                onRename={handleRenameFolder}
                onDelete={handleDeleteFolder}
                onMove={handleMoveFolder}
                onMoveItemToFolder={handleMoveItemToFolder}
              />
              {folders.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted">Nog geen mappen.</p>
              )}
            </CardContent>
          </Card>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => setAddingFromRecipeFolder(true)}
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Receptmap toevoegen aan kaart
          </Button>
        </div>

        <div className="space-y-4">
          {!selectedFolder ? (
            <p className="text-sm text-muted">Selecteer of maak een map om gerechten toe te voegen.</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{selectedFolder.name}</h2>
                  {folderStats && (
                    <p className="text-sm text-muted">
                      {folderStats.count} gerecht(en) · gem. foodcost {folderStats.avgFoodcost.toFixed(1)}%
                      {folderStats.attentionCount > 0 && (
                        <span className="ml-2 text-copper">
                          · {folderStats.attentionCount} boven norm
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <Button onClick={() => setAddingRecipe(true)}>
                  <Plus className="h-4 w-4" />
                  Gerecht toevoegen
                </Button>
              </div>

              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
<table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted">
                        <th className="px-5 py-3 font-medium">Naam op kaart</th>
                        <th className="px-5 py-3 font-medium">Verkoopprijs</th>
                        <th className="px-5 py-3 font-medium">Kostprijs</th>
                        <th className="px-5 py-3 font-medium">Foodcost</th>
                        <th className="px-5 py-3 font-medium">Labels</th>
                        <th className="px-5 py-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItems.map((item, idx) => {
                        const price = item.price ?? item.recipe?.sales_price ?? null;
                        const vat = item.recipe?.vat_rate ?? 9;
                        const priceExcl = price ? price / (1 + vat / 100) : null;
                        const foodcost =
                          priceExcl && item.cost !== null ? (item.cost / priceExcl) * 100 : null;
                        return (
                          <tr
                            key={item.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/menu-item-id", item.id);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            className="cursor-grab border-t border-border active:cursor-grabbing"
                          >
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-1">
                                <div className="flex flex-col">
                                  <button
                                    onClick={() => handleMoveItem(item, -1)}
                                    disabled={idx === 0}
                                    className="text-muted hover:text-teal disabled:opacity-20"
                                  >
                                    <ArrowUp className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => handleMoveItem(item, 1)}
                                    disabled={idx === selectedItems.length - 1}
                                    className="text-muted hover:text-teal disabled:opacity-20"
                                  >
                                    <ArrowDown className="h-3 w-3" />
                                  </button>
                                </div>
                                <div>
                                  <p className={cn("font-medium", !item.is_visible && "text-muted line-through")}>
                                    {item.display_name ?? item.recipe?.name ?? "onbekend gerecht"}
                                  </p>
                                  {!item.recipe && (
                                    <p className="flex items-center gap-1 text-xs text-danger">
                                      <TriangleAlert className="h-3 w-3" /> gerecht niet gevonden
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3 tabular">
                              {price !== null ? (
                                <>
                                  € {price.toFixed(2)}
                                  {item.price !== null && item.recipe?.sales_price && (
                                    <p className="text-xs text-copper">
                                      afwijkend van € {item.recipe.sales_price.toFixed(2)}
                                    </p>
                                  )}
                                </>
                              ) : (
                                <span className="flex items-center gap-1 text-danger">
                                  <TriangleAlert className="h-3.5 w-3.5" /> geen prijs
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3 tabular text-muted">
                              {item.cost !== null ? `€ ${item.cost.toFixed(2)}` : "—"}
                            </td>
                            <td className="px-5 py-3">
                              {foodcost !== null ? (
                                <span className={foodcost > FOODCOST_NORM ? "text-copper" : "text-success"}>
                                  {foodcost.toFixed(1)}%
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex gap-1">
                                {item.is_new && <Badge label="Nieuw" tone="teal" />}
                                {item.is_popular && <Badge label="Populair" tone="copper" />}
                                {item.is_chefs_special && <Badge label="Chef's" tone="teal" />}
                                {item.is_vegetarian && <Badge label="Veg" tone="success" />}
                                {item.is_vegan && <Badge label="Vegan" tone="success" />}
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleToggleVisible(item)}
                                  title={item.is_visible ? "Verbergen" : "Zichtbaar maken"}
                                  className="text-muted hover:text-teal"
                                >
                                  {item.is_visible ? (
                                    <Eye className="h-4 w-4" />
                                  ) : (
                                    <EyeOff className="h-4 w-4" />
                                  )}
                                </button>
                                <ItemEditButton item={item} onSaved={reload} />
                                <button
                                  onClick={() => handleRemoveItem(item)}
                                  title="Van menukaart verwijderen"
                                  className="text-muted hover:text-danger"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {selectedItems.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-5 py-6 text-center text-muted">
                            Nog geen gerechten in deze map.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
</div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>

      {addingRecipe && selectedFolderId && (
        <AddRecipeModal
          folderId={selectedFolderId}
          existingRecipeIds={selectedItems.map((i) => i.recipe_id)}
          onClose={() => setAddingRecipe(false)}
          onAdded={() => {
            setAddingRecipe(false);
            reload();
          }}
        />
      )}

      {addingFromRecipeFolder && (
        <AddFromRecipeFolderModal
          menuCardId={menuCardId}
          cardFolders={folders}
          existingItems={items}
          onClose={() => setAddingFromRecipeFolder(false)}
          onAdded={() => {
            setAddingFromRecipeFolder(false);
            reload();
          }}
        />
      )}
    </>
  );
}

/**
 * "Receptmap toevoegen aan kaart": kies een receptmap (categorie uit de
 * keukenorganisatie) en een doelmap op deze kaart — alle gerechten uit
 * de receptmap worden in één keer toegevoegd. Standaard wordt een
 * kaartmap met dezelfde naam voorgesteld (zonder nummer-voorvoegsel
 * zoals "01. "), maar een bestaande kaartmap kiezen kan ook. Gerechten
 * die al ergens op de kaart staan worden overgeslagen. Eenrichtings-
 * verkeer: daarna is de kaart autonoom (eigen prijzen/volgorde).
 */
function AddFromRecipeFolderModal({
  menuCardId,
  cardFolders,
  existingItems,
  onClose,
  onAdded,
}: {
  menuCardId: string;
  cardFolders: MenuFolder[];
  existingItems: ItemWithRecipe[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [recipeFolders, setRecipeFolders] = useState<{ name: string; count: number }[]>([]);
  const [chosenRecipeFolder, setChosenRecipeFolder] = useState("");
  const [targetFolderId, setTargetFolderId] = useState<string>("__nieuw__");
  const [newFolderName, setNewFolderName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("recipes")
      .select("category")
      .eq("recipe_kind", "gerecht")
      .not("category", "is", null)
      .then(({ data }) => {
        const counts = new Map<string, number>();
        for (const r of data ?? []) {
          const c = r.category?.trim();
          if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        setRecipeFolders(
          Array.from(counts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name, "nl"))
        );
      });
  }, []);

  function suggestedCardFolderName(recipeFolder: string): string {
    // Nummer-voorvoegsels als "01. " zijn keukensortering; op de kaart
    // toont de map zich zonder ("01. HS Lunch" → "HS Lunch").
    return recipeFolder.replace(/^\d+\.\s*/, "").trim() || recipeFolder;
  }

  function handleChooseRecipeFolder(name: string) {
    setChosenRecipeFolder(name);
    if (name) setNewFolderName(suggestedCardFolderName(name));
  }

  async function handleAdd() {
    if (!chosenRecipeFolder) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();

    // 1. Doelmap bepalen (bestaand of nieuw)
    let folderId = targetFolderId;
    if (targetFolderId === "__nieuw__") {
      const name = newFolderName.trim() || suggestedCardFolderName(chosenRecipeFolder);
      const maxOrder = Math.max(0, ...cardFolders.map((f) => f.sort_order + 1));
      const { data: newFolder, error: folderError } = await supabase
        .from("menu_folders")
        .insert({ menu_card_id: menuCardId, name, sort_order: maxOrder })
        .select("id")
        .single();
      if (folderError || !newFolder) {
        setError("Kan kaartmap niet aanmaken: " + (folderError?.message ?? "onbekende fout"));
        setSaving(false);
        return;
      }
      folderId = newFolder.id;
    }

    // 2. Alle gerechten uit de receptmap ophalen (gepagineerd — geen
    // stille 1000-rijenlimiet)
    const recipes: { id: string }[] = [];
    let from = 0;
    while (true) {
      const { data: page } = await supabase
        .from("recipes")
        .select("id")
        .eq("recipe_kind", "gerecht")
        .eq("category", chosenRecipeFolder)
        .order("name")
        .range(from, from + 999);
      if (!page || page.length === 0) break;
      recipes.push(...page);
      if (page.length < 1000) break;
      from += 1000;
    }

    // 3. Gerechten die al ergens op deze kaart staan overslaan
    const alreadyOnCard = new Set(existingItems.map((i) => i.recipe_id));
    const toAdd = recipes.filter((r) => !alreadyOnCard.has(r.id));

    if (toAdd.length > 0) {
      const { count: existingCount } = await supabase
        .from("menu_items")
        .select("id", { count: "exact", head: true })
        .eq("folder_id", folderId);
      const startOrder = existingCount ?? 0;
      const { error: insertError } = await supabase.from("menu_items").insert(
        toAdd.map((r, i) => ({
          folder_id: folderId,
          recipe_id: r.id,
          sort_order: startOrder + i,
        }))
      );
      if (insertError) {
        setError("Toevoegen mislukt: " + insertError.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    window.alert(
      `${toAdd.length} gerecht(en) toegevoegd` +
        (recipes.length - toAdd.length > 0
          ? `, ${recipes.length - toAdd.length} overgeslagen (stond al op deze kaart).`
          : ".")
    );
    onAdded();
  }

  return (
    <Modal title="Receptmap toevoegen aan kaart" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Receptmap</label>
          <select
            value={chosenRecipeFolder}
            onChange={(e) => handleChooseRecipeFolder(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
          >
            <option value="">Kies een receptmap…</option>
            {recipeFolders.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} ({f.count} gerechten)
              </option>
            ))}
          </select>
          {recipeFolders.length === 0 && (
            <p className="mt-1 text-xs text-muted">
              Nog geen receptmappen — geef recepten een map via het receptenoverzicht of de import.
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Naar kaartmap</label>
          <select
            value={targetFolderId}
            onChange={(e) => setTargetFolderId(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
          >
            <option value="__nieuw__">Nieuwe kaartmap aanmaken</option>
            {cardFolders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        {targetFolderId === "__nieuw__" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Naam nieuwe kaartmap
            </label>
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="bv. Hoofdgerechten"
              className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
            />
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={handleAdd} disabled={!chosenRecipeFolder || saving}>
            {saving ? "Bezig…" : "Toevoegen aan kaart"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Annuleren
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Badge({ label, tone }: { label: string; tone: "teal" | "copper" | "success" }) {
  const styles = {
    teal: "bg-teal/10 text-teal",
    copper: "bg-copper/10 text-copper",
    success: "bg-success/10 text-success",
  };
  return <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", styles[tone])}>{label}</span>;
}

function FolderList({
  parentId,
  childrenByParent,
  itemsByFolder,
  expanded,
  selectedFolderId,
  onToggleExpand,
  onSelect,
  onAddSubfolder,
  onRename,
  onDelete,
  onMove,
  onMoveItemToFolder,
  depth = 0,
}: {
  parentId: string | null;
  childrenByParent: Map<string | null, MenuFolder[]>;
  itemsByFolder: Map<string, ItemWithRecipe[]>;
  expanded: Set<string>;
  selectedFolderId: string | null;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onAddSubfolder: (parentId: string) => void;
  onRename: (folder: MenuFolder) => void;
  onDelete: (folder: MenuFolder) => void;
  onMove: (folder: MenuFolder, direction: -1 | 1) => void;
  onMoveItemToFolder: (itemId: string, targetFolderId: string) => void;
  depth?: number;
}) {
  const children = [...(childrenByParent.get(parentId) ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  if (children.length === 0) return null;

  return (
    <ul>
      {children.map((folder, idx) => {
        const hasChildren = (childrenByParent.get(folder.id) ?? []).length > 0;
        const isExpanded = expanded.has(folder.id);
        const count = (itemsByFolder.get(folder.id) ?? []).length;
        return (
          <li key={folder.id}>
            <FolderRow
              folder={folder}
              idx={idx}
              siblingCount={children.length}
              hasChildren={hasChildren}
              isExpanded={isExpanded}
              count={count}
              depth={depth}
              selected={selectedFolderId === folder.id}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              onAddSubfolder={onAddSubfolder}
              onRename={onRename}
              onDelete={onDelete}
              onMove={onMove}
              onMoveItemToFolder={onMoveItemToFolder}
            />
            {isExpanded && (
              <FolderList
                parentId={folder.id}
                childrenByParent={childrenByParent}
                itemsByFolder={itemsByFolder}
                expanded={expanded}
                selectedFolderId={selectedFolderId}
                onToggleExpand={onToggleExpand}
                onSelect={onSelect}
                onAddSubfolder={onAddSubfolder}
                onRename={onRename}
                onDelete={onDelete}
                onMove={onMove}
                onMoveItemToFolder={onMoveItemToFolder}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FolderRow({
  folder,
  idx,
  siblingCount,
  hasChildren,
  isExpanded,
  count,
  depth,
  selected,
  onToggleExpand,
  onSelect,
  onAddSubfolder,
  onRename,
  onDelete,
  onMove,
  onMoveItemToFolder,
}: {
  folder: MenuFolder;
  idx: number;
  siblingCount: number;
  hasChildren: boolean;
  isExpanded: boolean;
  count: number;
  depth: number;
  selected: boolean;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onAddSubfolder: (parentId: string) => void;
  onRename: (folder: MenuFolder) => void;
  onDelete: (folder: MenuFolder) => void;
  onMove: (folder: MenuFolder, direction: -1 | 1) => void;
  onMoveItemToFolder: (itemId: string, targetFolderId: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-background",
        selected && "bg-teal/10 text-teal",
        dragOver && "bg-teal/20 outline outline-2 outline-teal"
      )}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/menu-item-id")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("text/menu-item-id")) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const itemId = e.dataTransfer.getData("text/menu-item-id");
        if (itemId) onMoveItemToFolder(itemId, folder.id);
      }}
    >
      <button onClick={() => onToggleExpand(folder.id)} className="shrink-0">
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )
        ) : (
          <span className="inline-block w-3.5" />
        )}
      </button>
      <button onClick={() => onSelect(folder.id)} className="flex-1 truncate text-left">
        {folder.name}
        {count > 0 && <span className="ml-1 text-xs text-muted">({count})</span>}
      </button>
      <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
        <button onClick={() => onMove(folder, -1)} disabled={idx === 0} className="disabled:opacity-20">
          <ArrowUp className="h-3 w-3 text-muted hover:text-teal" />
        </button>
        <button
          onClick={() => onMove(folder, 1)}
          disabled={idx === siblingCount - 1}
          className="disabled:opacity-20"
        >
          <ArrowDown className="h-3 w-3 text-muted hover:text-teal" />
        </button>
        <button onClick={() => onAddSubfolder(folder.id)} title="Submap toevoegen">
          <FolderPlus className="h-3.5 w-3.5 text-muted hover:text-teal" />
        </button>
        <button onClick={() => onRename(folder)} title="Hernoemen">
          <Pencil className="h-3.5 w-3.5 text-muted hover:text-teal" />
        </button>
        <button onClick={() => onDelete(folder)} title="Verwijderen">
          <Trash2 className="h-3.5 w-3.5 text-muted hover:text-danger" />
        </button>
      </div>
    </div>
  );
}

function AddRecipeModal({
  folderId,
  existingRecipeIds,
  onClose,
  onAdded,
}: {
  folderId: string;
  existingRecipeIds: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Recipe[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [recipeFolders, setRecipeFolders] = useState<string[]>([]);
  const [recipeFolderFilter, setRecipeFolderFilter] = useState("");

  useEffect(() => {
    // Beschikbare receptmappen (categorieën) voor het filter
    const supabase = createClient();
    supabase
      .from("recipes")
      .select("category")
      .eq("recipe_kind", "gerecht")
      .not("category", "is", null)
      .then(({ data }) => {
        const unique = Array.from(
          new Set((data ?? []).map((r) => r.category?.trim()).filter((c): c is string => !!c))
        ).sort((a, b) => a.localeCompare(b, "nl"));
        setRecipeFolders(unique);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const timeout = setTimeout(async () => {
      let q = supabase.from("recipes").select("*").eq("recipe_kind", "gerecht").order("name").limit(30);
      if (recipeFolderFilter) q = q.eq("category", recipeFolderFilter);
      if (query.trim()) q = q.ilike("name", `%${query.trim()}%`);
      const { data } = await q;
      if (!cancelled) setResults((data as Recipe[]) ?? []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, recipeFolderFilter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    setSaving(true);
    const supabase = createClient();
    const { count: existingCount } = await supabase
      .from("menu_items")
      .select("id", { count: "exact", head: true })
      .eq("folder_id", folderId);
    const startOrder = existingCount ?? 0;
    const rows = [...selected].map((recipeId, i) => ({
      folder_id: folderId,
      recipe_id: recipeId,
      sort_order: startOrder + i,
    }));
    await supabase.from("menu_items").insert(rows);
    setSaving(false);
    onAdded();
  }

  return (
    <Modal title="Gerecht toevoegen" onClose={onClose}>
      <div className="space-y-3">
        {recipeFolders.length > 0 && (
          <select
            value={recipeFolderFilter}
            onChange={(e) => setRecipeFolderFilter(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
          >
            <option value="">Alle receptmappen</option>
            {recipeFolders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Zoek op gerechtnaam…"
            className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
          />
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {results.map((r) => {
            const already = existingRecipeIds.includes(r.id);
            return (
              <li key={r.id}>
                <label
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    already ? "opacity-40" : "hover:bg-background"
                  )}
                >
                  <input
                    type="checkbox"
                    disabled={already}
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                  {r.name}
                  {already && <span className="text-xs text-muted">(al toegevoegd)</span>}
                </label>
              </li>
            );
          })}
          {results.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted">Geen gerechten gevonden.</p>
          )}
        </ul>
        <div className="flex gap-2">
          <Button onClick={handleAdd} disabled={selected.size === 0 || saving}>
            {saving ? "Bezig…" : `${selected.size} gerecht(en) toevoegen`}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Annuleren
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ItemEditButton({ item, onSaved }: { item: ItemWithRecipe; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="Menukaartgegevens bewerken" className="text-muted hover:text-teal">
        <Pencil className="h-4 w-4" />
      </button>
      {open && <ItemEditModal item={item} onClose={() => setOpen(false)} onSaved={onSaved} />}
    </>
  );
}

function ItemEditModal({
  item,
  onClose,
  onSaved,
}: {
  item: ItemWithRecipe;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(item.display_name ?? "");
  const [shortDescription, setShortDescription] = useState(item.short_description ?? "");
  const [price, setPrice] = useState(item.price?.toString() ?? "");
  const [availableFrom, setAvailableFrom] = useState(item.available_from ?? "");
  const [availableTo, setAvailableTo] = useState(item.available_to ?? "");
  const [isNew, setIsNew] = useState(item.is_new);
  const [isPopular, setIsPopular] = useState(item.is_popular);
  const [isChefsSpecial, setIsChefsSpecial] = useState(item.is_chefs_special);
  const [isVegetarian, setIsVegetarian] = useState(item.is_vegetarian);
  const [isVegan, setIsVegan] = useState(item.is_vegan);
  const [isGlutenFree, setIsGlutenFree] = useState(item.is_gluten_free);
  const [supplementPrice, setSupplementPrice] = useState(item.supplement_price?.toString() ?? "");
  const [pairedDrink, setPairedDrink] = useState(item.paired_drink ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from("menu_items")
      .update({
        display_name: displayName.trim() || null,
        short_description: shortDescription.trim() || null,
        price: price ? Number(price) : null,
        available_from: availableFrom || null,
        available_to: availableTo || null,
        is_new: isNew,
        is_popular: isPopular,
        is_chefs_special: isChefsSpecial,
        is_vegetarian: isVegetarian,
        is_vegan: isVegan,
        is_gluten_free: isGlutenFree,
        supplement_price: supplementPrice ? Number(supplementPrice) : null,
        paired_drink: pairedDrink.trim() || null,
      })
      .eq("id", item.id);
    setSaving(false);
    onSaved();
  }

  return (
    <Modal title={`Menukaartgegevens — ${item.recipe?.name ?? ""}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Naam op kaart (optioneel)
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={item.recipe?.name}
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Verkoopprijs (leeg = centrale prijs)
            </label>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={item.recipe?.sales_price?.toString()}
              className="input"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Korte omschrijving</label>
          <input
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            className="input"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Vanaf datum</label>
            <input
              type="date"
              value={availableFrom}
              onChange={(e) => setAvailableFrom(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Tot datum</label>
            <input
              type="date"
              value={availableTo}
              onChange={(e) => setAvailableTo(e.target.value)}
              className="input"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Supplement (€)</label>
            <input
              type="number"
              step="0.01"
              value={supplementPrice}
              onChange={(e) => setSupplementPrice(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Aanbevolen drank</label>
            <input
              value={pairedDrink}
              onChange={(e) => setPairedDrink(e.target.value)}
              className="input"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={isNew} onChange={(e) => setIsNew(e.target.checked)} /> Nieuw
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={isPopular} onChange={(e) => setIsPopular(e.target.checked)} />{" "}
            Populair
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={isChefsSpecial}
              onChange={(e) => setIsChefsSpecial(e.target.checked)}
            />{" "}
            Chef&apos;s special
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={isVegetarian}
              onChange={(e) => setIsVegetarian(e.target.checked)}
            />{" "}
            Vegetarisch
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={isVegan} onChange={(e) => setIsVegan(e.target.checked)} /> Vegan
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={isGlutenFree}
              onChange={(e) => setIsGlutenFree(e.target.checked)}
            />{" "}
            Glutenvrij
          </label>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Opslaan…" : "Opslaan"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            <X className="h-4 w-4" />
            Sluiten
          </Button>
        </div>
      </div>
      <style jsx>{`
        .input {
          display: block;
          width: 100%;
          height: 2.25rem;
          border-radius: 0.375rem;
          border: 1px solid var(--border);
          background: var(--surface);
          padding: 0 0.6rem;
          font-size: 0.8125rem;
        }
      `}</style>
    </Modal>
  );
}

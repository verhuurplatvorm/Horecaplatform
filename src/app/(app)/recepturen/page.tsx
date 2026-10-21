"use client";

import Link from "next/link";
import { withReturnTo } from "@/lib/use-return-navigation";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Folders,
  GripVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { cn } from "@/lib/utils";
import type { Recipe, RecipeFolder } from "@/lib/types/database";

const RECIPE_DRAG = "text/recipe-id";
const FOLDER_DRAG = "text/recipe-folder-id";

type RecipeListItem = Pick<
  Recipe,
  | "id"
  | "name"
  | "category"
  | "status"
  | "is_central"
  | "company_id"
  | "sales_price"
  | "vat_rate"
  | "portion_size"
  | "portion_unit"
>;

interface RecipeWithCost extends RecipeListItem {
  costPrice: number | null;
}

export default function RecepturenPage() {
  const { activeCompanyIds, scope, companies, loading: scopeLoading } =
    useCompanyScope();
  const { can } = usePermissions();
  const canViewFinancial = can("recepturen").canViewFinancial;
  const [recipes, setRecipes] = useState<RecipeWithCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [activeFolder, setActiveFolder] = useState<string>("__alle__");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rematchBusy, setRematchBusy] = useState(false);
  const [rematchMessage, setRematchMessage] = useState<string | null>(null);
  const [folderRows, setFolderRows] = useState<RecipeFolder[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const registeredRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("recipe_folders")
      .select("id, group_id, name, parent_id, is_main, sort_order, created_at")
      .order("sort_order")
      .order("name")
      .then(({ data }) => {
        setFolderRows((data ?? []) as RecipeFolder[]);
        setFoldersLoaded(true);
      });
  }, []);

  // Categorieën die nog geen map zijn (bv. net via Excel geïmporteerd)
  // worden automatisch als losse map vastgelegd.
  useEffect(() => {
    if (!foldersLoaded || loading || registeredRef.current) return;
    registeredRef.current = true;
    const known = new Set(folderRows.map((f) => f.name.toLowerCase()));
    const missing = Array.from(
      new Set(recipes.map((r) => r.category?.trim()).filter((c): c is string => !!c))
    ).filter((c) => !known.has(c.toLowerCase()));
    if (missing.length === 0) return;
    (async () => {
      const supabase = createClient();
      const groupId = await getCurrentGroupId(supabase);
      if (!groupId) return;
      const { data } = await supabase
        .from("recipe_folders")
        .insert(missing.map((name, i) => ({ group_id: groupId, name, sort_order: folderRows.length + i })))
        .select("id, group_id, name, parent_id, is_main, sort_order, created_at");
      if (data) setFolderRows((prev) => [...prev, ...(data as RecipeFolder[])]);
    })();
  }, [foldersLoaded, loading, recipes, folderRows]);

  // Voor de kostprijsberekening is een concreet bedrijf nodig (recepten
  // kunnen groepsbreed of lokaal zijn, maar inkoopprijzen kunnen per
  // bedrijf verschillen). Bij een groepsbrede weergave gebruiken we het
  // eerst zichtbare bedrijf als referentie.
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const referenceCompanyName = companies.find(
    (c) => c.id === referenceCompanyId
  )?.name;

  useEffect(() => {
    if (scopeLoading) return;
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      // Alleen gerechten — halfproducten hebben een eigen module
      // (spec: "Halfproducten mogen geen onderdeel zijn van de gewone
      // receptenlijst").
      // Gepagineerd ophalen — Supabase geeft maximaal 1000 rijen per
      // query terug en een vaste limiet kapt de lijst stilzwijgend af.
      const PAGE_SIZE = 1000;
      const data: Recipe[] = [];
      let fetchError = null;
      let from = 0;
      while (true) {
        const { data: page, error: pageError } = await supabase
          .from("recipes")
          .select(
            "id, name, category, status, is_central, company_id, sales_price, vat_rate, portion_size, portion_unit"
          )
          .eq("recipe_kind", "gerecht")
          .order("name")
          .range(from, from + PAGE_SIZE - 1);
        if (pageError) {
          fetchError = pageError;
          break;
        }
        if (!page || page.length === 0) break;
        data.push(...(page as Recipe[]));
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      if (cancelled) return;
      if (fetchError || !data) {
        setError(true);
        setLoading(false);
        return;
      }

      if (!referenceCompanyId) {
        setRecipes(data.map((r) => ({ ...r, costPrice: null })));
        setLoading(false);
        return;
      }

      const withCost = await Promise.all(
        data.map(async (recipe) => {
          const { data: cost } = await supabase.rpc("calculate_recipe_cost", {
            p_recipe_id: recipe.id,
            p_company_id: referenceCompanyId,
          });
          return { ...recipe, costPrice: cost ?? null };
        })
      );

      if (!cancelled) {
        setRecipes(withCost);
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [referenceCompanyId, scopeLoading]);

  /**
   * Recept verwijderen — met vooraf-controle op de plekken die het
   * verwijderen blokkeren (database: on delete restrict), zodat de
   * gebruiker een leesbare uitleg krijgt in plaats van een technische
   * databasefout: menukaarten, gebruik als ingrediënt in een ander
   * recept, en gekoppelde verkoopproducten.
   */
  async function handleDeleteRecipe(recipe: RecipeWithCost) {
    const supabase = createClient();

    const [{ count: onMenus }, { count: usedAsIngredient }, { count: salesLinks }] =
      await Promise.all([
        supabase
          .from("menu_items")
          .select("id", { count: "exact", head: true })
          .eq("recipe_id", recipe.id),
        supabase
          .from("recipe_ingredients")
          .select("id", { count: "exact", head: true })
          .eq("sub_recipe_id", recipe.id),
        supabase
          .from("sales_product_components")
          .select("id", { count: "exact", head: true })
          .eq("recipe_id", recipe.id),
      ]);

    const blockers: string[] = [];
    if (onMenus) blockers.push(`staat op ${onMenus} menukaartregel(s)`);
    if (usedAsIngredient)
      blockers.push(`wordt als ingrediënt gebruikt in ${usedAsIngredient} ander(e) recept(en)`);
    if (salesLinks) blockers.push(`heeft ${salesLinks} gekoppeld(e) verkoopproduct(en)`);

    if (blockers.length > 0) {
      window.alert(
        `"${recipe.name}" kan niet verwijderd worden: het recept ${blockers.join(", ")}. ` +
          `Haal het daar eerst weg en probeer het opnieuw.`
      );
      return;
    }

    const ok = window.confirm(
      `"${recipe.name}" definitief verwijderen?\n\n` +
        `De ingrediëntregels en eventuele productiehistorie van dit recept ` +
        `worden ook verwijderd. Dit kan niet ongedaan gemaakt worden.`
    );
    if (!ok) return;

    const { error: deleteError } = await supabase
      .from("recipes")
      .delete()
      .eq("id", recipe.id);
    if (deleteError) {
      window.alert("Verwijderen mislukt: " + deleteError.message);
      return;
    }
    setRecipes((prev) => prev.filter((r) => r.id !== recipe.id));
  }

  /**
   * Meerdere recepten tegelijk verwijderen. Dezelfde controle als bij één
   * recept: wat nog ergens gebruikt wordt, wordt overgeslagen in plaats
   * van meegesleept. Je krijgt vooraf te zien wat er wél en niet weg kan.
   */
  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    setBulkBusy(true);
    const supabase = createClient();

    // Gebruik in één keer opvragen voor alle geselecteerde recepten.
    const [{ data: onMenus }, { data: asIngredient }, { data: salesLinks }] =
      await Promise.all([
        supabase.from("menu_items").select("recipe_id").in("recipe_id", ids),
        supabase.from("recipe_ingredients").select("sub_recipe_id").in("sub_recipe_id", ids),
        supabase.from("sales_product_components").select("recipe_id").in("recipe_id", ids),
      ]);

    const blocked = new Map<string, string[]>();
    const note = (id: string, reason: string) => {
      if (!blocked.has(id)) blocked.set(id, []);
      const list = blocked.get(id)!;
      if (!list.includes(reason)) list.push(reason);
    };
    for (const r of onMenus ?? []) if (r.recipe_id) note(r.recipe_id, "staat op een menukaart");
    for (const r of asIngredient ?? [])
      if (r.sub_recipe_id) note(r.sub_recipe_id, "wordt in een ander recept gebruikt");
    for (const r of salesLinks ?? [])
      if (r.recipe_id) note(r.recipe_id, "heeft een verkoopproduct");

    const deletable = ids.filter((id) => !blocked.has(id));
    const nameById = new Map(recipes.map((r) => [r.id, r.name]));

    if (deletable.length === 0) {
      setBulkBusy(false);
      window.alert(
        "Geen van de geselecteerde recepten kan verwijderd worden — ze worden allemaal " +
          "nog ergens gebruikt. Haal ze daar eerst weg."
      );
      return;
    }

    let message = `${deletable.length} recept(en) definitief verwijderen?\n\n`;
    message +=
      "De ingrediëntregels en eventuele productiehistorie worden ook verwijderd. " +
      "Dit kan niet ongedaan gemaakt worden.";
    if (blocked.size > 0) {
      const preview = [...blocked.entries()]
        .slice(0, 8)
        .map(([id, reasons]) => `• ${nameById.get(id) ?? id} — ${reasons.join(", ")}`)
        .join("\n");
      message +=
        `\n\n${blocked.size} recept(en) worden OVERGESLAGEN omdat ze nog in gebruik zijn:\n` +
        preview +
        (blocked.size > 8 ? `\n… en nog ${blocked.size - 8} andere` : "");
    }

    if (!window.confirm(message)) {
      setBulkBusy(false);
      return;
    }

    const { error: deleteError } = await supabase
      .from("recipes")
      .delete()
      .in("id", deletable);
    setBulkBusy(false);
    if (deleteError) {
      window.alert("Verwijderen mislukt: " + deleteError.message);
      return;
    }
    setRecipes((prev) => prev.filter((r) => !deletable.includes(r.id)));
    setSelectedIds(new Set());
    if (blocked.size > 0) {
      window.alert(
        `${deletable.length} verwijderd. ${blocked.size} overgeslagen omdat ze nog in gebruik zijn.`
      );
    }
  }

  const mainFolders = folderRows.filter((f) => f.is_main);
  const mapFolders = folderRows.filter((f) => !f.is_main);
  const childrenOf = (mainId: string) => mapFolders.filter((f) => f.parent_id === mainId);
  const looseFolders = mapFolders.filter(
    (f) => !f.parent_id || !mainFolders.some((m) => m.id === f.parent_id)
  );

  async function handleAddFolder(isMain: boolean) {
    const name = window.prompt(
      isMain
        ? "Naam van de nieuwe hoofdmap (bv. Zomers, Kerst, 2 voor 1, Het Strand):"
        : "Naam van de nieuwe map:"
    )?.trim();
    if (!name) return;
    if (folderRows.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      window.alert("Er bestaat al een map met die naam.");
      return;
    }
    const active = folderRows.find((f) => f.id === activeFolder);
    const parentId = isMain ? null : active ? (active.is_main ? active.id : active.parent_id) : null;
    const supabase = createClient();
    const groupId = await getCurrentGroupId(supabase);
    if (!groupId) return;
    const { data, error: insertError } = await supabase
      .from("recipe_folders")
      .insert({ group_id: groupId, name, is_main: isMain, parent_id: parentId, sort_order: folderRows.length })
      .select("id, group_id, name, parent_id, is_main, sort_order, created_at")
      .single();
    if (insertError || !data) {
      window.alert("Map aanmaken mislukt: " + (insertError?.message ?? "onbekende fout"));
      return;
    }
    setFolderRows((prev) => [...prev, data as RecipeFolder]);
    setActiveFolder(data.id);
    if (parentId)
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
  }

  async function handleRenameFolder(folder: RecipeFolder) {
    const name = window.prompt("Nieuwe naam:", folder.name)?.trim();
    if (!name || name === folder.name) return;
    if (folderRows.some((f) => f.id !== folder.id && f.name.toLowerCase() === name.toLowerCase())) {
      window.alert("Er bestaat al een map met die naam.");
      return;
    }
    const supabase = createClient();
    const { error: renameError } = await supabase
      .from("recipe_folders")
      .update({ name })
      .eq("id", folder.id);
    if (renameError) {
      window.alert("Hernoemen mislukt: " + renameError.message);
      return;
    }
    if (!folder.is_main) {
      const { error: catError } = await supabase
        .from("recipes")
        .update({ category: name })
        .eq("category", folder.name)
        .eq("recipe_kind", "gerecht");
      if (catError) {
        window.alert("Gerechten bijwerken mislukt: " + catError.message);
        return;
      }
      setRecipes((prev) =>
        prev.map((r) => (r.category?.trim() === folder.name ? { ...r, category: name } : r))
      );
    }
    setFolderRows((prev) => prev.map((f) => (f.id === folder.id ? { ...f, name } : f)));
  }

  /**
   * Map verwijderen — de gerechten zelf blijven bestaan en verhuizen naar
   * "Zonder map". Een hoofdmap verwijderen laat de mappen eronder los
   * achter; er verdwijnen nooit gerechten.
   */
  async function handleDeleteFolder(folder: RecipeFolder) {
    const supabase = createClient();
    if (folder.is_main) {
      const n = childrenOf(folder.id).length;
      if (!window.confirm(`Hoofdmap "${folder.name}" verwijderen?\n\nDe ${n} map(pen) erin blijven bestaan als losse map.`))
        return;
      const { error: delError } = await supabase.from("recipe_folders").delete().eq("id", folder.id);
      if (delError) {
        window.alert("Verwijderen mislukt: " + delError.message);
        return;
      }
      setFolderRows((prev) =>
        prev.filter((f) => f.id !== folder.id).map((f) => (f.parent_id === folder.id ? { ...f, parent_id: null } : f))
      );
    } else {
      const count = recipes.filter((r) => r.category?.trim() === folder.name).length;
      if (!window.confirm(`Map "${folder.name}" verwijderen?\n\nDe ${count} recept(en) in deze map worden NIET verwijderd — ze verhuizen naar "Zonder map".`))
        return;
      const { error: updateError } = await supabase
        .from("recipes")
        .update({ category: null })
        .eq("category", folder.name)
        .eq("recipe_kind", "gerecht");
      if (updateError) {
        window.alert("Map verwijderen mislukt: " + updateError.message);
        return;
      }
      await supabase.from("recipe_folders").delete().eq("id", folder.id);
      setRecipes((prev) =>
        prev.map((r) => (r.category?.trim() === folder.name ? { ...r, category: null } : r))
      );
      setFolderRows((prev) => prev.filter((f) => f.id !== folder.id));
    }
    setActiveFolder("__alle__");
  }

  async function moveFolderToMain(folderId: string, mainId: string | null) {
    const folder = folderRows.find((f) => f.id === folderId);
    if (!folder || folder.is_main || folder.parent_id === mainId) return;
    const supabase = createClient();
    const { error: moveError } = await supabase
      .from("recipe_folders")
      .update({ parent_id: mainId })
      .eq("id", folderId);
    if (moveError) {
      window.alert("Verplaatsen mislukt: " + moveError.message);
      return;
    }
    setFolderRows((prev) => prev.map((f) => (f.id === folderId ? { ...f, parent_id: mainId } : f)));
    if (mainId)
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(mainId);
        return next;
      });
  }

  async function moveRecipeToCategory(recipeId: string, category: string | null) {
    const row = recipes.find((r) => r.id === recipeId);
    if (!row || (row.category?.trim() || null) === category) return;
    const supabase = createClient();
    const { error: moveError } = await supabase
      .from("recipes")
      .update({ category })
      .eq("id", recipeId);
    if (moveError) {
      window.alert("Verplaatsen mislukt: " + moveError.message);
      return;
    }
    setRecipes((prev) => prev.map((r) => (r.id === recipeId ? { ...r, category } : r)));
  }

  // Bulkacties: meerdere recepten tegelijk naar een map verplaatsen of
  // archiveren, in plaats van rij voor rij.
  async function bulkMoveToFolder(targetCategory: string | null) {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    const supabase = createClient();
    const ids = [...selectedIds];
    const { error: moveError } = await supabase
      .from("recipes")
      .update({ category: targetCategory })
      .in("id", ids);
    setBulkBusy(false);
    if (moveError) {
      window.alert("Verplaatsen mislukt: " + moveError.message);
      return;
    }
    setRecipes((prev) =>
      prev.map((r) => (ids.includes(r.id) ? { ...r, category: targetCategory } : r))
    );
    setSelectedIds(new Set());
  }

  async function bulkArchive() {
    if (selectedIds.size === 0) return;
    const ok = window.confirm(
      `${selectedIds.size} recept(en) archiveren? Ze blijven bewaard, maar krijgen status "vervallen".`
    );
    if (!ok) return;
    setBulkBusy(true);
    const supabase = createClient();
    const ids = [...selectedIds];
    const { error: archiveError } = await supabase
      .from("recipes")
      .update({ status: "vervallen" as const })
      .in("id", ids);
    setBulkBusy(false);
    if (archiveError) {
      window.alert("Archiveren mislukt: " + archiveError.message);
      return;
    }
    setRecipes((prev) =>
      prev.map((r) => (ids.includes(r.id) ? { ...r, status: "vervallen" } : r))
    );
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const q = query.trim().toLowerCase();
  const searchedRecipes = q
    ? recipes.filter((r) =>
        [r.name, r.category, r.status]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(q))
      )
    : recipes;

  // Mappen: elk gerecht staat in één map (category). Mappen kunnen onder
  // een hoofdmap hangen; "Zonder map" zijn gerechten zonder categorie.
  const folders = Array.from(new Set(mapFolders.map((f) => f.name))).sort((a, b) =>
    a.localeCompare(b, "nl")
  );
  const countIn = (names: string[]) =>
    searchedRecipes.filter((r) => names.includes(r.category?.trim() ?? "")).length;
  const unfiledCount = searchedRecipes.filter((r) => !r.category?.trim()).length;
  const activeF = folderRows.find((f) => f.id === activeFolder);
  const filteredRecipes =
    activeFolder === "__alle__"
      ? searchedRecipes
      : activeFolder === "__zonder__"
        ? searchedRecipes.filter((r) => !r.category?.trim())
        : activeF?.is_main
          ? searchedRecipes.filter((r) =>
              childrenOf(activeF.id).some((c) => c.name === r.category?.trim())
            )
          : searchedRecipes.filter((r) => r.category?.trim() === activeF?.name);

  return (
    <>
      <Topbar title="Recepten (Gerechten)" />
      <main className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[260px_1fr] md:p-6">
        <div>
          <Card>
            <CardContent className="p-2">
              <div className="mb-2 flex items-center justify-between px-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Mappen</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleAddFolder(true)} title="Nieuwe hoofdmap">
                    <Folders className="h-4 w-4 text-muted hover:text-teal" />
                  </button>
                  <button onClick={() => handleAddFolder(false)} title="Nieuwe map">
                    <FolderPlus className="h-4 w-4 text-muted hover:text-teal" />
                  </button>
                </div>
              </div>
              <TreeRow
                label={`Alle mappen (${searchedRecipes.length})`}
                selected={activeFolder === "__alle__"}
                onSelect={() => setActiveFolder("__alle__")}
              />
              {mainFolders.map((main) => {
                const kids = childrenOf(main.id);
                const isOpen = !collapsed.has(main.id);
                return (
                  <div key={main.id}>
                    <TreeRow
                      label={main.name}
                      count={countIn(kids.map((k) => k.name))}
                      bold
                      selected={activeFolder === main.id}
                      onSelect={() => setActiveFolder(main.id)}
                      toggle={{
                        open: isOpen,
                        onToggle: () =>
                          setCollapsed((prev) => {
                            const next = new Set(prev);
                            if (next.has(main.id)) next.delete(main.id);
                            else next.add(main.id);
                            return next;
                          }),
                      }}
                      onRename={() => handleRenameFolder(main)}
                      onDelete={() => handleDeleteFolder(main)}
                      onDropFolder={(fid) => moveFolderToMain(fid, main.id)}
                    />
                    {isOpen &&
                      kids.map((k) => (
                        <TreeRow
                          key={k.id}
                          label={k.name}
                          count={countIn([k.name])}
                          indent
                          selected={activeFolder === k.id}
                          onSelect={() => setActiveFolder(k.id)}
                          onRename={() => handleRenameFolder(k)}
                          onDelete={() => handleDeleteFolder(k)}
                          dragFolderId={k.id}
                          onDropRecipe={(rid) => moveRecipeToCategory(rid, k.name)}
                        />
                      ))}
                    {isOpen && kids.length === 0 && (
                      <p className="py-1 pl-8 text-xs text-muted">Sleep hier mappen naartoe</p>
                    )}
                  </div>
                );
              })}
              <p
                className="mt-2 px-2 pt-2 text-xs font-medium uppercase tracking-wide text-muted"
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(FOLDER_DRAG)) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const fid = e.dataTransfer.getData(FOLDER_DRAG);
                  if (fid) moveFolderToMain(fid, null);
                }}
                title="Sleep een map hierheen om uit een hoofdmap te halen"
              >
                {mainFolders.length > 0 ? "Losse mappen" : "Mappen"}
              </p>
              {looseFolders.map((f) => (
                <TreeRow
                  key={f.id}
                  label={f.name}
                  count={countIn([f.name])}
                  selected={activeFolder === f.id}
                  onSelect={() => setActiveFolder(f.id)}
                  onRename={() => handleRenameFolder(f)}
                  onDelete={() => handleDeleteFolder(f)}
                  dragFolderId={f.id}
                  onDropRecipe={(rid) => moveRecipeToCategory(rid, f.name)}
                />
              ))}
              {unfiledCount > 0 && (
                <TreeRow
                  label={`Zonder map (${unfiledCount})`}
                  selected={activeFolder === "__zonder__"}
                  onSelect={() => setActiveFolder("__zonder__")}
                  onDropRecipe={(rid) => moveRecipeToCategory(rid, null)}
                />
              )}
              <p className="px-2 pt-3 text-xs text-muted">
                Sleep een map op een hoofdmap om hem erin te zetten. Sleep een gerecht (greep links in de rij) op een map om te verplaatsen.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek op naam, categorie of status…"
              className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
            />
          </div>
          <Button
            variant="secondary"
            disabled={rematchBusy}
            onClick={async () => {
              setRematchBusy(true);
              setRematchMessage(null);
              try {
                const res = await fetch("/api/recipe-import/rematch-all", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ recipeKind: "gerecht" }),
                });
                const body = await res.json();
                if (!res.ok) throw new Error(body.error ?? "Mislukt.");
                setRematchMessage(
                  `${body.linked} ingrediënt(en) gekoppeld in ${body.recipesUpdated} gerecht(en); ${body.stillOpen} nog zonder zekere match.`
                );
              } catch (err) {
                setRematchMessage(err instanceof Error ? err.message : "Opnieuw zoeken mislukt.");
              } finally {
                setRematchBusy(false);
              }
            }}
          >
            {rematchBusy ? "Bezig…" : "Opnieuw zoeken in ingrediënten"}
          </Button>
          {rematchMessage && <span className="text-xs text-muted">{rematchMessage}</span>}
          <Link href="/recepten/importeren">
            <Button variant="secondary">
              <Upload className="h-4 w-4" />
              Importeren (Excel)
            </Button>
          </Link>
          <Link href="/recepturen/nieuw">
            <Button>
              <Plus className="h-4 w-4" />
              Nieuw gerecht
            </Button>
          </Link>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-teal bg-teal/5 px-3 py-2 text-sm">
            <span className="font-medium text-foreground">
              {selectedIds.size} geselecteerd
            </span>
            <select
              disabled={bulkBusy}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value)
                  bulkMoveToFolder(e.target.value === "__zonder__" ? null : e.target.value);
                e.target.value = "";
              }}
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
            >
              <option value="" disabled>
                Verplaats naar map…
              </option>
              <option value="__zonder__">Zonder map</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <button
              disabled={bulkBusy}
              onClick={bulkArchive}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-background"
            >
              Archiveren
            </button>
            <button
              disabled={bulkBusy}
              onClick={bulkDelete}
              title="Definitief verwijderen — recepten die nog ergens gebruikt worden, worden overgeslagen"
              className="flex items-center gap-1 rounded-md border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10"
            >
              <Trash2 className="h-3 w-3" />
              Verwijderen
            </button>
            <button
              disabled={bulkBusy}
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-xs text-muted hover:text-foreground"
            >
              Selectie opheffen
            </button>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
<table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="w-8 px-5 py-3">
                    <input
                      type="checkbox"
                      checked={
                        filteredRecipes.length > 0 &&
                        filteredRecipes.every((r) => selectedIds.has(r.id))
                      }
                      onChange={(e) =>
                        setSelectedIds(
                          e.target.checked
                            ? new Set(filteredRecipes.map((r) => r.id))
                            : new Set()
                        )
                      }
                    />
                  </th>
                  <th className="w-6 px-1 py-3"></th>
                  <th className="px-5 py-3 font-medium">Naam</th>
                  <th className="px-5 py-3 font-medium">Categorie</th>
                  <th className="px-5 py-3 font-medium">Bereik</th>
                  {canViewFinancial && (
                    <th className="px-5 py-3 font-medium">Kostprijs</th>
                  )}
                  <th className="px-5 py-3 font-medium">Verkoopprijs</th>
                  {canViewFinancial && (
                    <th className="px-5 py-3 font-medium">Foodcost %</th>
                  )}
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filteredRecipes.map((r) => {
                  const priceExclVat =
                    r.sales_price && r.vat_rate !== null
                      ? r.sales_price / (1 + r.vat_rate / 100)
                      : r.sales_price;
                  const foodCostPct =
                    r.costPrice !== null && priceExclVat
                      ? (r.costPrice / priceExclVat) * 100
                      : null;
                  return (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-5 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                        />
                      </td>
                      <td className="px-1 py-3">
                        <span
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(RECIPE_DRAG, r.id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          title="Sleep naar een map links om te verplaatsen"
                          className="flex cursor-grab items-center justify-center text-muted hover:text-teal active:cursor-grabbing"
                        >
                          <GripVertical className="h-4 w-4" />
                        </span>
                      </td>
                      <td className="px-5 py-3 font-medium">
                        <Link
                          href={withReturnTo(`/recepturen/${r.id}/bewerken`)}
                          className="hover:text-teal hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-muted">{r.category ?? "—"}</td>
                      <td className="px-5 py-3 text-muted">
                        {r.is_central ? "Centrale standaard" : "Lokale variant"}
                      </td>
                      {canViewFinancial && (
                        <td className="px-5 py-3 tabular">
                          {loading
                            ? "…"
                            : r.costPrice !== null
                            ? `€ ${r.costPrice.toFixed(2)}`
                            : "—"}
                        </td>
                      )}
                      <td className="px-5 py-3 tabular">
                        {r.sales_price ? `€ ${r.sales_price.toFixed(2)}` : "—"}
                      </td>
                      {canViewFinancial && (
                        <td className="px-5 py-3 tabular">
                          {foodCostPct !== null ? (
                            <span
                              className={
                                foodCostPct > 33 ? "text-danger" : "text-success"
                              }
                            >
                              {foodCostPct.toFixed(1)}%
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      <td className="px-5 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => handleDeleteRecipe(r)}
                          title="Recept verwijderen"
                          className="text-muted hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredRecipes.length === 0 && !loading && (
                  <tr>
                    <td colSpan={canViewFinancial ? 10 : 8} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan gerechten niet laden — controleer de Supabase-koppeling."
                        : q
                        ? "Geen gerechten gevonden voor deze zoekopdracht."
                        : "Nog geen gerechten vastgelegd."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
</div>
          </CardContent>
        </Card>
        <p className="mt-3 text-xs text-muted">
          {referenceCompanyId
            ? `Kostprijzen zijn live berekend voor ${
                scope.mode === "group"
                  ? `${referenceCompanyName} (eerste bedrijf in groepsweergave)`
                  : referenceCompanyName
              }, op basis van de actuele inkoopprijzen. Halfproducten beheer je nu apart onder "Halfproducten".`
            : "Selecteer een bedrijf via de bedrijfsselector rechtsboven om actuele kostprijzen te zien."}
        </p>
        </div>
      </main>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    goedgekeurd: "bg-success/10 text-success",
    concept: "bg-copper/10 text-copper",
    vervallen: "bg-muted/10 text-muted",
  };
  const labels: Record<string, string> = {
    goedgekeurd: "actief",
    concept: "concept",
    vervallen: "gearchiveerd",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${styles[status] ?? styles.concept}`}>
      {labels[status] ?? status}
    </span>
  );
}

/** Rij in de mappenboom: selecteerbaar, hernoembaar, sleepbaar (map) en drop-doel (gerecht of map). */
function TreeRow({
  label,
  count,
  selected,
  indent,
  bold,
  toggle,
  dragFolderId,
  onSelect,
  onRename,
  onDelete,
  onDropRecipe,
  onDropFolder,
}: {
  label: string;
  count?: number;
  selected: boolean;
  indent?: boolean;
  bold?: boolean;
  toggle?: { open: boolean; onToggle: () => void };
  dragFolderId?: string;
  onSelect: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onDropRecipe?: (recipeId: string) => void;
  onDropFolder?: (folderId: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const accepts = (types: readonly string[]) =>
    (!!onDropRecipe && types.includes(RECIPE_DRAG)) ||
    (!!onDropFolder && types.includes(FOLDER_DRAG));
  return (
    <div
      draggable={!!dragFolderId}
      onDragStart={(e) => {
        if (!dragFolderId) return;
        e.dataTransfer.setData(FOLDER_DRAG, dragFolderId);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "group flex items-center gap-1 rounded-md px-2 py-2 text-sm hover:bg-background",
        indent && "ml-5",
        bold && "font-medium",
        selected && "bg-teal/10 text-teal",
        dragOver && "bg-teal/25 outline outline-2 outline-teal"
      )}
      onDragOver={(e) => {
        if (accepts(e.dataTransfer.types)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDragEnter={(e) => {
        if (accepts(e.dataTransfer.types)) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const rid = e.dataTransfer.getData(RECIPE_DRAG);
        const fid = e.dataTransfer.getData(FOLDER_DRAG);
        if (rid && onDropRecipe) onDropRecipe(rid);
        else if (fid && onDropFolder) onDropFolder(fid);
      }}
    >
      {toggle && (
        <button onClick={toggle.onToggle} title={toggle.open ? "Inklappen" : "Uitklappen"}>
          {toggle.open ? (
            <ChevronDown className="h-4 w-4 text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted" />
          )}
        </button>
      )}
      <button onClick={onSelect} className="flex-1 truncate text-left">
        {label}
        {count !== undefined && <span className="ml-1 text-xs text-muted">({count})</span>}
      </button>
      {(onRename || onDelete) && (
        <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
          {onRename && (
            <button onClick={onRename} title="Hernoemen">
              <Pencil className="h-3 w-3 text-muted hover:text-teal" />
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} title="Verwijderen">
              <Trash2 className="h-3 w-3 text-muted hover:text-danger" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  Star,
  Archive,
  Copy,
  Download,
  Trash2,
  Upload,
  FolderPlus,
  Pencil,
  GripVertical,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { cn } from "@/lib/utils";

interface HalfproductFolder {
  id: string;
  name: string;
  sort_order: number;
}

interface HalfproductRow {
  id: string;
  name: string;
  category: string | null;
  halfproduct_folder_id: string | null;
  yield_quantity: number | null;
  base_unit_id: string | null;
  status: string;
  updated_at: string;
  unitName: string | null;
  costPrice: number | null;
  costPerBaseUnit: number | null;
  usageCount: number;
  isFavorite: boolean;
}

type SortKey = "name" | "updated_at" | "costPerBaseUnit" | "usageCount";

const DRAG_TYPE = "text/halfproduct-id";

export default function HalfproductenPage() {
  const { activeCompanyIds, loading: scopeLoading } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;

  const [rows, setRows] = useState<HalfproductRow[]>([]);
  const [folders, setFolders] = useState<HalfproductFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeFolder, setActiveFolder] = useState<string>("__alle__");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (scopeLoading) return;
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const groupId = await getCurrentGroupId(supabase);

      const [{ data: recipes }, { data: units }, { data: favorites }, { data: folderRows }] =
        await Promise.all([
          supabase
            .from("recipes")
            .select(
              "id, name, category, halfproduct_folder_id, yield_quantity, base_unit_id, status, updated_at"
            )
            .eq("recipe_kind", "halfproduct")
            .order("name"),
          supabase.from("units").select("id, name"),
          groupId
            ? supabase.from("recipe_favorites").select("recipe_id")
            : Promise.resolve({ data: [] }),
          groupId
            ? supabase
                .from("halfproduct_folders")
                .select("id, name, sort_order")
                .eq("group_id", groupId)
                .order("sort_order")
            : Promise.resolve({ data: [] }),
        ]);
      if (cancelled || !recipes) {
        setLoading(false);
        return;
      }

      const unitNameById = new Map((units ?? []).map((u) => [u.id, u.name]));
      const favoriteIds = new Set((favorites ?? []).map((f) => f.recipe_id));

      const withCost = await Promise.all(
        recipes.map(async (r) => {
          let costPrice: number | null = null;
          if (referenceCompanyId) {
            const { data: cost } = await supabase.rpc("calculate_recipe_cost", {
              p_recipe_id: r.id,
              p_company_id: referenceCompanyId,
            });
            costPrice = cost ?? null;
          }
          const { count } = await supabase
            .from("recipe_ingredients")
            .select("id", { count: "exact", head: true })
            .eq("sub_recipe_id", r.id);

          return {
            id: r.id,
            name: r.name,
            category: r.category,
            halfproduct_folder_id: r.halfproduct_folder_id,
            yield_quantity: r.yield_quantity,
            base_unit_id: r.base_unit_id,
            status: r.status,
            updated_at: r.updated_at,
            unitName: r.base_unit_id ? unitNameById.get(r.base_unit_id) ?? null : null,
            costPrice,
            costPerBaseUnit:
              costPrice !== null && r.yield_quantity ? costPrice / r.yield_quantity : null,
            usageCount: count ?? 0,
            isFavorite: favoriteIds.has(r.id),
          };
        })
      );

      if (!cancelled) {
        setRows(withCost);
        setFolders(folderRows ?? []);
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [referenceCompanyId, scopeLoading]);

  async function toggleFavorite(recipeId: string, current: boolean) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    if (current) {
      await supabase
        .from("recipe_favorites")
        .delete()
        .eq("user_id", user.id)
        .eq("recipe_id", recipeId);
    } else {
      await supabase.from("recipe_favorites").insert({ user_id: user.id, recipe_id: recipeId });
    }
    setRows((prev) =>
      prev.map((r) => (r.id === recipeId ? { ...r, isFavorite: !current } : r))
    );
  }

  async function archive(recipeId: string) {
    const supabase = createClient();
    await supabase.from("recipes").update({ status: "vervallen" as const }).eq("id", recipeId);
    setRows((prev) =>
      prev.map((r) => (r.id === recipeId ? { ...r, status: "vervallen" } : r))
    );
  }

  async function duplicate(recipeId: string) {
    const supabase = createClient();
    const groupId = await getCurrentGroupId(supabase);
    if (!groupId) return;

    const { data: original } = await supabase
      .from("recipes")
      .select("*")
      .eq("id", recipeId)
      .single();
    if (!original) return;

    const { data: ingredients } = await supabase
      .from("recipe_ingredients")
      .select("*")
      .eq("recipe_id", recipeId);

    const {
      id: _id,
      created_at: _createdAt,
      updated_at: _updatedAt,
      version: _version,
      ...rest
    } = original;
    void _id;
    void _createdAt;
    void _updatedAt;
    void _version;

    const { data: created } = await supabase
      .from("recipes")
      .insert({ ...rest, name: `${original.name} (kopie)`, status: "concept" })
      .select("id")
      .single();
    if (!created) return;

    if (ingredients && ingredients.length > 0) {
      await supabase.from("recipe_ingredients").insert(
        ingredients.map((ri) => {
          const { id: _riId, ...riRest } = ri;
          void _riId;
          return { ...riRest, recipe_id: created.id };
        })
      );
    }

    window.location.href = `/halfproducten/${created.id}/bewerken`;
  }

  function exportCsv() {
    const header = [
      "Naam",
      "Map",
      "Opbrengst",
      "Eenheid",
      "Kostprijs per basiseenheid",
      "Totale productiekostprijs",
      "Status",
      "Laatst gewijzigd",
      "Aantal gekoppelde gerechten",
    ];
    const folderName = (id: string | null) =>
      folders.find((f) => f.id === id)?.name ?? "";
    const lines = filteredRows.map((r) => [
      r.name,
      folderName(r.halfproduct_folder_id),
      r.yield_quantity ?? "",
      r.unitName ?? "",
      r.costPerBaseUnit?.toFixed(4) ?? "",
      r.costPrice?.toFixed(2) ?? "",
      r.status,
      new Date(r.updated_at).toLocaleDateString("nl-NL"),
      r.usageCount,
    ]);
    const csv = [header, ...lines]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "halfproducten.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Map toevoegen, hernoemen, verwijderen — zelfde bediening als bij
  // Menukaarten. "Map verwijderen" verplaatst de halfproducten naar
  // "Zonder map"; verwijdert nooit de halfproducten zelf.
  async function handleAddFolder() {
    const name = window.prompt("Naam van de nieuwe map:");
    if (!name?.trim()) return;
    const supabase = createClient();
    const groupId = await getCurrentGroupId(supabase);
    if (!groupId) return;
    const { data, error } = await supabase
      .from("halfproduct_folders")
      .insert({ group_id: groupId, name: name.trim(), sort_order: folders.length })
      .select("id, name, sort_order")
      .single();
    if (error || !data) {
      window.alert("Map aanmaken mislukt: " + (error?.message ?? "onbekende fout"));
      return;
    }
    setFolders((prev) => [...prev, data]);
    setActiveFolder(data.id);
  }

  async function handleRenameFolder(folder: HalfproductFolder) {
    const name = window.prompt("Nieuwe naam:", folder.name);
    if (!name?.trim() || name === folder.name) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("halfproduct_folders")
      .update({ name: name.trim() })
      .eq("id", folder.id);
    if (error) {
      window.alert("Hernoemen mislukt: " + error.message);
      return;
    }
    setFolders((prev) =>
      prev.map((f) => (f.id === folder.id ? { ...f, name: name.trim() } : f))
    );
  }

  async function handleDeleteFolder(folder: HalfproductFolder) {
    const count = rows.filter((r) => r.halfproduct_folder_id === folder.id).length;
    const ok = window.confirm(
      `Map "${folder.name}" verwijderen?\n\n` +
        (count > 0
          ? `De ${count} halfproduct(en) in deze map worden NIET verwijderd — ze verhuizen naar "Zonder map".`
          : "Deze map is leeg.")
    );
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase.from("halfproduct_folders").delete().eq("id", folder.id);
    if (error) {
      window.alert("Map verwijderen mislukt: " + error.message);
      return;
    }
    setFolders((prev) => prev.filter((f) => f.id !== folder.id));
    setRows((prev) =>
      prev.map((r) =>
        r.halfproduct_folder_id === folder.id ? { ...r, halfproduct_folder_id: null } : r
      )
    );
    if (activeFolder === folder.id) setActiveFolder("__alle__");
  }

  // Drag-and-drop: een halfproduct naar een (andere) map slepen. Alleen
  // halfproduct_folder_id verandert — kostprijs, koppelingen en overige
  // gegevens blijven exact zoals ze waren.
  async function moveToFolder(recipeId: string, targetFolderId: string | null) {
    const row = rows.find((r) => r.id === recipeId);
    if (!row || row.halfproduct_folder_id === targetFolderId) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("recipes")
      .update({ halfproduct_folder_id: targetFolderId })
      .eq("id", recipeId);
    if (error) {
      window.alert("Verplaatsen mislukt: " + error.message);
      return;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === recipeId ? { ...r, halfproduct_folder_id: targetFolderId } : r
      )
    );
  }

  const filteredRows = (() => {
    const visible = rows.filter((r) =>
      showArchived ? true : r.status !== "vervallen"
    );
    const q = query.trim().toLowerCase();
    const folderName = (id: string | null) =>
      folders.find((f) => f.id === id)?.name ?? "";
    const searched = q
      ? visible.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            folderName(r.halfproduct_folder_id).toLowerCase().includes(q)
        )
      : visible;
    const matched =
      activeFolder === "__alle__"
        ? searched
        : activeFolder === "__zonder__"
          ? searched.filter((r) => !r.halfproduct_folder_id)
          : searched.filter((r) => r.halfproduct_folder_id === activeFolder);

    return [...matched].sort((a, b) => {
      const favCmp = Number(b.isFavorite) - Number(a.isFavorite);
      if (favCmp !== 0) return favCmp;

      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "updated_at")
        cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      else if (sortKey === "costPerBaseUnit")
        cmp = (a.costPerBaseUnit ?? 0) - (b.costPerBaseUnit ?? 0);
      else if (sortKey === "usageCount") cmp = a.usageCount - b.usageCount;
      return cmp * sortDir;
    });
  })();

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  const unfiledCount = rows.filter((r) => !r.halfproduct_folder_id).length;

  return (
    <>
      <Topbar title="Halfproducten" />
      <main className="grid grid-cols-[240px_1fr] gap-4 p-6">
        <div className="space-y-3">
          <Card>
            <CardContent className="p-2">
              <div className="mb-2 flex items-center justify-between px-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Mappen</p>
                <button onClick={handleAddFolder} title="Nieuwe map">
                  <FolderPlus className="h-4 w-4 text-muted hover:text-teal" />
                </button>
              </div>
              <FolderNavItem
                label={`Alle mappen (${rows.length})`}
                selected={activeFolder === "__alle__"}
                onSelect={() => setActiveFolder("__alle__")}
              />
              {folders.map((folder) => (
                <FolderRow
                  key={folder.id}
                  folder={folder}
                  count={rows.filter((r) => r.halfproduct_folder_id === folder.id).length}
                  selected={activeFolder === folder.id}
                  onSelect={() => setActiveFolder(folder.id)}
                  onRename={() => handleRenameFolder(folder)}
                  onDelete={() => handleDeleteFolder(folder)}
                  onDropItem={(recipeId) => moveToFolder(recipeId, folder.id)}
                />
              ))}
              {unfiledCount > 0 && (
                <FolderNavItem
                  label={`Zonder map (${unfiledCount})`}
                  selected={activeFolder === "__zonder__"}
                  onSelect={() => setActiveFolder("__zonder__")}
                  onDropItem={(recipeId) => moveToFolder(recipeId, null)}
                />
              )}
              {folders.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted">
                  Nog geen mappen — maak er een aan met het map-icoon hierboven.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Zoek op naam of map…"
                className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
              />
            </div>
            <label className="flex items-center gap-1.5 text-sm text-muted">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Toon gearchiveerd
            </label>
            <Button variant="secondary" onClick={exportCsv}>
              <Download className="h-4 w-4" />
              Exporteren
            </Button>
            <Link href="/halfproducten/importeren">
              <Button variant="secondary">
                <Upload className="h-4 w-4" />
                Importeren (Excel)
              </Button>
            </Link>
            <Link href="/halfproducten/nieuw">
              <Button>
                <Plus className="h-4 w-4" />
                Nieuw halfproduct
              </Button>
            </Link>
          </div>

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="w-8 px-3 py-3"></th>
                    <th className="w-6 px-1 py-3"></th>
                    <th
                      className="cursor-pointer px-2 py-3 font-medium"
                      onClick={() => toggleSort("name")}
                    >
                      Naam
                    </th>
                    <th className="px-2 py-3 font-medium">Map</th>
                    <th className="px-2 py-3 font-medium">Opbrengst</th>
                    <th
                      className="cursor-pointer px-2 py-3 font-medium"
                      onClick={() => toggleSort("costPerBaseUnit")}
                    >
                      Kostprijs/basiseenheid
                    </th>
                    <th className="px-2 py-3 font-medium">Totale kostprijs</th>
                    <th
                      className="cursor-pointer px-2 py-3 font-medium"
                      onClick={() => toggleSort("usageCount")}
                    >
                      # Gerechten
                    </th>
                    <th className="px-2 py-3 font-medium">Status</th>
                    <th
                      className="cursor-pointer px-2 py-3 font-medium"
                      onClick={() => toggleSort("updated_at")}
                    >
                      Laatst gewijzigd
                    </th>
                    <th className="px-2 py-3 font-medium">Acties</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-border hover:bg-background"
                    >
                      <td className="px-3 py-3">
                        <button onClick={() => toggleFavorite(r.id, r.isFavorite)}>
                          <Star
                            className={cn(
                              "h-4 w-4",
                              r.isFavorite
                                ? "fill-copper text-copper"
                                : "text-muted"
                            )}
                          />
                        </button>
                      </td>
                      <td className="px-1 py-3">
                        <span
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_TYPE, r.id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          title="Sleep naar een map hiernaast om te verplaatsen"
                          className="flex cursor-grab items-center justify-center text-muted hover:text-teal active:cursor-grabbing"
                        >
                          <GripVertical className="h-4 w-4" />
                        </span>
                      </td>
                      <td className="px-2 py-3 font-medium">
                        <Link
                          href={`/halfproducten/${r.id}/bewerken`}
                          className="hover:text-teal hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-2 py-3">
                        <select
                          value={r.halfproduct_folder_id ?? ""}
                          onChange={(e) => moveToFolder(r.id, e.target.value || null)}
                          className="h-8 rounded-md border border-border bg-surface px-1.5 text-xs text-muted"
                          title="Verplaats naar map"
                        >
                          <option value="">Zonder map</option>
                          {folders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-3 tabular text-muted">
                        {r.yield_quantity ?? "—"} {r.unitName ?? ""}
                      </td>
                      <td className="px-2 py-3 tabular">
                        {r.costPerBaseUnit !== null
                          ? `€ ${r.costPerBaseUnit.toFixed(4)}`
                          : "—"}
                      </td>
                      <td className="px-2 py-3 tabular">
                        {r.costPrice !== null ? `€ ${r.costPrice.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-2 py-3 tabular">{r.usageCount}</td>
                      <td className="px-2 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-2 py-3 text-muted">
                        {new Date(r.updated_at).toLocaleDateString("nl-NL")}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => duplicate(r.id)}
                            title="Dupliceren"
                            className="text-muted hover:text-teal"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          {r.status !== "vervallen" && (
                            <button
                              onClick={() => archive(r.id)}
                              title="Archiveren"
                              className="text-muted hover:text-copper"
                            >
                              <Archive className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 && !loading && (
                    <tr>
                      <td colSpan={10} className="px-5 py-6 text-center text-muted">
                        Nog geen halfproducten. Maak het eerste aan, of voeg er
                        een toe via de zoekfunctie binnen een gerecht.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
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

/** Simpele navigatie-regel zonder rename/delete-acties ("Alle mappen", "Zonder map"). */
function FolderNavItem({
  label,
  selected,
  onSelect,
  onDropItem,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  onDropItem?: (recipeId: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={cn(
        "flex items-center rounded-md px-2 py-2.5 text-sm hover:bg-background",
        selected && "bg-teal/10 text-teal",
        dragOver && "scale-[1.02] bg-teal/25 outline outline-2 outline-teal transition-transform"
      )}
      onDragOver={(e) => {
        if (!onDropItem) return;
        if (e.dataTransfer.types.includes(DRAG_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDragEnter={(e) => {
        if (onDropItem && e.dataTransfer.types.includes(DRAG_TYPE)) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!onDropItem) return;
        e.preventDefault();
        setDragOver(false);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (id) onDropItem(id);
      }}
    >
      <button onClick={onSelect} className="flex-1 truncate text-left">
        {label}
      </button>
    </div>
  );
}

/** Map-rij met hernoemen/verwijderen-acties (bij hover) en drop-doel voor drag-and-drop. */
function FolderRow({
  folder,
  count,
  selected,
  onSelect,
  onRename,
  onDelete,
  onDropItem,
}: {
  folder: HalfproductFolder;
  count: number;
  selected: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDropItem: (recipeId: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-2 py-2.5 text-sm hover:bg-background",
        selected && "bg-teal/10 text-teal",
        dragOver && "scale-[1.02] bg-teal/25 outline outline-2 outline-teal transition-transform"
      )}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (id) onDropItem(id);
      }}
    >
      <button onClick={onSelect} className="flex-1 truncate text-left">
        {folder.name}
        {count > 0 && <span className="ml-1 text-xs text-muted">({count})</span>}
      </button>
      <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
        <button onClick={onRename} title="Hernoemen">
          <Pencil className="h-3 w-3 text-muted hover:text-teal" />
        </button>
        <button onClick={onDelete} title="Verwijderen">
          <Trash2 className="h-3 w-3 text-muted hover:text-danger" />
        </button>
      </div>
    </div>
  );
}

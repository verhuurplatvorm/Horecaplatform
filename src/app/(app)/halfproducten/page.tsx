"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Search, Star, Archive, Copy, Download, Trash2, Upload } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { cn } from "@/lib/utils";

interface HalfproductRow {
  id: string;
  name: string;
  category: string | null;
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

export default function HalfproductenPage() {
  const { activeCompanyIds, loading: scopeLoading } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;

  const [rows, setRows] = useState<HalfproductRow[]>([]);
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

      const [{ data: recipes }, { data: units }, { data: favorites }] =
        await Promise.all([
          supabase
            .from("recipes")
            .select("id, name, category, yield_quantity, base_unit_id, status, updated_at")
            .eq("recipe_kind", "halfproduct")
            .order("name"),
          supabase.from("units").select("id, name"),
          groupId
            ? supabase.from("recipe_favorites").select("recipe_id")
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
      "Categorie",
      "Opbrengst",
      "Eenheid",
      "Kostprijs per basiseenheid",
      "Totale productiekostprijs",
      "Status",
      "Laatst gewijzigd",
      "Aantal gekoppelde gerechten",
    ];
    const lines = filteredRows.map((r) => [
      r.name,
      r.category ?? "",
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

  const filteredRows = (() => {
    const visible = rows.filter((r) =>
      showArchived ? true : r.status !== "vervallen"
    );
    const q = query.trim().toLowerCase();
    const searched = q
      ? visible.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            (r.category ?? "").toLowerCase().includes(q)
        )
      : visible;
    // Mappen (categorieën) als tabbladen — zelfde patroon als bij
    // Recepten: elk halfproduct staat alleen in zijn eigen map.
    const matched =
      activeFolder === "__alle__"
        ? searched
        : activeFolder === "__zonder__"
          ? searched.filter((r) => !r.category?.trim())
          : searched.filter((r) => r.category?.trim() === activeFolder);

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

  return (
    <>
      <Topbar title="Halfproducten" />
      <main className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek op naam of categorie…"
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

        <FolderTabs
          rows={rows}
          activeFolder={activeFolder}
          setActiveFolder={setActiveFolder}
          onFolderCleared={(folder) =>
            setRows((prev) =>
              prev.map((r) =>
                r.category?.trim() === folder ? { ...r, category: null } : r
              )
            )
          }
        />

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="w-8 px-3 py-3"></th>
                  <th
                    className="cursor-pointer px-2 py-3 font-medium"
                    onClick={() => toggleSort("name")}
                  >
                    Naam
                  </th>
                  <th className="px-2 py-3 font-medium">Categorie</th>
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
                  <tr key={r.id} className="border-t border-border hover:bg-background">
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
                    <td className="px-2 py-3 font-medium">
                      <Link
                        href={`/halfproducten/${r.id}/bewerken`}
                        className="hover:text-teal hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-2 py-3 text-muted">{r.category ?? "—"}</td>
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

/**
 * Maptabs voor halfproducten — zelfde patroon als bij Recepten. De map
 * is het categorie-veld; "Map verwijderen" verplaatst de halfproducten
 * naar "Zonder map" (verwijdert nooit halfproducten zelf).
 */
function FolderTabs({
  rows,
  activeFolder,
  setActiveFolder,
  onFolderCleared,
}: {
  rows: HalfproductRow[];
  activeFolder: string;
  setActiveFolder: (f: string) => void;
  onFolderCleared: (folder: string) => void;
}) {
  const folders = Array.from(
    new Set(rows.map((r) => r.category?.trim()).filter((c): c is string => !!c))
  ).sort((a, b) => a.localeCompare(b, "nl"));
  const hasUnfiled = rows.some((r) => !r.category?.trim());
  if (folders.length === 0 && !hasUnfiled) return null;

  async function handleDeleteFolder(folder: string) {
    const count = rows.filter((r) => r.category?.trim() === folder).length;
    const ok = window.confirm(
      `Map "${folder}" verwijderen?\n\nDe ${count} halfproduct(en) in deze map ` +
        `worden NIET verwijderd — ze verhuizen naar "Zonder map".`
    );
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("recipes")
      .update({ category: null })
      .eq("category", folder)
      .eq("recipe_kind", "halfproduct");
    if (error) {
      window.alert("Map verwijderen mislukt: " + error.message);
      return;
    }
    onFolderCleared(folder);
    setActiveFolder("__alle__");
  }

  const tab = (key: string, label: string) => (
    <button
      key={key}
      onClick={() => setActiveFolder(key)}
      className={`rounded-full px-3 py-1.5 text-sm ${
        activeFolder === key
          ? "bg-teal text-white"
          : "bg-surface text-muted hover:bg-background"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tab("__alle__", `Alle mappen (${rows.length})`)}
      {folders.map((f) =>
        tab(f, `${f} (${rows.filter((r) => r.category?.trim() === f).length})`)
      )}
      {activeFolder !== "__alle__" && activeFolder !== "__zonder__" && (
        <button
          onClick={() => handleDeleteFolder(activeFolder)}
          title={'Map "' + activeFolder + '" verwijderen (halfproducten verhuizen naar Zonder map)'}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Map verwijderen
        </button>
      )}
      {hasUnfiled &&
        tab(
          "__zonder__",
          `Zonder map (${rows.filter((r) => !r.category?.trim()).length})`
        )}
    </div>
  );
}

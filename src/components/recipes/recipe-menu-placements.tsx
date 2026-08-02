"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";
import type { MenuCard, MenuFolder, MenuItem } from "@/lib/types/database";

interface PlacementRow extends MenuItem {
  folderName: string;
  menuCardId: string;
  menuCardName: string;
  menuCardStatus: string;
}

export function RecipeMenuPlacements({
  recipeId,
  recipeSalesPrice,
}: {
  recipeId: string;
  recipeSalesPrice: number | null;
}) {
  const [placements, setPlacements] = useState<PlacementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [editing, setEditing] = useState<PlacementRow | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data } = await supabase
        .from("menu_items")
        .select("*, menu_folders(name, menu_card_id, menu_cards(name, status))")
        .eq("recipe_id", recipeId);

      if (cancelled) return;
      const rows: PlacementRow[] = (data ?? []).map((row) => ({
        ...row,
        // @ts-expect-error -- geneste relaties, niet in het handmatige Database-type
        folderName: row.menu_folders?.name ?? "onbekende map",
        // @ts-expect-error -- geneste relaties
        menuCardId: row.menu_folders?.menu_card_id ?? "",
        // @ts-expect-error -- geneste relaties
        menuCardName: row.menu_folders?.menu_cards?.name ?? "onbekende menukaart",
        // @ts-expect-error -- geneste relaties
        menuCardStatus: row.menu_folders?.menu_cards?.status ?? "concept",
      }));
      setPlacements(rows);
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [recipeId, reloadToken]);

  function reload() {
    setReloadToken((t) => t + 1);
  }

  async function handleToggleVisible(row: PlacementRow) {
    const supabase = createClient();
    await supabase
      .from("menu_items")
      .update({ is_visible: !row.is_visible })
      .eq("id", row.id);
    reload();
  }

  async function handleRemove(row: PlacementRow) {
    if (
      !window.confirm(
        `Van menukaart "${row.menuCardName}" verwijderen? Het gerecht zelf blijft gewoon bestaan.`
      )
    )
      return;
    const supabase = createClient();
    await supabase.from("menu_items").delete().eq("id", row.id);
    reload();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Op menukaarten</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" />
          Toevoegen aan menukaart
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Menukaart</th>
              <th className="px-5 py-3 font-medium">Map</th>
              <th className="px-5 py-3 font-medium">Naam op kaart</th>
              <th className="px-5 py-3 font-medium">Prijs</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {placements.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-5 py-3 font-medium">
                  <Link href={`/menukaarten/${row.menuCardId}`} className="hover:text-teal hover:underline">
                    {row.menuCardName}
                  </Link>
                  {row.menuCardStatus === "concept" && (
                    <span className="ml-2 rounded-full bg-muted/10 px-1.5 py-0.5 text-xs text-muted">
                      concept
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-muted">{row.folderName}</td>
                <td className="px-5 py-3">{row.display_name ?? "—"}</td>
                <td className="px-5 py-3 tabular">
                  {row.price !== null ? (
                    <>
                      € {row.price.toFixed(2)}
                      {recipeSalesPrice !== null && row.price !== recipeSalesPrice && (
                        <p className="text-xs text-copper">
                          afwijkend van € {recipeSalesPrice.toFixed(2)}
                        </p>
                      )}
                    </>
                  ) : recipeSalesPrice !== null ? (
                    `€ ${recipeSalesPrice.toFixed(2)} (centraal)`
                  ) : (
                    <span className="flex items-center gap-1 text-danger">
                      <TriangleAlert className="h-3.5 w-3.5" /> geen prijs
                    </span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleVisible(row)}
                      title={row.is_visible ? "Verbergen" : "Zichtbaar maken"}
                      className="text-muted hover:text-teal"
                    >
                      {row.is_visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => setEditing(row)}
                      title="Menukaartgegevens bewerken"
                      className="text-muted hover:text-teal"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleRemove(row)}
                      title="Van menukaart verwijderen"
                      className="text-muted hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {placements.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-muted">
                  Dit gerecht staat nog op geen enkele menukaart.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>

      {editing && (
        <PlacementEditModal
          placement={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {adding && (
        <AddToMenuCardModal
          recipeId={recipeId}
          existingMenuCardIds={placements.map((p) => p.menuCardId)}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </Card>
  );
}

function PlacementEditModal({
  placement,
  onClose,
  onSaved,
}: {
  placement: PlacementRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(placement.display_name ?? "");
  const [shortDescription, setShortDescription] = useState(placement.short_description ?? "");
  const [price, setPrice] = useState(placement.price?.toString() ?? "");
  const [isNew, setIsNew] = useState(placement.is_new);
  const [isPopular, setIsPopular] = useState(placement.is_popular);
  const [isChefsSpecial, setIsChefsSpecial] = useState(placement.is_chefs_special);
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
        is_new: isNew,
        is_popular: isPopular,
        is_chefs_special: isChefsSpecial,
      })
      .eq("id", placement.id);
    setSaving(false);
    onSaved();
  }

  return (
    <Modal title={`Menukaartgegevens — ${placement.menuCardName}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Naam op kaart</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Prijs (leeg = centrale prijs)
            </label>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
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
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Opslaan…" : "Opslaan"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
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

function AddToMenuCardModal({
  recipeId,
  existingMenuCardIds,
  onClose,
  onAdded,
}: {
  recipeId: string;
  existingMenuCardIds: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [menuCards, setMenuCards] = useState<MenuCard[]>([]);
  const [folders, setFolders] = useState<MenuFolder[]>([]);
  const [menuCardId, setMenuCardId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("menu_cards")
      .select("*")
      .order("name")
      .then(({ data }) => setMenuCards((data as MenuCard[]) ?? []));
  }, []);

  useEffect(() => {
    if (!menuCardId) return;
    const supabase = createClient();
    supabase
      .from("menu_folders")
      .select("*")
      .eq("menu_card_id", menuCardId)
      .order("sort_order")
      .then(({ data }) => setFolders((data as MenuFolder[]) ?? []));
  }, [menuCardId]);

  async function handleAdd() {
    if (!folderId) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { count } = await supabase
      .from("menu_items")
      .select("id", { count: "exact", head: true })
      .eq("folder_id", folderId);
    const { error: insertError } = await supabase.from("menu_items").insert({
      folder_id: folderId,
      recipe_id: recipeId,
      sort_order: count ?? 0,
    });
    setSaving(false);
    if (insertError) {
      setError("Toevoegen mislukt: " + insertError.message);
      return;
    }
    onAdded();
  }

  return (
    <Modal title="Toevoegen aan menukaart" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Menukaart</label>
          <select
            value={menuCardId}
            onChange={(e) => {
              setMenuCardId(e.target.value);
              setFolderId("");
              setFolders([]);
            }}
            className="input"
          >
            <option value="">Kies menukaart…</option>
            {menuCards.map((c) => (
              <option key={c.id} value={c.id} disabled={existingMenuCardIds.includes(c.id)}>
                {c.name}
                {existingMenuCardIds.includes(c.id) ? " (al toegevoegd)" : ""}
              </option>
            ))}
          </select>
        </div>
        {menuCardId && (
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Map</label>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="input">
              <option value="">Kies map…</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={handleAdd} disabled={!folderId || saving}>
            {saving ? "Bezig…" : "Toevoegen"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Annuleren
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

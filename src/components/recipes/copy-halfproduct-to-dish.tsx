"use client";

// TIJDELIJK — "Halfproduct kopiëren naar gerechten".
// Verwijderen zodra Henny zegt: "opruimen kopieren halfproducten naar gerechten".
// Alles zit in dit ene bestand + één regel in halfproduct-header.tsx.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * Maakt van een halfproduct een (concept-)gerecht met dezelfde ingrediënten
 * en halfproducten. Het halfproduct zelf blijft ongewijzigd.
 * "Aantal porties": de hoeveelheden worden daardoor gedeeld (een gerecht
 * is per portie).
 */
export function CopyHalfproductToDish({ recipeId, name }: { recipeId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState(name);
  const [folder, setFolder] = useState("Partijgerechten");
  const [folders, setFolders] = useState<string[]>([]);
  const [portions, setPortions] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    createClient()
      .from("recipe_folders")
      .select("name, is_main, is_archived, sort_order")
      .order("sort_order")
      .then(({ data }) =>
        setFolders((data ?? []).filter((f) => !f.is_main && !f.is_archived).map((f) => f.name as string)),
      );
  }, [open]);

  async function copy() {
    const n = Math.max(1, Number(portions.replace(",", ".")) || 1);
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: original } = await supabase.from("recipes").select("*").eq("id", recipeId).single();
    if (!original) {
      setBusy(false);
      setError("Kan dit halfproduct niet lezen.");
      return;
    }
    const { data: lines } = await supabase.from("recipe_ingredients").select("*").eq("recipe_id", recipeId);

    const { data: created, error: err } = await supabase
      .from("recipes")
      .insert({
        group_id: original.group_id,
        company_id: original.company_id,
        name: newName.trim() || original.name,
        recipe_kind: "gerecht" as const,
        status: "concept" as const,
        category: folder || null,
        preparation: original.preparation,
        plating_instructions: original.plating_instructions,
        synonyms: original.synonyms,
        waste_percentage: original.waste_percentage,
        photo_url: original.photo_url,
        allergen_overrides: original.allergen_overrides,
        station_id: original.station_id ?? null,
        portion_size: 1,
        vat_rate: original.vat_rate,
      })
      .select("id")
      .single();
    if (err || !created) {
      setBusy(false);
      setError("Kopiëren mislukt: " + (err?.message ?? "onbekende fout"));
      return;
    }
    if (lines?.length) {
      const { error: lineErr } = await supabase.from("recipe_ingredients").insert(
        lines.map((l) => {
          const { id: _id, ...rest } = l;
          void _id;
          return {
            ...rest,
            recipe_id: created.id,
            quantity: l.quantity == null ? null : Math.round((Number(l.quantity) / n) * 10000) / 10000,
          };
        }),
      );
      if (lineErr) {
        setBusy(false);
        setError("Gerecht aangemaakt, maar de ingrediënten konden niet worden gekopieerd: " + lineErr.message);
        return;
      }
    }
    router.push(`/recepturen/${created.id}/bewerken`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Tijdelijk: maak een gerecht van dit halfproduct"
        className="flex items-center gap-1.5 rounded-md border border-dashed border-teal px-2.5 py-1.5 text-sm text-teal hover:bg-teal/5"
      >
        <BookOpen className="h-3.5 w-3.5" />
        Naar gerechten
      </button>
      {open && (
        <Modal title="Kopiëren naar gerechten" onClose={() => setOpen(false)}>
          <div className="space-y-3 text-sm">
            <p className="text-muted">
              Er wordt een nieuw concept-gerecht gemaakt met dezelfde ingrediënten en halfproducten. Het halfproduct
              blijft gewoon bestaan en verandert niet.
            </p>
            <label className="block">
              <span className="mb-1 block font-medium">Naam gerecht</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} className="input" />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium">Map in Gerechten</span>
              <select value={folder} onChange={(e) => setFolder(e.target.value)} className="input">
                {!folders.includes(folder) && <option value={folder}>{folder}</option>}
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block font-medium">Aantal porties uit dit recept</span>
              <input
                type="number"
                min="1"
                step="any"
                value={portions}
                onChange={(e) => setPortions(e.target.value)}
                className="input w-32!"
              />
              <span className="mt-1 block text-xs text-muted">
                Een gerecht is per portie: alle hoeveelheden worden hierdoor gedeeld. Bij 1 (bv. één schaal) blijven
                ze gelijk.
              </span>
            </label>
            {error && <p className="text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={() => void copy()} disabled={busy}>
                {busy ? "Kopiëren…" : "Gerecht maken"}
              </Button>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Annuleren
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

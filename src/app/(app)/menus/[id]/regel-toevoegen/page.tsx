"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import type { Unit } from "@/lib/types/database";

interface Hit {
  id: string;
  name: string;
  kind: "gerecht" | "halfproduct" | "ingrediënt";
  baseUnitId: string | null;
}

/**
 * Regel toevoegen aan een menu: een gerecht, halfproduct of los
 * ingrediënt, met de hoeveelheid per persoon. Zoekt in dezelfde
 * bestaande recepten- en ingrediëntenlijsten — er wordt hier niets
 * nieuws vastgelegd behalve de koppeling zelf.
 */
export default function RegelToevoegenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [selected, setSelected] = useState<Hit | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [isFixed, setIsFixed] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.from("units").select("*").order("sort_order").then(({ data }) => {
      setUnits((data as Unit[]) ?? []);
    });
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const supabase = createClient();
      const [{ data: recipes }, { data: products }] = await Promise.all([
        supabase
          .from("recipes")
          .select("id, name, recipe_kind, base_unit_id")
          .ilike("name", `%${query.trim()}%`)
          .limit(10),
        supabase
          .from("products")
          .select("id, name, custom_name, base_unit_id")
          .ilike("name", `%${query.trim()}%`)
          .limit(10),
      ]);
      if (cancelled) return;
      setHits([
        ...(recipes ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          kind: (r.recipe_kind === "halfproduct" ? "halfproduct" : "gerecht") as Hit["kind"],
          baseUnitId: r.base_unit_id,
        })),
        ...(products ?? []).map((p) => ({
          id: p.id,
          name: p.custom_name?.trim() || p.name,
          kind: "ingrediënt" as const,
          baseUnitId: p.base_unit_id,
        })),
      ]);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  async function add() {
    if (!selected || !quantity.trim()) return;
    setSaving(true);
    const supabase = createClient();

    // Onderdeel (bv. "Koud buffet") aanmaken of hergebruiken.
    let sectionId: string | null = null;
    if (sectionName.trim()) {
      const { data: existing } = await supabase
        .from("event_menu_sections")
        .select("id")
        .eq("menu_id", id)
        .eq("name", sectionName.trim())
        .maybeSingle();
      if (existing) sectionId = existing.id;
      else {
        const { data: created } = await supabase
          .from("event_menu_sections")
          .insert({ menu_id: id, name: sectionName.trim() })
          .select("id")
          .single();
        sectionId = created?.id ?? null;
      }
    }

    const { error } = await supabase.from("event_menu_lines").insert({
      menu_id: id,
      section_id: sectionId,
      recipe_id: selected.kind === "ingrediënt" ? null : selected.id,
      product_id: selected.kind === "ingrediënt" ? selected.id : null,
      quantity_per_person: Number(quantity),
      unit_id: unitId || selected.baseUnitId,
      is_fixed: isFixed,
      note: note.trim() || null,
    });
    setSaving(false);
    if (error) {
      window.alert("Toevoegen mislukt: " + error.message);
      return;
    }
    router.push(`/menus/${id}`);
  }

  return (
    <>
      <Topbar title="Regel toevoegen" />
      <main className="max-w-xl space-y-4 p-6">
        <Card>
          <CardContent className="space-y-4 pt-5">
            {!selected ? (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Zoek een gerecht, halfproduct of ingrediënt…"
                    className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
                  />
                </div>
                <div className="divide-y divide-border rounded-md border border-border">
                  {hits.map((h) => (
                    <button
                      key={`${h.kind}-${h.id}`}
                      onClick={() => {
                        setSelected(h);
                        setUnitId(h.baseUnitId ?? "");
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-background"
                    >
                      <span className="truncate">{h.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-muted">{h.kind}</span>
                    </button>
                  ))}
                  {hits.length === 0 && (
                    <p className="px-3 py-6 text-center text-sm text-muted">
                      {query.trim() ? "Niets gevonden." : "Typ om te zoeken."}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-md bg-teal/5 px-3 py-2">
                  <span className="font-medium">{selected.name}</span>
                  <button
                    onClick={() => setSelected(null)}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    Anders kiezen
                  </button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Hoeveelheid {isFixed ? "totaal" : "per persoon"}
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      autoFocus
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Eenheid</label>
                    <select
                      value={unitId}
                      onChange={(e) => setUnitId(e.target.value)}
                      className="input"
                    >
                      <option value="">Kies…</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-sm font-medium">
                      Onderdeel (optioneel)
                    </label>
                    <input
                      value={sectionName}
                      onChange={(e) => setSectionName(e.target.value)}
                      placeholder="bv. Koud buffet"
                      className="input"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-sm font-medium">
                      Opmerking (optioneel)
                    </label>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="input"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={isFixed}
                      onChange={(e) => setIsFixed(e.target.checked)}
                    />
                    Vaste hoeveelheid — telt één keer voor het hele menu, niet per persoon
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button onClick={add} disabled={saving || !quantity.trim()}>
                    {saving ? "Toevoegen…" : "Toevoegen"}
                  </Button>
                  <Button variant="secondary" onClick={() => router.push(`/menus/${id}`)}>
                    Annuleren
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}

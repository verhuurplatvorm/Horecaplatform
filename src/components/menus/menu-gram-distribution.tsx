"use client";

import { useEffect, useState } from "react";
import { Scale, TriangleAlert } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_TARGET_GRAMS,
  distributeGrams,
} from "@/lib/event-menus/distribute-grams";
import type { Unit } from "@/lib/types/database";

interface Row {
  id: string;
  name: string;
  section: string | null;
  isFixed: boolean;
  current: string;
  /** Eenheid waarin dit item in gewicht kan (g, of ml bij vloeibaar). */
  weightUnitId: string | null;
  warning: string | null;
}

/**
 * "Grammen verdelen": zet alle (niet-vaste, niet-vega) regels van een menu
 * om naar gram per persoon, verdeeld over het gekozen totaal (700 g p.p.).
 */
export function MenuGramDistribution({
  menuId,
  units,
  onDone,
}: {
  menuId: string;
  units: Unit[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(String(DEFAULT_TARGET_GRAMS));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);

  const g = units.find((u) => u.key === "g");
  const ml = units.find((u) => u.key === "ml");
  const unitName = (id: string | null) =>
    units.find((u) => u.id === id)?.name ?? "";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: lines } = await supabase
        .from("event_menu_lines")
        .select(
          "id, recipe_id, product_id, quantity_per_person, unit_id, is_fixed, sort_order, section_id",
        )
        .eq("menu_id", menuId)
        .order("sort_order");
      const { data: secs } = await supabase
        .from("event_menu_sections")
        .select("id, name, sort_order")
        .eq("menu_id", menuId);
      const recipeIds = (lines ?? [])
        .map((l) => l.recipe_id)
        .filter(Boolean) as string[];
      const productIds = (lines ?? [])
        .map((l) => l.product_id)
        .filter(Boolean) as string[];
      const [{ data: recs }, { data: prods }] = await Promise.all([
        recipeIds.length
          ? supabase
              .from("recipes")
              .select("id, name, recipe_kind, base_unit_id, yield_quantity")
              .in("id", recipeIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                name: string;
                recipe_kind: string;
                base_unit_id: string | null;
                yield_quantity: number | null;
              }[],
            }),
        productIds.length
          ? supabase
              .from("products")
              .select("id, name, custom_name, base_unit_id, avg_unit_quantity")
              .in("id", productIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                name: string;
                custom_name: string | null;
                base_unit_id: string | null;
                avg_unit_quantity: number | null;
              }[],
            }),
      ]);
      const rec = new Map((recs ?? []).map((r) => [r.id, r]));
      const prod = new Map((prods ?? []).map((p) => [p.id, p]));
      const secName = new Map(
        (secs ?? []).map((s) => [s.id, s.name as string]),
      );
      const secSort = new Map(
        (secs ?? []).map((s) => [s.id, s.sort_order as number]),
      );
      const dim = (unitId: string | null | undefined) =>
        units.find((u) => u.id === unitId)?.dimension;

      const out: Row[] = (lines ?? [])
        .slice()
        .sort(
          (a, b) =>
            (secSort.get(a.section_id ?? "") ?? 999) -
              (secSort.get(b.section_id ?? "") ?? 999) ||
            a.sort_order - b.sort_order,
        )
        .map((l) => {
          let name = "?";
          let weightUnitId: string | null = g?.id ?? null;
          let warning: string | null = null;
          if (l.product_id) {
            const p = prod.get(l.product_id);
            name = p ? p.custom_name || p.name : "?";
            const d = dim(p?.base_unit_id);
            if (d === "inhoud") weightUnitId = ml?.id ?? null;
            else if (d === "aantal" && !p?.avg_unit_quantity)
              warning = "ingrediënt in stuks zonder gewicht per stuk";
          } else if (l.recipe_id) {
            const r = rec.get(l.recipe_id);
            name = r?.name ?? "?";
            const d = dim(r?.base_unit_id);
            if (d === "inhoud") weightUnitId = ml?.id ?? null;
            if (
              !r?.base_unit_id ||
              !(Number(r?.yield_quantity) > 0) ||
              d === "aantal"
            ) {
              warning =
                r?.recipe_kind === "gerecht"
                  ? "gerecht zonder totaalgewicht — zet het gerecht op 'In grammen'"
                  : "halfproduct zonder opbrengst in gram/ml";
            }
          }
          return {
            id: l.id,
            name,
            section: l.section_id ? (secName.get(l.section_id) ?? null) : null,
            isFixed: l.is_fixed,
            current: `${Number(l.quantity_per_person).toLocaleString("nl-NL")} ${unitName(l.unit_id)}`,
            weightUnitId,
            warning,
          };
        });
      if (!cancelled) setRows(out);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, menuId]);

  const grams = rows
    ? distributeGrams(rows, Math.max(0, Number(target) || 0))
    : [];

  async function apply() {
    if (!rows) return;
    setBusy(true);
    const supabase = createClient();
    for (let i = 0; i < rows.length; i++) {
      const q = grams[i];
      if (q == null || !rows[i].weightUnitId) continue;
      await supabase
        .from("event_menu_lines")
        .update({ quantity_per_person: q, unit_id: rows[i].weightUnitId })
        .eq("id", rows[i].id);
    }
    setBusy(false);
    setOpen(false);
    onDone();
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Scale className="h-3.5 w-3.5" />
        Grammen verdelen
      </Button>
      {open && (
        <Modal
          title="Automatisch verdelen in grammen"
          onClose={() => setOpen(false)}
        >
          <div className="space-y-3 text-sm">
            <p className="text-muted">
              Alle regels krijgen een hoeveelheid in gram per persoon, verdeeld
              naar soort (warm vlees/vis het meest, sauzen en slagroom het
              minst). Vaste regels en vega-onderdelen doen niet mee. Daarna kun
              je per regel fine-tunen.
            </p>
            <label className="flex items-center gap-2">
              <span className="font-medium">Totaal per persoon</span>
              <input
                type="number"
                min="0"
                step="10"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="input w-24! text-right"
              />
              <span>gram</span>
            </label>
            {!rows ? (
              <p className="text-muted">Laden…</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th className="py-1 font-medium">Regel</th>
                      <th className="py-1 font-medium">Nu</th>
                      <th className="py-1 text-right font-medium">
                        Nieuw p.p.
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={r.id}
                        className="border-t border-border align-top"
                      >
                        <td className="py-1 pr-2">
                          {r.name}
                          <span className="block text-xs text-muted">
                            {r.section ?? "—"}
                          </span>
                          {r.warning && grams[i] != null && (
                            <span className="flex items-center gap-1 text-xs text-copper">
                              <TriangleAlert className="h-3 w-3" /> {r.warning}{" "}
                              — kostprijs telt pas mee als dat er is
                            </span>
                          )}
                        </td>
                        <td className="py-1 pr-2 text-muted">{r.current}</td>
                        <td className="py-1 text-right tabular font-medium">
                          {grams[i] == null ? (
                            <span className="text-muted">blijft</span>
                          ) : (
                            `${grams[i]} ${r.weightUnitId === ml?.id ? "ml" : "g"}`
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={() => void apply()} disabled={busy || !rows}>
                {busy ? "Opslaan…" : "Toepassen"}
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

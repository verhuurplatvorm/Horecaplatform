"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { looksNonFood } from "@/lib/products/non-food";
import { normalizeItemKey } from "@/lib/price-import/ignored-items";
import { ProductViewTabs } from "@/components/products/product-view-tabs";

interface Candidate {
  id: string;
  name: string;
  groupId: string;
  suppliers: { supplierId: string; supplierName: string; articleCode: string | null }[];
  inUse: boolean;
}

const PAGE = 1000;

/** Haalt alle rijen op, 1000 per keer (de standaardgrens van de database). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>) {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export default function NonFoodOpruimenPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const products = await fetchAll<{
        id: string;
        name: string;
        custom_name: string | null;
        group_id: string;
        supplier_products: {
          supplier_id: string;
          supplier_article_code: string | null;
          valid_to: string | null;
          suppliers: { name: string } | null;
        }[];
      }>((from, to) =>
        supabase
          .from("products")
          .select(
            "id, name, custom_name, group_id, supplier_products(supplier_id, supplier_article_code, valid_to, suppliers(name))"
          )
          .eq("is_active", true)
          .order("name")
          .range(from, to) as never
      );

      const flagged = products.filter((p) => looksNonFood(p.custom_name || p.name));

      // Wat al ergens in gebruikt wordt, mag niet weg.
      const used = new Set<string>();
      for (const [table, col] of [
        ["recipe_ingredients", "product_id"],
        ["event_menu_lines", "product_id"],
        ["waste_registrations", "product_id"],
        ["stock_movements", "product_id"],
      ] as const) {
        const rows = await fetchAll<Record<string, string | null>>((from, to) =>
          supabase.from(table).select(col).not(col, "is", null).range(from, to) as never
        );
        for (const r of rows) if (r[col]) used.add(r[col] as string);
      }

      const list: Candidate[] = flagged.map((p) => ({
        id: p.id,
        name: p.custom_name || p.name,
        groupId: p.group_id,
        suppliers: (p.supplier_products ?? [])
          .filter((sp) => sp.valid_to === null)
          .map((sp) => ({
            supplierId: sp.supplier_id,
            supplierName: sp.suppliers?.name ?? "—",
            articleCode: sp.supplier_article_code,
          })),
        inUse: used.has(p.id),
      }));
      setCandidates(list);
      // Alles staat vooraf aangevinkt, behalve wat in gebruik is.
      setSelected(new Set(list.filter((c) => !c.inUse).map((c) => c.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    }
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const supplierNames = useMemo(
    () => [...new Set(candidates.flatMap((c) => c.suppliers.map((s) => s.supplierName)))].sort(),
    [candidates]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter(
      (c) =>
        (!supplierFilter || c.suppliers.some((s) => s.supplierName === supplierFilter)) &&
        (!q || c.name.toLowerCase().includes(q))
    );
  }, [candidates, supplierFilter, search]);

  const selectable = visible.filter((c) => !c.inUse);
  const selectedVisible = selectable.filter((c) => selected.has(c.id)).length;
  const selectedTotal = candidates.filter((c) => selected.has(c.id) && !c.inUse).length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAllVisible(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of selectable) {
        if (on) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  }

  async function handleDelete() {
    const chosen = candidates.filter((c) => selected.has(c.id) && !c.inUse);
    if (chosen.length === 0) return;
    if (
      !window.confirm(
        `${chosen.length} artikelen definitief verwijderen?\n\n` +
          "Ze verdwijnen met hun prijzen uit het systeem. Bij een volgende factuur of prijslijst " +
          "worden ze automatisch overgeslagen (te zien onder Genegeerde artikelen)."
      )
    )
      return;

    setBusy(true);
    setResult(null);
    const supabase = createClient();
    let failed = 0;

    // 1. Op de negeerlijst per leverancier, zodat ze niet terugkomen.
    const ignoreRows = chosen.flatMap((c) =>
      c.suppliers.map((s) => ({
        group_id: c.groupId,
        supplier_id: s.supplierId,
        article_number: s.articleCode || null,
        description: c.name,
        description_key: normalizeItemKey(c.name),
      }))
    );
    // Eén voor één (parallel in blokjes): een dubbele regel (al op de lijst)
    // mag de rest niet laten mislukken.
    for (let i = 0; i < ignoreRows.length; i += 20) {
      await Promise.all(
        ignoreRows.slice(i, i + 20).map((row) => supabase.from("ignored_invoice_items").insert(row))
      );
    }

    // 2. Verwijderen, per blokje. Wat toch ergens in gebruikt blijkt te zijn, blijft staan.
    let deleted = 0;
    for (let i = 0; i < chosen.length; i += 50) {
      const ids = chosen.slice(i, i + 50).map((c) => c.id);
      const { error: delErr } = await supabase.from("products").delete().in("id", ids);
      if (delErr) {
        for (const id of ids) {
          const { error: oneErr } = await supabase.from("products").delete().eq("id", id);
          if (oneErr) failed++;
          else deleted++;
        }
      } else {
        deleted += ids.length;
      }
    }

    setBusy(false);
    setResult(
      `${deleted} artikelen verwijderd` +
        (failed > 0 ? `; ${failed} bleken toch in gebruik of mochten niet weg en blijven staan.` : ".")
    );
    load();
  }

  return (
    <>
      <Topbar title="Non-food opruimen" />
      <main className="max-w-5xl p-6 space-y-4">
        <ProductViewTabs />
        <p className="text-sm text-muted">
          Hieronder staan artikelen die er waarschijnlijk geen eten of drinken zijn (borden, bakken, folie,
          schoonmaak, enzovoort). Alles staat aangevinkt: vink weg wat wél goed is en kies dan
          &quot;Verwijderen&quot;. Artikelen die in een recept, menu, voorraad of afvalregistratie gebruikt
          worden kun je niet aanvinken.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op naam…"
            className="h-9 w-56 rounded-md border border-border bg-surface px-3 text-sm"
          />
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          >
            <option value="">Alle leveranciers</option>
            {supplierNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setAllVisible(true)} className="text-sm text-teal hover:underline">
            Alles selecteren
          </button>
          <button type="button" onClick={() => setAllVisible(false)} className="text-sm text-teal hover:underline">
            Niets selecteren
          </button>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-muted">{selectedTotal} geselecteerd</span>
            <Button type="button" onClick={handleDelete} disabled={busy || selectedTotal === 0}>
              <Trash2 className="h-4 w-4" />
              Verwijderen
            </Button>
          </div>
        </div>

        {result && <p className="text-sm text-success">{result}</p>}
        {error && <p className="text-sm text-danger">{error}</p>}

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-sm text-muted">Laden… (alle artikelen worden doorzocht)</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label="Alles in deze lijst selecteren"
                          checked={selectable.length > 0 && selectedVisible === selectable.length}
                          onChange={(e) => setAllVisible(e.target.checked)}
                        />
                      </th>
                      <th className="px-2 py-3 font-medium">Artikel</th>
                      <th className="px-4 py-3 font-medium">Leverancier</th>
                      <th className="px-4 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => (
                      <tr key={c.id} className="border-t border-border">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selected.has(c.id) && !c.inUse}
                            disabled={c.inUse}
                            onChange={() => toggle(c.id)}
                            aria-label={`Selecteer ${c.name}`}
                          />
                        </td>
                        <td className="px-2 py-2 font-medium">{c.name}</td>
                        <td className="px-4 py-2 text-muted">
                          {[...new Set(c.suppliers.map((s) => s.supplierName))].join(", ") || "—"}
                        </td>
                        <td className="px-4 py-2 text-xs text-copper">{c.inUse ? "in gebruik" : ""}</td>
                      </tr>
                    ))}
                    {visible.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-5 py-6 text-center text-muted">
                          Geen artikelen gevonden die er als non-food uitzien.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}

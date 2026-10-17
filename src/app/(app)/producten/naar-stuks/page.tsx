"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";
import {
  approxEqual,
  convert,
  diagnosePackaging,
  fmt,
  isUnitKey,
  parsePackaging,
  pricesFromCount,
  UNIT_TABLE,
  type KeyBridge,
  type UnitKey,
} from "@/lib/packaging";

/**
 * Alles naar stuks: producten die nu in gram/ml rekenen terwijl de verpakking
 * een multipack is ("45 × 110 g", "24 × 33 cl") krijgen basiseenheid stuk,
 * aantal = N en gewicht/inhoud per stuk = M. Eerst voorbeeld, pas na
 * bevestiging toepassen. Inkoopprijs, verkoopprijzen en prijshistorie blijven
 * ongewijzigd; het wordt als technische correctie gelogd (geen prijsalarm).
 */

interface Candidate {
  productId: string;
  productName: string;
  baseKey: UnitKey;
  description: string;
  packs: number;
  size: number;
  sizeUnit: UnitKey;
  price: number;
  supplierNames: string[];
  before: string;
  after: string;
  warning: string | null;
}

const euro = (n: number | null) => (n === null ? "—" : `€ ${fmt(n, 4)}`);
const PAGE_SIZE = 1000;

function pricesText(p: ReturnType<typeof pricesFromCount>): string {
  const parts: string[] = [];
  if (p.perPiece !== null) parts.push(`${euro(p.perPiece)} / stuk`);
  if (p.perKg !== null) parts.push(`${euro(p.perKg)} / kg`);
  if (p.perLiter !== null) parts.push(`${euro(p.perLiter)} / l`);
  return parts.join(" · ") || "—";
}

export default function NaarStuksPage() {
  const [rows, setRows] = useState<Candidate[]>([]);
  const [skipped, setSkipped] = useState<{ name: string; why: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [unitIds, setUnitIds] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      const supabase = createClient();
      const { data: unitsData, error: unitsError } = await supabase.from("units").select("id, key");
      if (unitsError || !unitsData) {
        setError("Kan eenheden niet ophalen");
        setLoading(false);
        return;
      }
      const keyById = new Map<string, string>(unitsData.map((u) => [u.id as string, u.key as string]));
      const ids: Record<string, string> = {};
      for (const u of unitsData) ids[u.key as string] = u.id as string;
      setUnitIds(ids);

      type Raw = {
        productId: string;
        name: string;
        baseKey: UnitKey;
        bridge: KeyBridge | null;
        description: string | null;
        count: number;
        price: number;
        supplier: string;
      };
      const raws: Raw[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error: e } = await supabase
          .from("supplier_products")
          .select(
            "id, product_id, packaging_description, packaging_unit_count, purchase_price, suppliers(name), products!inner(name, base_unit_id, avg_unit_quantity, avg_unit_id, net_unit_quantity, is_active)"
          )
          .is("valid_to", null)
          .eq("products.is_active", true)
          .order("id")
          .range(from, from + PAGE_SIZE - 1);
        if (e) {
          if (!cancelled) {
            setError("Kan prijzen niet ophalen: " + e.message);
            setLoading(false);
          }
          return;
        }
        for (const r of data ?? []) {
          const product = (r as unknown as { products: Record<string, unknown> }).products;
          const supplier = (r as unknown as { suppliers: { name: string } | null }).suppliers;
          const baseKey = keyById.get(product.base_unit_id as string);
          if (baseKey !== "g" && baseKey !== "ml") continue;
          const avgKey = product.avg_unit_id ? keyById.get(product.avg_unit_id as string) : null;
          raws.push({
            productId: r.product_id as string,
            name: product.name as string,
            baseKey,
            bridge:
              product.avg_unit_quantity && isUnitKey(avgKey)
                ? { quantity: Number(product.avg_unit_quantity), unit: avgKey }
                : null,
            description: (r.packaging_description as string | null) ?? null,
            count: Number(r.packaging_unit_count),
            price: Number(r.purchase_price),
            supplier: supplier?.name ?? "onbekend",
          });
        }
        if ((data?.length ?? 0) < PAGE_SIZE) break;
      }

      const byProduct = new Map<string, Raw[]>();
      for (const r of raws) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);

      const list: Candidate[] = [];
      const skip: { name: string; why: string }[] = [];
      for (const [productId, group] of byProduct) {
        const first = group[0];
        const dim = UNIT_TABLE[first.baseKey].dimension;
        let chosen: { packs: number; size: number; unit: UnitKey; description: string; price: number } | null = null;
        let conflict: string | null = null;
        for (const g of group) {
          const spec = parsePackaging(g.description);
          if (!spec || spec.kind !== "multi" || !spec.packs || !spec.perPack || spec.packs <= 1) continue;
          if (UNIT_TABLE[spec.unit].dimension !== dim) continue;
          const expected = convert(spec.total, spec.unit, first.baseKey);
          if (expected === null || !approxEqual(expected, g.count)) {
            conflict = "aantal klopt niet met omschrijving (eerst via Verpakking aanpassen)";
            continue;
          }
          if (chosen) {
            const a = convert(chosen.size, chosen.unit, first.baseKey);
            const b = convert(spec.perPack, spec.unit, first.baseKey);
            if (a === null || b === null || !approxEqual(a, b) || chosen.packs !== spec.packs) {
              conflict = "leveranciers hebben verschillende verpakkingen";
            }
            continue;
          }
          chosen = { packs: spec.packs, size: spec.perPack, unit: spec.unit, description: g.description ?? "", price: g.price };
        }
        if (!chosen) {
          if (conflict) skip.push({ name: first.name, why: conflict });
          continue;
        }
        if (conflict) {
          skip.push({ name: first.name, why: conflict });
          continue;
        }
        if (first.bridge) {
          const a = convert(first.bridge.quantity as number, first.bridge.unit as UnitKey, first.baseKey);
          const b = convert(chosen.size, chosen.unit, first.baseKey);
          if (a === null || b === null || !approxEqual(a, b)) {
            skip.push({ name: first.name, why: "heeft al een ander gewicht per stuk" });
            continue;
          }
        }
        // alle open rijen moeten omrekenbaar zijn naar stuks
        const bridge: KeyBridge = { quantity: chosen.size, unit: chosen.unit };
        const allConvertible = group.every((g) => convert(g.count, first.baseKey, "stuk", bridge) !== null);
        if (!allConvertible) {
          skip.push({ name: first.name, why: "andere leveranciersprijs niet omrekenbaar" });
          continue;
        }
        const before = pricesFromCount(chosen.price, group[0].count, first.baseKey, first.bridge ?? null);
        const after = pricesFromCount(chosen.price, chosen.packs, "stuk", bridge);
        const diag = diagnosePackaging({
          name: first.name,
          baseUnit: first.baseKey,
          bridge: first.bridge,
          description: chosen.description,
          count: group[0].count,
          price: chosen.price,
        });
        list.push({
          productId,
          productName: first.name,
          baseKey: first.baseKey,
          description: chosen.description,
          packs: chosen.packs,
          size: chosen.size,
          sizeUnit: chosen.unit,
          price: chosen.price,
          supplierNames: [...new Set(group.map((g) => g.supplier))],
          before: pricesText(before) === "—" && before.perBase !== null ? `${euro(before.perBase)} / ${first.baseKey}` : `${euro(before.perBase)} / ${first.baseKey}`,
          after: pricesText(after),
          warning: diag.status === "rood" ? diag.reason : null,
        });
      }
      list.sort((a, b) => a.productName.localeCompare(b.productName, "nl"));
      if (cancelled) return;
      setRows(list);
      setSkipped(skip);
      setSelected(new Set(list.filter((c) => !c.warning).map((c) => c.productId)));
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const visible = useMemo(() => {
    const t = search.trim().toLowerCase();
    return t ? rows.filter((r) => r.productName.toLowerCase().includes(t)) : rows;
  }, [rows, search]);
  const chosenRows = rows.filter((r) => selected.has(r.productId));

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function apply() {
    setApplying(true);
    setError(null);
    const supabase = createClient();
    const batchId = crypto.randomUUID();
    let ok = 0;
    const failures: string[] = [];
    for (const c of chosenRows) {
      try {
        const bridge: KeyBridge = { quantity: c.size, unit: c.sizeUnit };
        const { data: all, error: e } = await supabase
          .from("supplier_products")
          .select("id, supplier_id, packaging_unit_count, packaging_description, price_per_base_unit, purchase_price")
          .eq("product_id", c.productId);
        if (e) throw new Error(e.message);
        const updates = (all ?? []).map((r) => ({
          row: r,
          count: convert(Number(r.packaging_unit_count), c.baseKey, "stuk", bridge),
        }));
        if (updates.some((u) => u.count === null)) throw new Error("niet omrekenbaar");

        const { data: prodBefore } = await supabase
          .from("products")
          .select("base_unit_id, avg_unit_quantity, avg_unit_id")
          .eq("id", c.productId)
          .single();
        const { error: pe } = await supabase
          .from("products")
          .update({ base_unit_id: unitIds.stuk, avg_unit_quantity: c.size, avg_unit_id: unitIds[c.sizeUnit] })
          .eq("id", c.productId);
        if (pe) throw new Error(pe.message);

        const done: typeof updates = [];
        try {
          for (const u of updates) {
            const newCount = u.count as number;
            const newPer = Number(u.row.purchase_price) > 0 ? Number(u.row.purchase_price) / newCount : null;
            const { error: le } = await supabase.from("packaging_corrections").insert({
              batch_id: batchId,
              product_id: c.productId,
              supplier_product_id: u.row.id,
              supplier_id: u.row.supplier_id,
              kind: "technisch",
              old_packaging_unit_count: u.row.packaging_unit_count,
              new_packaging_unit_count: newCount,
              old_packaging_description: u.row.packaging_description,
              new_packaging_description: u.row.packaging_description,
              old_price_per_base_unit: u.row.price_per_base_unit,
              new_price_per_base_unit: newPer,
              reason: `Omgezet naar stuks: ${c.packs} × ${fmt(c.size, 4)} ${c.sizeUnit}`,
            });
            if (le) throw new Error("logboek: " + le.message);
            const { error: ue } = await supabase
              .from("supplier_products")
              .update({ packaging_unit_count: newCount, flagged_for_review: false })
              .eq("id", u.row.id);
            if (ue) throw new Error(ue.message);
            done.push(u);
          }
        } catch (inner) {
          // terugdraaien
          for (const u of done) {
            await supabase
              .from("supplier_products")
              .update({ packaging_unit_count: u.row.packaging_unit_count })
              .eq("id", u.row.id);
          }
          if (prodBefore) await supabase.from("products").update(prodBefore).eq("id", c.productId);
          throw inner;
        }
        ok++;
      } catch (err) {
        failures.push(`${c.productName}: ${(err as Error).message}`);
      }
    }
    setApplying(false);
    setConfirmOpen(false);
    setMessage(
      `${ok} product(en) omgezet naar stuks. Inkoopprijzen en verkoopprijzen zijn niet gewijzigd.` +
        (failures.length ? ` Mislukt: ${failures.join("; ")}` : "")
    );
    setReload((n) => n + 1);
  }

  return (
    <>
      <Topbar title="Alles naar stuks" />
      <div className="space-y-4 p-4 sm:p-6">
        <p className="text-sm text-muted">
          Deze producten rekenen nu in gram of ml, terwijl de verpakking uit meerdere stuks bestaat (bijv. 45 × 110 g).
          Na omzetten reken je in stuks; gram/ml in recepten blijft werken via het gewicht per stuk. Er verandert niets
          aan inkoop- of verkoopprijzen. Niets gebeurt voordat je bevestigt.{" "}
          <Link href="/producten" className="text-teal-700 underline">
            Terug naar producten
          </Link>
        </p>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
        {loading ? (
          <p className="text-sm text-muted">Bezig met scannen…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <input
                className="input w-64"
                placeholder="Zoek product…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button size="sm" variant="secondary" onClick={() => setSelected(new Set(rows.filter((r) => !r.warning).map((r) => r.productId)))}>
                Alles selecteren
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>
                Niets selecteren
              </Button>
              <Button size="sm" disabled={chosenRows.length === 0} onClick={() => setConfirmOpen(true)}>
                Omzetten ({chosenRows.length} van {rows.length})
              </Button>
            </div>
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="p-2" />
                      <th className="p-2">Product</th>
                      <th className="p-2">Verpakking</th>
                      <th className="p-2">Nu</th>
                      <th className="p-2">Straks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.productId} className="border-t border-border align-top">
                        <td className="p-2">
                          <input type="checkbox" checked={selected.has(r.productId)} onChange={() => toggle(r.productId)} />
                        </td>
                        <td className="p-2">
                          {r.productName}
                          {r.warning && <div className="text-xs text-amber-700">Let op: {r.warning}</div>}
                        </td>
                        <td className="p-2">{r.description}</td>
                        <td className="p-2">{r.before}</td>
                        <td className="p-2">
                          {r.packs} stuks van {fmt(r.size, 4)} {r.sizeUnit} → {r.after}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            {skipped.length > 0 && (
              <details className="text-sm text-muted">
                <summary>{skipped.length} product(en) overgeslagen (handmatig via Verpakking aanpassen)</summary>
                <ul className="mt-2 list-disc pl-5">
                  {skipped.map((s, i) => (
                    <li key={i}>
                      {s.name} — {s.why}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
      {confirmOpen && (
        <Modal onClose={() => !applying && setConfirmOpen(false)} title="Omzetten naar stuks?">
          <div className="space-y-3 text-sm">
            <p>
              {chosenRows.length} product(en) worden omgezet naar stuks met gewicht/inhoud per stuk. Inkoopprijzen,
              verkoopprijzen en prijshistorie blijven ongewijzigd; de wijziging komt in het correctielogboek.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={applying} onClick={() => setConfirmOpen(false)}>
                Annuleren
              </Button>
              <Button disabled={applying} onClick={apply}>
                {applying ? "Bezig…" : "Ja, omzetten"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

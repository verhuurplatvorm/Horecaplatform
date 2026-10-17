"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";
import { fmt, pricesFromCount, sizePerPieceFromName } from "@/lib/packaging";

/**
 * Maten koppelen: producten die in stuks worden ingekocht, nog geen
 * "1 stuk = x gram/ml" kennen, maar waarvan de naam de inhoud noemt
 * ("1 litre", "6x1 ltr", "2,5 kg"). Eerst voorbeeld, pas na bevestiging
 * toepassen. Alleen het gewicht/de inhoud per stuk wordt toegevoegd:
 * inkoop- en verkoopprijzen en de verpakking blijven ongewijzigd.
 */

interface Candidate {
  productId: string;
  name: string;
  baseKey: "ml" | "g";
  perPiece: number;
  matchedText: string;
  description: string;
  count: number | null;
  price: number | null;
  after: string;
  warning: string | null;
}

const PAGE_SIZE = 1000;

// Servies, verpakking en materiaal: de maat in de naam is de capaciteit
// (bijv. "beker 250ml"), geen ingrediënt. Die vinken we niet automatisch aan.
const NON_FOOD =
  /\b(kom|pan|pot)\b|beker|bak\b|bakken|glas|glazen|karaf|dispen[cs]er|koelkast|emmer|cupje|tipje|deksel|foodbucket|gasbus|whip|kannetje|melkkan|steelpan|mosselpan|sauspannetje|beslagkom|inmaakpot|weckpot|klempot/i;
const euro = (n: number | null) => (n === null ? "—" : `€ ${fmt(n, 4)}`);

export default function MatenKoppelenPage() {
  const [rows, setRows] = useState<Candidate[]>([]);
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
      const ids: Record<string, string> = {};
      for (const u of unitsData) ids[u.key as string] = u.id as string;
      setUnitIds(ids);

      // Alle actieve producten in stuks zonder gewicht/inhoud per stuk.
      const products: { id: string; name: string }[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error: e } = await supabase
          .from("products")
          .select("id, name")
          .eq("base_unit_id", ids.stuk)
          .is("avg_unit_quantity", null)
          .eq("is_active", true)
          .order("id")
          .range(from, from + PAGE_SIZE - 1);
        if (e) {
          if (!cancelled) {
            setError("Kan producten niet ophalen: " + e.message);
            setLoading(false);
          }
          return;
        }
        products.push(...((data ?? []) as { id: string; name: string }[]));
        if ((data?.length ?? 0) < PAGE_SIZE) break;
      }

      const withSize = products
        .map((p) => ({ p, size: sizePerPieceFromName(p.name) }))
        .filter((x) => x.size !== null);

      // Huidige verpakking per product, om aantal stuks en prijs te tonen/controleren.
      const packagingByProduct = new Map<string, { description: string; count: number; price: number }[]>();
      const idList = withSize.map((x) => x.p.id);
      for (let i = 0; i < idList.length; i += 150) {
        const { data, error: e } = await supabase
          .from("supplier_products")
          .select("product_id, packaging_description, packaging_unit_count, purchase_price")
          .in("product_id", idList.slice(i, i + 150))
          .is("valid_to", null);
        if (e) {
          if (!cancelled) {
            setError("Kan verpakkingen niet ophalen: " + e.message);
            setLoading(false);
          }
          return;
        }
        for (const r of data ?? []) {
          const arr = packagingByProduct.get(r.product_id as string) ?? [];
          arr.push({
            description: (r.packaging_description as string | null) ?? "",
            count: Number(r.packaging_unit_count),
            price: Number(r.purchase_price),
          });
          packagingByProduct.set(r.product_id as string, arr);
        }
      }

      const list: Candidate[] = [];
      for (const { p, size } of withSize) {
        if (!size) continue;
        const pack = packagingByProduct.get(p.id)?.[0] ?? null;
        const bridge = { quantity: size.perPiece, unit: size.baseKey } as const;
        const after = pack
          ? pricesFromCount(pack.price, pack.count, "stuk", bridge)
          : null;
        const afterText = after
          ? [
              after.perPiece !== null ? `${euro(after.perPiece)} / stuk` : null,
              after.perKg !== null ? `${euro(after.perKg)} / kg` : null,
              after.perLiter !== null ? `${euro(after.perLiter)} / l` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : "—";
        let warning: string | null = null;
        if (NON_FOOD.test(p.name)) warning = "lijkt servies, verpakking of materiaal (de maat is de capaciteit, geen ingrediënt)";
        else if (size.ambiguous) warning = "er staan meerdere verschillende maten in de naam";
        else if (size.packsInName !== null && pack && Math.abs(size.packsInName - pack.count) > 1e-9)
          warning = `naam noemt ${fmt(size.packsInName)} stuks, verpakking heeft ${fmt(pack.count)}`;
        else if (!pack) warning = "geen actieve verpakking/prijs gevonden";
        list.push({
          productId: p.id,
          name: p.name,
          baseKey: size.baseKey,
          perPiece: size.perPiece,
          matchedText: size.matchedText,
          description: pack?.description ?? "",
          count: pack?.count ?? null,
          price: pack?.price ?? null,
          after: afterText,
          warning,
        });
      }
      list.sort((a, b) => a.name.localeCompare(b.name, "nl"));
      if (cancelled) return;
      setRows(list);
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
    return t ? rows.filter((r) => r.name.toLowerCase().includes(t)) : rows;
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
    let ok = 0;
    const failures: string[] = [];
    for (const c of chosenRows) {
      const { error: e } = await supabase
        .from("products")
        .update({ avg_unit_quantity: c.perPiece, avg_unit_id: unitIds[c.baseKey] })
        .eq("id", c.productId)
        .is("avg_unit_quantity", null);
      if (e) failures.push(`${c.name}: ${e.message}`);
      else ok++;
    }
    setApplying(false);
    setConfirmOpen(false);
    setMessage(
      `${ok} product(en) gekoppeld aan een inhoud/gewicht per stuk. Prijzen zijn niet gewijzigd.` +
        (failures.length ? ` Mislukt: ${failures.join("; ")}` : "")
    );
    setReload((n) => n + 1);
  }

  return (
    <>
      <Topbar title="Maten koppelen" />
      <div className="space-y-4 p-4 sm:p-6">
        <p className="text-sm text-muted">
          Deze producten worden in stuks ingekocht en de naam noemt de inhoud of het gewicht (bijv. &quot;1 litre&quot;).
          Na koppelen kun je ze in recepten ook in liter, ml, kilo of gram gebruiken en zie je een literprijs of
          kiloprijs. Er verandert niets aan inkoop- of verkoopprijzen. Niets gebeurt voordat je bevestigt.{" "}
          <Link href="/producten" className="text-teal-700 underline">
            Terug naar producten
          </Link>
        </p>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
        {loading ? (
          <p className="text-sm text-muted">Bezig met scannen…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">Geen producten gevonden die nog een maat nodig hebben.</p>
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
                Alles zonder waarschuwing selecteren
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>
                Niets selecteren
              </Button>
              <Button size="sm" disabled={chosenRows.length === 0} onClick={() => setConfirmOpen(true)}>
                Koppelen ({chosenRows.length} van {rows.length})
              </Button>
            </div>
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="p-2" />
                      <th className="p-2">Product</th>
                      <th className="p-2">Verpakking nu</th>
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
                          {r.name}
                          {r.warning && <div className="text-xs text-amber-700">Let op: {r.warning}</div>}
                        </td>
                        <td className="p-2">
                          {r.description || "—"}
                          {r.count !== null && <div className="text-xs text-muted">{fmt(r.count)} stuks · {euro(r.price)}</div>}
                        </td>
                        <td className="p-2">
                          1 stuk = {fmt(r.perPiece, 4)} {r.baseKey} <span className="text-xs text-muted">(uit &quot;{r.matchedText}&quot;)</span>
                          <div className="text-xs text-muted">{r.after}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
      {confirmOpen && (
        <Modal onClose={() => !applying && setConfirmOpen(false)} title="Maten koppelen?">
          <div className="space-y-3 text-sm">
            <p>
              {chosenRows.length} product(en) krijgen een inhoud of gewicht per stuk. Inkoopprijzen, verkoopprijzen en
              verpakkingen blijven ongewijzigd.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={applying} onClick={() => setConfirmOpen(false)}>
                Annuleren
              </Button>
              <Button disabled={applying} onClick={apply}>
                {applying ? "Bezig…" : "Ja, koppelen"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

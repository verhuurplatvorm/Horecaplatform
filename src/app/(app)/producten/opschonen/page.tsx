"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { parsePackagingText, UNIT_TO_BASE_FACTOR } from "@/lib/price-import/packaging-parser";
import type { Product, SupplierProduct, Unit } from "@/lib/types/database";

interface SupplierPriceRow extends SupplierProduct {
  supplierName: string;
}

interface Candidate {
  product: Product;
  suggestedUnitKey: string;
  suggestedTotalInSmallestUnit: number;
  explanation: string;
  prices: SupplierPriceRow[];
}

export default function ProductenOpschonenPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();

      const { data: unitsData } = await supabase.from("units").select("*");
      const allUnits = (unitsData as Unit[]) ?? [];
      if (cancelled) return;
      setUnits(allUnits);

      const stukUnit = allUnits.find((u) => u.key === "stuk");
      if (!stukUnit) {
        setLoading(false);
        return;
      }

      const { data: products } = await supabase
        .from("products")
        .select("*")
        .eq("base_unit_id", stukUnit.id)
        .eq("is_active", true);
      if (cancelled || !products) {
        setLoading(false);
        return;
      }

      const found: Candidate[] = [];
      for (const product of products as Product[]) {
        const parsed = parsePackagingText(product.name);
        if (!parsed || parsed.unit === "stuk") continue;
        const baseUnit = UNIT_TO_BASE_FACTOR[parsed.unit];
        if (!baseUnit) continue;

        found.push({
          product,
          suggestedUnitKey: baseUnit.baseUnitKey,
          suggestedTotalInSmallestUnit: parsed.totalQuantity * baseUnit.factor,
          explanation: parsed.explanation,
          prices: [],
        });
      }

      if (found.length > 0) {
        const productIds = found.map((c) => c.product.id);
        const { data: prices } = await supabase
          .from("supplier_products")
          .select("*, suppliers(name)")
          .in("product_id", productIds)
          .is("valid_to", null);

        const pricesByProduct = new Map<string, SupplierPriceRow[]>();
        for (const p of prices ?? []) {
          const list = pricesByProduct.get(p.product_id) ?? [];
          // @ts-expect-error -- geneste relatie, niet in het handmatige Database-type
          list.push({ ...p, supplierName: p.suppliers?.name ?? "onbekend" });
          pricesByProduct.set(p.product_id, list);
        }
        for (const c of found) {
          c.prices = pricesByProduct.get(c.product.id) ?? [];
        }
      }

      if (!cancelled) {
        setCandidates(found);
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function reload() {
    setLoading(true);
    setCandidates([]);
    setReloadToken((t) => t + 1);
  }

  return (
    <>
      <Topbar title="Producten opschonen" />
      <main className="max-w-4xl space-y-4 p-6">
        <p className="text-sm text-muted">
          Producten waarvan de basiseenheid &quot;stuk&quot; is, terwijl de naam een gewicht of
          inhoud noemt (bv. &quot;... 2 KG&quot;) — vaak het gevolg van een eerdere onjuiste
          automatische herkenning. Corrigeer hier in één keer de basiseenheid én de bijbehorende
          leveranciersprijs.
        </p>

        {loading && <p className="text-sm text-muted">Bezig met zoeken…</p>}

        {!loading && candidates.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted">
              Geen verdachte producten gevonden.
            </CardContent>
          </Card>
        )}

        {candidates.map((c) => (
          <CandidateCard key={c.product.id} candidate={c} units={units} onFixed={reload} />
        ))}
      </main>
    </>
  );
}

function CandidateCard({
  candidate,
  units,
  onFixed,
}: {
  candidate: Candidate;
  units: Unit[];
  onFixed: () => void;
}) {
  const { product, suggestedUnitKey, suggestedTotalInSmallestUnit, explanation, prices } =
    candidate;
  const suggestedUnit = units.find((u) => u.key === suggestedUnitKey);

  const [priceOverrides, setPriceOverrides] = useState<Record<string, string>>(() =>
    Object.fromEntries(prices.map((p) => [p.id, suggestedTotalInSmallestUnit.toString()]))
  );
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFix() {
    if (!suggestedUnit) {
      setError("Kan de voorgestelde eenheid niet vinden in de eenhedenlijst.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();

    const { error: productError } = await supabase
      .from("products")
      .update({ base_unit_id: suggestedUnit.id })
      .eq("id", product.id);
    if (productError) {
      setError("Kan basiseenheid niet bijwerken: " + productError.message);
      setSaving(false);
      return;
    }

    for (const price of prices) {
      const newCount = Number(priceOverrides[price.id]);
      if (!Number.isFinite(newCount) || newCount <= 0) continue;
      await supabase
        .from("supplier_products")
        .update({ packaging_unit_count: newCount })
        .eq("id", price.id);
    }

    setSaving(false);
    setDone(true);
    setTimeout(onFixed, 800);
  }

  if (done) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-success">
          &quot;{product.name}&quot; gecorrigeerd.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 text-copper" />
          {product.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">
          Herkend: <span className="font-medium text-foreground">{explanation}</span> — huidige
          basiseenheid <span className="font-medium text-foreground">stuk</span>, voorgesteld:{" "}
          <span className="font-medium text-foreground">{suggestedUnit?.name ?? suggestedUnitKey}</span>
        </p>

        {prices.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 font-medium">Leverancier</th>
                <th className="py-2 font-medium">Huidige verpakking</th>
                <th className="py-2 font-medium">Prijs</th>
                <th className="py-2 font-medium">
                  Nieuwe inhoud (in {suggestedUnit?.name ?? suggestedUnitKey})
                </th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-2">{p.supplierName}</td>
                  <td className="py-2 text-muted">
                    {p.packaging_description ?? "—"} ({p.packaging_unit_count})
                  </td>
                  <td className="py-2 tabular">€ {p.purchase_price.toFixed(2)}</td>
                  <td className="py-2">
                    <input
                      type="number"
                      step="any"
                      value={priceOverrides[p.id] ?? ""}
                      onChange={(e) =>
                        setPriceOverrides((prev) => ({ ...prev, [p.id]: e.target.value }))
                      }
                      className="h-8 w-32 rounded border border-border bg-surface px-2 text-sm"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button onClick={handleFix} disabled={saving}>
          {saving ? "Bezig…" : "Basiseenheid + prijs herstellen"}
        </Button>
      </CardContent>
    </Card>
  );
}

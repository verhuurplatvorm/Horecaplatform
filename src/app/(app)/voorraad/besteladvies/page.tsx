"use client";

import { useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import type { CurrentStock } from "@/lib/types/database";

interface AdviceLine {
  productId: string;
  name: string;
  unitName: string;
  onHand: number;
  minStock: number;
  reorderQuantity: number | null;
  suggestedQuantity: number;
  supplierName: string;
  pricePerBaseUnit: number | null;
}

export default function BesteladviesPage() {
  const { activeCompanyIds, scope, companies, loading: scopeLoading } =
    useCompanyScope();
  const [lines, setLines] = useState<AdviceLine[]>([]);
  const [loading, setLoading] = useState(true);

  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const referenceCompanyName = companies.find(
    (c) => c.id === referenceCompanyId
  )?.name;

  useEffect(() => {
    if (scopeLoading || !referenceCompanyId) return;
    let cancelled = false;

    async function run() {
      const supabase = createClient();

      const { data: products } = await supabase
        .from("products")
        .select(
          "id, name, base_unit_id, min_stock_quantity, reorder_quantity, preferred_supplier_id"
        )
        .not("min_stock_quantity", "is", null);
      if (cancelled || !products || products.length === 0) {
        setLoading(false);
        return;
      }

      const productIds = products.map((p) => p.id);

      const [{ data: stock }, { data: units }, { data: prices }, { data: suppliers }] =
        await Promise.all([
          supabase
            .from("current_stock")
            .select("*")
            .eq("company_id", referenceCompanyId)
            .in("product_id", productIds),
          supabase.from("units").select("id, name"),
          supabase
            .from("current_product_cost")
            .select("product_id, price_per_base_unit")
            .eq("company_id", referenceCompanyId)
            .in("product_id", productIds),
          supabase.from("suppliers").select("id, name"),
        ]);
      if (cancelled) return;

      const stockByProduct = new Map(
        ((stock as CurrentStock[]) ?? []).map((s) => [s.product_id, s.on_hand_quantity])
      );
      const unitNameById = new Map((units ?? []).map((u) => [u.id, u.name]));
      const priceByProduct = new Map(
        (prices ?? []).map((p) => [p.product_id, p.price_per_base_unit])
      );
      const supplierNameById = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

      const result: AdviceLine[] = [];
      for (const p of products) {
        const onHand = stockByProduct.get(p.id) ?? 0;
        const minStock = p.min_stock_quantity!;
        if (onHand >= minStock) continue;

        const shortfall = minStock - onHand;
        const suggested =
          p.reorder_quantity && p.reorder_quantity > shortfall
            ? p.reorder_quantity
            : shortfall;

        result.push({
          productId: p.id,
          name: p.name,
          unitName: p.base_unit_id ? unitNameById.get(p.base_unit_id) ?? "" : "",
          onHand,
          minStock,
          reorderQuantity: p.reorder_quantity,
          suggestedQuantity: suggested,
          supplierName: p.preferred_supplier_id
            ? supplierNameById.get(p.preferred_supplier_id) ?? "onbekende leverancier"
            : "geen voorkeursleverancier",
          pricePerBaseUnit: priceByProduct.get(p.id) ?? null,
        });
      }

      result.sort((a, b) => a.supplierName.localeCompare(b.supplierName));
      setLines(result);
      setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [referenceCompanyId, scopeLoading]);

  const grouped = useMemo(() => {
    const groups = new Map<string, AdviceLine[]>();
    for (const line of lines) {
      const list = groups.get(line.supplierName) ?? [];
      list.push(line);
      groups.set(line.supplierName, list);
    }
    return groups;
  }, [lines]);

  return (
    <>
      <Topbar title="Besteladvies" />
      <main className="p-6 space-y-4">
        {!referenceCompanyId ? (
          <p className="text-sm text-muted">
            Selecteer een bedrijf via de bedrijfsselector rechtsboven om
            besteladvies te zien.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              Op basis van actuele voorraad versus minimale voorraad voor{" "}
              {scope.mode === "group"
                ? `${referenceCompanyName} (eerste bedrijf in groepsweergave)`
                : referenceCompanyName}
              . Dit is een advies — er wordt niets automatisch besteld.
            </p>

            {!loading && lines.length === 0 && (
              <Card>
                <CardContent className="py-6 text-center text-sm text-muted">
                  Alles zit boven de minimale voorraad, of er is nog geen
                  minimale voorraad ingesteld bij ingrediënten.
                </CardContent>
              </Card>
            )}

            {[...grouped.entries()].map(([supplierName, supplierLines]) => (
              <Card key={supplierName}>
                <CardContent className="p-0">
                  <div className="border-b border-border px-5 py-3">
                    <p className="text-sm font-medium text-foreground">
                      {supplierName}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
<table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted">
                        <th className="px-5 py-3 font-medium">Artikel</th>
                        <th className="px-5 py-3 font-medium">Actuele voorraad</th>
                        <th className="px-5 py-3 font-medium">Minimaal</th>
                        <th className="px-5 py-3 font-medium">Besteladvies</th>
                        <th className="px-5 py-3 font-medium">Geschatte kosten</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplierLines.map((line) => (
                        <tr key={line.productId} className="border-t border-border">
                          <td className="px-5 py-3 font-medium">
                            <span className="flex items-center gap-1.5">
                              <TriangleAlert className="h-3.5 w-3.5 text-copper" />
                              {line.name}
                            </span>
                          </td>
                          <td className="px-5 py-3 tabular text-muted">
                            {line.onHand.toLocaleString("nl-NL", {
                              maximumFractionDigits: 2,
                            })}{" "}
                            {line.unitName}
                          </td>
                          <td className="px-5 py-3 tabular text-muted">
                            {line.minStock} {line.unitName}
                          </td>
                          <td className="px-5 py-3 tabular font-medium text-foreground">
                            {line.suggestedQuantity.toLocaleString("nl-NL", {
                              maximumFractionDigits: 2,
                            })}{" "}
                            {line.unitName}
                          </td>
                          <td className="px-5 py-3 tabular text-muted">
                            {line.pricePerBaseUnit !== null
                              ? `€ ${(line.pricePerBaseUnit * line.suggestedQuantity).toFixed(2)}`
                              : "onbekend"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
</div>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </main>
    </>
  );
}

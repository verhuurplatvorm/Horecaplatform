"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Package, Plus, SoupIcon, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { CurrentStock } from "@/lib/types/database";

interface StockRow {
  key: string;
  type: "product" | "halfproduct";
  id: string;
  name: string;
  unitName: string | null;
  onHand: number;
  minStock: number | null;
}

export default function VoorraadPage() {
  const { activeCompanyIds, scope, companies, loading: scopeLoading } =
    useCompanyScope();
  const [rows, setRows] = useState<StockRow[]>([]);
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
      const { data: stock } = await supabase
        .from("current_stock")
        .select("*")
        .eq("company_id", referenceCompanyId);
      if (cancelled || !stock) {
        setLoading(false);
        return;
      }

      const productIds = (stock as CurrentStock[])
        .map((s) => s.product_id)
        .filter(Boolean) as string[];
      const recipeIds = (stock as CurrentStock[])
        .map((s) => s.recipe_id)
        .filter(Boolean) as string[];

      const [{ data: products }, { data: recipes }, { data: units }] =
        await Promise.all([
          productIds.length
            ? supabase
                .from("products")
                .select("id, name, base_unit_id, min_stock_quantity")
                .in("id", productIds)
            : Promise.resolve({ data: [] }),
          recipeIds.length
            ? supabase
                .from("recipes")
                .select("id, name, base_unit_id")
                .in("id", recipeIds)
            : Promise.resolve({ data: [] }),
          supabase.from("units").select("id, name"),
        ]);
      if (cancelled) return;

      const unitNameById = new Map((units ?? []).map((u) => [u.id, u.name]));
      const productMap = new Map((products ?? []).map((p) => [p.id, p]));
      const recipeMap = new Map((recipes ?? []).map((r) => [r.id, r]));

      const result: StockRow[] = (stock as CurrentStock[]).map((s) => {
        if (s.product_id) {
          const p = productMap.get(s.product_id);
          return {
            key: `product-${s.product_id}`,
            type: "product" as const,
            id: s.product_id,
            name: p?.name ?? s.product_id,
            unitName: p?.base_unit_id ? unitNameById.get(p.base_unit_id) ?? null : null,
            onHand: s.on_hand_quantity,
            minStock: p?.min_stock_quantity ?? null,
          };
        }
        const r = recipeMap.get(s.recipe_id!);
        return {
          key: `halfproduct-${s.recipe_id}`,
          type: "halfproduct" as const,
          id: s.recipe_id!,
          name: r?.name ?? s.recipe_id!,
          unitName: r?.base_unit_id ? unitNameById.get(r.base_unit_id) ?? null : null,
          onHand: s.on_hand_quantity,
          minStock: null,
        };
      });

      result.sort((a, b) => a.name.localeCompare(b.name));
      setRows(result);
      setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [referenceCompanyId, scopeLoading]);

  const belowMinCount = useMemo(
    () => rows.filter((r) => r.minStock !== null && r.onHand < r.minStock).length,
    [rows]
  );

  return (
    <>
      <Topbar title="Voorraad" />
      <main className="p-6 space-y-4">
        {!referenceCompanyId ? (
          <p className="text-sm text-muted">
            Selecteer een bedrijf via de bedrijfsselector rechtsboven om de
            voorraad te zien.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">
                Voorraad voor{" "}
                {scope.mode === "group"
                  ? `${referenceCompanyName} (eerste bedrijf in groepsweergave)`
                  : referenceCompanyName}
                . {belowMinCount > 0 && (
                  <span className="text-copper">
                    {belowMinCount} artikel(en) onder minimale voorraad.
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <Link href="/voorraad/mutatie/nieuw">
                  <Button variant="secondary">
                    <Plus className="h-4 w-4" />
                    Mutatie registreren
                  </Button>
                </Link>
                <Link href="/voorraad/productie/nieuw">
                  <Button>
                    <Plus className="h-4 w-4" />
                    Productie registreren
                  </Button>
                </Link>
              </div>
            </div>

            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-5 py-3 font-medium">Artikel</th>
                      <th className="px-5 py-3 font-medium">Type</th>
                      <th className="px-5 py-3 font-medium">Actuele voorraad</th>
                      <th className="px-5 py-3 font-medium">Minimale voorraad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const belowMin =
                        r.minStock !== null && r.onHand < r.minStock;
                      return (
                        <tr key={r.key} className="border-t border-border">
                          <td className="px-5 py-3 font-medium">{r.name}</td>
                          <td className="px-5 py-3">
                            <span
                              className={cn(
                                "flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                                r.type === "product"
                                  ? "bg-teal/10 text-teal"
                                  : "bg-copper/10 text-copper"
                              )}
                            >
                              {r.type === "product" ? (
                                <Package className="h-3 w-3" />
                              ) : (
                                <SoupIcon className="h-3 w-3" />
                              )}
                              {r.type === "product" ? "Product" : "Halfproduct"}
                            </span>
                          </td>
                          <td
                            className={cn(
                              "tabular px-5 py-3",
                              belowMin ? "font-medium text-copper" : "text-foreground"
                            )}
                          >
                            {belowMin && (
                              <TriangleAlert className="mr-1 inline h-3.5 w-3.5" />
                            )}
                            {r.onHand.toLocaleString("nl-NL", {
                              maximumFractionDigits: 2,
                            })}{" "}
                            {r.unitName ?? ""}
                          </td>
                          <td className="px-5 py-3 tabular text-muted">
                            {r.minStock !== null
                              ? `${r.minStock} ${r.unitName ?? ""}`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && !loading && (
                      <tr>
                        <td colSpan={4} className="px-5 py-6 text-center text-muted">
                          Nog geen voorraadmutaties voor dit bedrijf.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </>
  );
}

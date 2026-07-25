"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const FOODCOST_WARNING_THRESHOLD = 33; // %

interface SalesProductRow {
  id: string;
  name: string;
  category: string | null;
  sales_price_incl_vat: number;
  vat_rate: number;
  is_active: boolean;
  auto_generated_from_recipe_id: string | null;
  company_id: string;
  companyName: string;
  costPrice: number | null;
  hasComponents: boolean;
}

export default function VerkoopproductenPage() {
  const [rows, setRows] = useState<SalesProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const { data: salesProducts, error: fetchError } = await supabase
        .from("sales_products")
        .select(
          "id, name, category, sales_price_incl_vat, vat_rate, is_active, auto_generated_from_recipe_id, company_id, companies(name)"
        )
        .order("name")
        .limit(100);

      if (cancelled) return;
      if (fetchError || !salesProducts) {
        setError(true);
        setLoading(false);
        return;
      }

      const { data: components } = await supabase
        .from("sales_product_components")
        .select("sales_product_id");
      const componentCounts = new Map<string, number>();
      for (const c of components ?? []) {
        componentCounts.set(
          c.sales_product_id,
          (componentCounts.get(c.sales_product_id) ?? 0) + 1
        );
      }

      const withCost = await Promise.all(
        salesProducts.map(async (sp) => {
          const { data: cost } = await supabase.rpc("calculate_sales_product_cost", {
            p_sales_product_id: sp.id,
            p_company_id: sp.company_id,
          });
          return {
            id: sp.id,
            name: sp.name,
            category: sp.category,
            sales_price_incl_vat: sp.sales_price_incl_vat,
            vat_rate: sp.vat_rate,
            is_active: sp.is_active,
            auto_generated_from_recipe_id: sp.auto_generated_from_recipe_id,
            company_id: sp.company_id,
            // @ts-expect-error -- geneste relatie, niet in het handmatige Database-type
            companyName: sp.companies?.name ?? "—",
            costPrice: cost ?? null,
            hasComponents: (componentCounts.get(sp.id) ?? 0) > 0,
          };
        })
      );

      if (!cancelled) {
        setRows(withCost);
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Topbar title="Verkoopproducten" />
      <main className="p-6 space-y-4">
        <p className="text-sm text-muted max-w-2xl">
          Een gerecht met een verkoopprijs en een bedrijf krijgt hier
          automatisch een regel — daar hoef je zelf niets voor te doen. Maak
          hier alleen handmatig iets aan voor uitzonderingen: een gebundeld
          menu van meerdere recepten, of een andere portiegrootte met een
          eigen prijs.
        </p>

        <div className="flex justify-end">
          <Link href="/verkoopproducten/nieuw">
            <Button>
              <Plus className="h-4 w-4" />
              Nieuw verkoopproduct
            </Button>
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Verkoopnaam</th>
                  <th className="px-5 py-3 font-medium">Bron</th>
                  <th className="px-5 py-3 font-medium">Bedrijf</th>
                  <th className="px-5 py-3 font-medium">Verkoopprijs</th>
                  <th className="px-5 py-3 font-medium">Kostprijs</th>
                  <th className="px-5 py-3 font-medium">Foodcost%</th>
                  <th className="px-5 py-3 font-medium">Marge</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((sp) => {
                  const editHref = sp.auto_generated_from_recipe_id
                    ? `/recepturen/${sp.auto_generated_from_recipe_id}/bewerken`
                    : `/verkoopproducten/${sp.id}/bewerken`;
                  const priceExclVat = sp.sales_price_incl_vat / (1 + sp.vat_rate / 100);
                  const foodCostPct =
                    sp.costPrice !== null && priceExclVat > 0
                      ? (sp.costPrice / priceExclVat) * 100
                      : null;
                  const marginEuro =
                    sp.costPrice !== null ? priceExclVat - sp.costPrice : null;
                  const warning =
                    !sp.hasComponents ||
                    sp.costPrice === null ||
                    (foodCostPct !== null && foodCostPct > FOODCOST_WARNING_THRESHOLD);

                  return (
                    <tr key={sp.id} className="border-t border-border hover:bg-background">
                      <td className="px-5 py-3 font-medium">
                        <Link href={editHref} className="hover:text-teal hover:underline">
                          <span className="flex items-center gap-1.5">
                            {warning && (
                              <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-copper" />
                            )}
                            {sp.name}
                          </span>
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        {sp.auto_generated_from_recipe_id ? (
                          <span className="rounded-full bg-teal/10 px-2 py-0.5 text-xs text-teal">
                            Automatisch
                          </span>
                        ) : (
                          <span className="rounded-full bg-copper/10 px-2 py-0.5 text-xs text-copper">
                            Handmatig
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted">{sp.companyName}</td>
                      <td className="px-5 py-3 tabular">
                        € {sp.sales_price_incl_vat.toFixed(2)}
                      </td>
                      <td className="px-5 py-3 tabular">
                        {loading
                          ? "…"
                          : sp.costPrice !== null
                          ? `€ ${sp.costPrice.toFixed(2)}`
                          : "onbekend"}
                      </td>
                      <td className="px-5 py-3 tabular">
                        {foodCostPct !== null ? (
                          <span
                            className={cn(
                              foodCostPct > FOODCOST_WARNING_THRESHOLD
                                ? "text-danger"
                                : "text-success"
                            )}
                          >
                            {foodCostPct.toFixed(1)}%
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-3 tabular">
                        {marginEuro !== null ? `€ ${marginEuro.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={
                            sp.is_active
                              ? "rounded-full bg-success/10 px-2 py-0.5 text-xs text-success"
                              : "rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted"
                          }
                        >
                          {sp.is_active ? "Actief" : "Inactief"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan verkoopproducten niet laden — controleer de Supabase-koppeling."
                        : "Nog geen verkoopproducten. Zet een verkoopprijs op een gerecht, of maak er hier handmatig een aan."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <p className="text-xs text-muted">
          <TriangleAlert className="mr-1 inline h-3.5 w-3.5 text-copper" />
          betekent: geen receptkoppeling, geen kostprijs bekend, of foodcost
          boven {FOODCOST_WARNING_THRESHOLD}%.
        </p>
      </main>
    </>
  );
}

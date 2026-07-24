import Link from "next/link";
import { Plus } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function ProductenPage() {
  const supabase = await createClient();
  const { data: products, error } = await supabase
    .from("products")
    .select("id, name, product_group, base_unit, article_number, is_active")
    .order("name")
    .limit(100);

  const productIds = (products ?? []).map((p) => p.id);

  // Actuele inkoopprijs per product: de rij(en) met valid_to = null zijn
  // per definitie de op dit moment geldende prijzen (spec §10).
  const { data: currentPrices } = productIds.length
    ? await supabase
        .from("supplier_products")
        .select(
          "product_id, company_id, purchase_price, packaging_unit_count, valid_from, suppliers(name)"
        )
        .in("product_id", productIds)
        .is("valid_to", null)
        .order("valid_from", { ascending: false })
    : { data: [] };

  const priceByProduct = new Map<
    string,
    { pricePerBaseUnit: number; supplierName: string; scope: string; validFrom: string }
  >();
  for (const row of currentPrices ?? []) {
    if (priceByProduct.has(row.product_id)) continue; // eerste (meest recente) telt
    const pricePerBaseUnit =
      row.packaging_unit_count && row.packaging_unit_count > 0
        ? row.purchase_price / row.packaging_unit_count
        : row.purchase_price;
    // @ts-expect-error -- suppliers komt als geneste relatie terug, niet in het handmatige Database-type
    const supplierName: string = row.suppliers?.name ?? "onbekende leverancier";
    priceByProduct.set(row.product_id, {
      pricePerBaseUnit,
      supplierName,
      scope: row.company_id ? "specifiek bedrijf" : "groepsbreed",
      validFrom: row.valid_from,
    });
  }

  return (
    <>
      <Topbar title="Centrale productdatabase" />
      <main className="p-6 space-y-4">
        <div className="flex justify-end">
          <Link href="/producten/nieuw">
            <Button>
              <Plus className="h-4 w-4" />
              Nieuw product
            </Button>
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Artikel</th>
                  <th className="px-5 py-3 font-medium">Productgroep</th>
                  <th className="px-5 py-3 font-medium">Eenheid</th>
                  <th className="px-5 py-3 font-medium">Actuele inkoopprijs</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {products?.map((p) => {
                  const price = priceByProduct.get(p.id);
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-border hover:bg-background"
                    >
                      <td className="px-5 py-3 font-medium">
                        <Link
                          href={`/producten/${p.id}/bewerken`}
                          className="hover:text-teal hover:underline"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-muted">
                        {p.product_group ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-muted">{p.base_unit}</td>
                      <td className="px-5 py-3 tabular">
                        {price ? (
                          <div>
                            <div className="text-foreground">
                              € {price.pricePerBaseUnit.toFixed(4)} / {p.base_unit}
                            </div>
                            <div className="text-xs text-muted">
                              {price.supplierName} · {price.scope} · sinds{" "}
                              {new Date(price.validFrom).toLocaleDateString("nl-NL")}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted">Geen prijs bekend</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={
                            p.is_active
                              ? "rounded-full bg-success/10 px-2 py-0.5 text-xs text-success"
                              : "rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted"
                          }
                        >
                          {p.is_active ? "Actief" : "Inactief"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {(!products || products.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan producten niet laden — controleer de Supabase-koppeling."
                        : "Nog geen producten in de centrale database. Voeg het eerste artikel toe."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

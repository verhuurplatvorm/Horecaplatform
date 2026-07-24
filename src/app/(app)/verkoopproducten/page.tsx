import Link from "next/link";
import { Plus } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function VerkoopproductenPage() {
  const supabase = await createClient();
  const { data: salesProducts, error } = await supabase
    .from("sales_products")
    .select(
      "id, name, category, sales_price_incl_vat, vat_rate, is_active, companies(name)"
    )
    .order("name")
    .limit(100);

  return (
    <>
      <Topbar title="Verkoopproducten" />
      <main className="p-6 space-y-4">
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
                  <th className="px-5 py-3 font-medium">Categorie</th>
                  <th className="px-5 py-3 font-medium">Bedrijf</th>
                  <th className="px-5 py-3 font-medium">Verkoopprijs</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {salesProducts?.map((sp) => (
                  <tr key={sp.id} className="border-t border-border hover:bg-background">
                    <td className="px-5 py-3 font-medium">
                      <Link
                        href={`/verkoopproducten/${sp.id}/bewerken`}
                        className="hover:text-teal hover:underline"
                      >
                        {sp.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted">{sp.category ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">
                      {/* @ts-expect-error -- geneste relatie, niet in het handmatige Database-type */}
                      {sp.companies?.name ?? "—"}
                    </td>
                    <td className="px-5 py-3 tabular">
                      € {sp.sales_price_incl_vat.toFixed(2)}
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
                ))}
                {(!salesProducts || salesProducts.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan verkoopproducten niet laden — controleer de Supabase-koppeling."
                        : "Nog geen verkoopproducten. Koppel een receptuur aan een verkoopprijs per bedrijf."}
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

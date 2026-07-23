import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function ProductenPage() {
  const supabase = await createClient();
  const { data: products, error } = await supabase
    .from("products")
    .select("id, name, product_group, base_unit, article_number, is_active")
    .order("name")
    .limit(100);

  return (
    <>
      <Topbar title="Centrale productdatabase" />
      <main className="p-6">
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Artikel</th>
                  <th className="px-5 py-3 font-medium">Productgroep</th>
                  <th className="px-5 py-3 font-medium">Eenheid</th>
                  <th className="px-5 py-3 font-medium">Artikelnummer</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {products?.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-5 py-3 font-medium">{p.name}</td>
                    <td className="px-5 py-3 text-muted">
                      {p.product_group ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-muted">{p.base_unit}</td>
                    <td className="px-5 py-3 text-muted">
                      {p.article_number ?? "—"}
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
                ))}
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

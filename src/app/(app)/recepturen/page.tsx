import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function RecepturenPage() {
  const supabase = await createClient();
  const { data: recipes, error } = await supabase
    .from("recipes")
    .select("id, name, category, status, is_central, company_id, sales_price")
    .order("name")
    .limit(100);

  return (
    <>
      <Topbar title="Recepturen" />
      <main className="p-6">
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Receptuur</th>
                  <th className="px-5 py-3 font-medium">Categorie</th>
                  <th className="px-5 py-3 font-medium">Bereik</th>
                  <th className="px-5 py-3 font-medium">Verkoopprijs</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recipes?.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-5 py-3 font-medium">{r.name}</td>
                    <td className="px-5 py-3 text-muted">{r.category ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">
                      {r.is_central ? "Centrale standaard" : "Lokale variant"}
                    </td>
                    <td className="px-5 py-3 tabular">
                      {r.sales_price ? `€ ${r.sales_price.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
                {(!recipes || recipes.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan recepturen niet laden — controleer de Supabase-koppeling."
                        : "Nog geen recepturen vastgelegd."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <p className="mt-3 text-xs text-muted">
          Kostprijzen worden live berekend uit de actuele inkoopprijzen via
          de databasefunctie <code>calculate_recipe_cost(recipe_id, company_id)</code>{" "}
          en verschijnen zodra een bedrijf is geselecteerd.
        </p>
      </main>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    goedgekeurd: "bg-success/10 text-success",
    concept: "bg-copper/10 text-copper",
    vervallen: "bg-muted/10 text-muted",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${styles[status] ?? styles.concept}`}>
      {status}
    </span>
  );
}

import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function LeveranciersPage() {
  const supabase = await createClient();
  const { data: suppliers, error } = await supabase
    .from("suppliers")
    .select("id, name, email, company_id, reliability_score, is_active")
    .order("name")
    .limit(100);

  return (
    <>
      <Topbar title="Leveranciers" />
      <main className="p-6">
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Leverancier</th>
                  <th className="px-5 py-3 font-medium">E-mail</th>
                  <th className="px-5 py-3 font-medium">Bereik</th>
                  <th className="px-5 py-3 font-medium">Betrouwbaarheid</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {suppliers?.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-5 py-3 font-medium">{s.name}</td>
                    <td className="px-5 py-3 text-muted">{s.email ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">
                      {s.company_id ? "Lokaal" : "Groepsbreed"}
                    </td>
                    <td className="px-5 py-3 text-muted tabular">
                      {s.reliability_score ? `${s.reliability_score} / 5` : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          s.is_active
                            ? "rounded-full bg-success/10 px-2 py-0.5 text-xs text-success"
                            : "rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted"
                        }
                      >
                        {s.is_active ? "Actief" : "Inactief"}
                      </span>
                    </td>
                  </tr>
                ))}
                {(!suppliers || suppliers.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan leveranciers niet laden — controleer de Supabase-koppeling."
                        : "Nog geen leveranciers vastgelegd."}
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

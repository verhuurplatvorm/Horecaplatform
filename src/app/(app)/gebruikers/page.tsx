import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function GebruikersPage() {
  const supabase = await createClient();
  const { data: users, error } = await supabase
    .from("user_profiles")
    .select("id, full_name, email, is_group_admin, is_active")
    .order("full_name");

  return (
    <>
      <Topbar title="Gebruikers & rechten" />
      <main className="p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Gebruikers</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Naam</th>
                  <th className="px-5 py-3 font-medium">E-mail</th>
                  <th className="px-5 py-3 font-medium">Rol</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {users?.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-5 py-3 font-medium">{u.full_name}</td>
                    <td className="px-5 py-3 text-muted">{u.email}</td>
                    <td className="px-5 py-3 text-muted">
                      {u.is_group_admin ? "Groepsbeheerder" : "Per bedrijf toegewezen"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          u.is_active
                            ? "rounded-full bg-success/10 px-2 py-0.5 text-xs text-success"
                            : "rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted"
                        }
                      >
                        {u.is_active ? "Actief" : "Inactief"}
                      </span>
                    </td>
                  </tr>
                ))}
                {(!users || users.length === 0) && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan gebruikers niet laden — controleer de Supabase-koppeling."
                        : "Nog geen gebruikersprofielen aangemaakt."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <p className="text-xs text-muted max-w-2xl">
          Rechten worden per rol en module ingesteld in <code>role_permissions</code>{" "}
          en per gebruiker/bedrijf toegekend via <code>user_company_access</code>.
          Financiële gegevens (kostprijzen, marges, contracten) zijn extra
          afgeschermd via <code>can_view_financial</code>.
        </p>
      </main>
    </>
  );
}

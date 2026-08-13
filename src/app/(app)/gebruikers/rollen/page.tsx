import Link from "next/link";
import { Plus, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function RollenPage() {
  const supabase = await createClient();
  const { data: roles, error } = await supabase
    .from("roles")
    .select("id, name, key, description, is_system")
    .order("name");

  // Rollen zonder één enkele ingestelde rij in role_permissions zien
  // door het fail-closed-ontwerp van het rechtensysteem NIETS, in geen
  // enkel onderdeel — ook niet wat normaal standaard zichtbaar zou zijn.
  // Dat is bewust veilig, maar onopgemerkt kan het gebruikers volledig
  // buitensluiten. Hier in één oogopslag zichtbaar maken welke rollen
  // dit risico lopen.
  const { data: permissionRows } = await supabase
    .from("role_permissions")
    .select("role_id");
  const rolesWithPermissions = new Set((permissionRows ?? []).map((p) => p.role_id));
  const emptyRoles = (roles ?? []).filter((r) => !rolesWithPermissions.has(r.id));

  return (
    <>
      <Topbar title="Rollen" />
      <main className="p-6 space-y-4">
        {emptyRoles.length > 0 && (
          <div className="flex items-start gap-2 rounded-md bg-copper/10 p-3 text-sm text-copper">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                {emptyRoles.length === 1
                  ? "1 rol heeft nog geen rechten ingesteld"
                  : `${emptyRoles.length} rollen hebben nog geen rechten ingesteld`}
                : {emptyRoles.map((r) => r.name).join(", ")}.
              </p>
              <p className="mt-0.5 text-copper/80">
                Zonder ingestelde rechten ziet een gebruiker met deze rol nergens iets
                (fail-closed, bewust veilig) — controleer dit voordat iemand met deze rol
                gaat inloggen.
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Link href="/gebruikers/rollen/nieuw">
            <Button>
              <Plus className="h-4 w-4" />
              Nieuwe rol
            </Button>
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
<table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Naam</th>
                  <th className="px-5 py-3 font-medium">Sleutel</th>
                  <th className="px-5 py-3 font-medium">Omschrijving</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Rechten</th>
                </tr>
              </thead>
              <tbody>
                {roles?.map((r) => {
                  const hasPermissions = rolesWithPermissions.has(r.id);
                  return (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-5 py-3 font-medium">
                        <Link
                          href={`/gebruikers/rollen/${r.id}/bewerken`}
                          className="hover:text-teal hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-muted">{r.key}</td>
                      <td className="px-5 py-3 text-muted">{r.description ?? "—"}</td>
                      <td className="px-5 py-3">
                        {r.is_system ? (
                          <span className="rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted">
                            systeemrol
                          </span>
                        ) : (
                          <span className="rounded-full bg-teal/10 px-2 py-0.5 text-xs text-teal">
                            eigen rol
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {hasPermissions ? (
                          <span className="text-muted">ingesteld</span>
                        ) : (
                          <span className="flex items-center gap-1 text-copper">
                            <TriangleAlert className="h-3.5 w-3.5" /> geen rechten
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(!roles || roles.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan rollen niet laden — controleer de Supabase-koppeling."
                        : "Nog geen rollen aangemaakt. Maak er een aan om aan gebruikers toe te kennen."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
</div>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

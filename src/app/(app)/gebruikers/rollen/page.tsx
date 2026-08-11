import Link from "next/link";
import { Plus } from "lucide-react";
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

  return (
    <>
      <Topbar title="Rollen" />
      <main className="p-6 space-y-4">
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
                </tr>
              </thead>
              <tbody>
                {roles?.map((r) => (
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
                  </tr>
                ))}
                {(!roles || roles.length === 0) && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted">
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

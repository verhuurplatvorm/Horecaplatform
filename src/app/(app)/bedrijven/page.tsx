import Link from "next/link";
import { Plus } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function BedrijvenPage() {
  const supabase = await createClient();
  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, name, kind, legal_entity_id, is_seasonal, is_active")
    .order("name");

  return (
    <>
      <Topbar title="Bedrijven" />
      <main className="p-6 space-y-4">
        <div className="flex justify-end">
          <Link href="/bedrijven/nieuw">
            <Button>
              <Plus className="h-4 w-4" />
              Nieuw bedrijf
            </Button>
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
<table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Bedrijf</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Seizoensgebonden</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {companies?.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-background">
                    <td className="px-5 py-3 font-medium">
                      <Link
                        href={`/bedrijven/${c.id}/bewerken`}
                        className="hover:text-teal hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted capitalize">
                      {c.kind.replace(/_/g, " ")}
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {c.is_seasonal ? "Ja" : "Nee"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          c.is_active
                            ? "rounded-full bg-success/10 px-2 py-0.5 text-xs text-success"
                            : "rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted"
                        }
                      >
                        {c.is_active ? "Actief" : "Inactief"}
                      </span>
                    </td>
                  </tr>
                ))}
                {(!companies || companies.length === 0) && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan bedrijven niet laden — controleer de Supabase-koppeling."
                        : "Nog geen bedrijven aangemaakt (max. 25 per groep)."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
</div>
          </CardContent>
        </Card>
        <p className="mt-3 text-xs text-muted">
          Nieuwe bedrijven en juridische entiteiten aanmaken of bewerken is
          voorbehouden aan groepsbeheerders (RLS-policy{" "}
          <code>companies_write</code>).
        </p>
      </main>
    </>
  );
}

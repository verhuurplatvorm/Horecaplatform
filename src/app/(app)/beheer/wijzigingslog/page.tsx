import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import type { AuditLogEntry } from "@/lib/types/database";

const TABLE_LABELS: Record<string, string> = {
  supplier_products: "Leveranciersprijs",
  recipes: "Recept/halfproduct",
  role_permissions: "Rolrechten",
  user_company_access: "Gebruikerstoegang",
  companies: "Bedrijf",
};

const ACTION_LABELS: Record<string, { label: string; className: string }> = {
  insert: { label: "aangemaakt", className: "bg-success/10 text-success" },
  update: { label: "gewijzigd", className: "bg-copper/10 text-copper" },
  delete: { label: "verwijderd", className: "bg-danger/10 text-danger" },
};

/** Toont een enkel veld dat is gewijzigd tussen oud en nieuw, als korte samenvatting. */
function summarizeChange(row: AuditLogEntry): string {
  if (row.action === "insert") return "nieuwe rij";
  if (row.action === "delete") return "rij verwijderd";
  if (!row.old_data || !row.new_data) return "—";
  const changedFields = Object.keys(row.new_data).filter(
    (key) => JSON.stringify(row.old_data?.[key]) !== JSON.stringify(row.new_data?.[key])
  );
  if (changedFields.length === 0) return "geen zichtbare velden gewijzigd";
  return changedFields.slice(0, 4).join(", ") + (changedFields.length > 4 ? ", …" : "");
}

export default async function AuditLogPage() {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("audit_log")
    .select("id, table_name, record_id, action, old_data, new_data, changed_by, changed_at")
    .order("changed_at", { ascending: false })
    .limit(200);

  const userIds = [...new Set((rows ?? []).map((r) => r.changed_by).filter(Boolean))] as string[];
  const { data: users } = userIds.length
    ? await supabase.from("user_profiles").select("id, full_name").in("id", userIds)
    : { data: [] };
  const userNameById = new Map((users ?? []).map((u) => [u.id, u.full_name]));

  return (
    <>
      <Topbar title="Wijzigingslog" />
      <main className="space-y-4 p-6">
        <p className="text-sm text-muted">
          De laatste 200 wijzigingen aan prijzen, recepten/halfproducten, rolrechten,
          gebruikerstoegang en bedrijven — alleen zichtbaar voor beheerders. Overige
          onderdelen (bv. ingrediënten, menukaarten) worden nog niet gelogd.
        </p>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-medium">Datum/tijd</th>
                    <th className="px-5 py-3 font-medium">Door</th>
                    <th className="px-5 py-3 font-medium">Onderdeel</th>
                    <th className="px-5 py-3 font-medium">Actie</th>
                    <th className="px-5 py-3 font-medium">Gewijzigde velden</th>
                  </tr>
                </thead>
                <tbody>
                  {(rows as AuditLogEntry[] | null)?.map((row) => {
                    const action = ACTION_LABELS[row.action];
                    return (
                      <tr key={row.id} className="border-t border-border">
                        <td className="px-5 py-3 text-muted">
                          {new Date(row.changed_at).toLocaleString("nl-NL")}
                        </td>
                        <td className="px-5 py-3">
                          {row.changed_by
                            ? userNameById.get(row.changed_by) ?? "onbekende gebruiker"
                            : "systeem"}
                        </td>
                        <td className="px-5 py-3 font-medium">
                          {TABLE_LABELS[row.table_name] ?? row.table_name}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${action?.className ?? ""}`}
                          >
                            {action?.label ?? row.action}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-muted">{summarizeChange(row)}</td>
                      </tr>
                    );
                  })}
                  {(!rows || rows.length === 0) && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-muted">
                        {error
                          ? "Kan het wijzigingslog niet laden — mogelijk geen beheerdersrechten."
                          : "Nog geen wijzigingen gelogd."}
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

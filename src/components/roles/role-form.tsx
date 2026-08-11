"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { PERMISSION_MODULES } from "@/lib/permission-modules";
import type { Role, RolePermission } from "@/lib/types/database";

type PermissionKey = "can_view" | "can_create" | "can_edit" | "can_delete" | "can_view_financial";
const PERMISSION_COLUMNS: { key: PermissionKey; label: string }[] = [
  { key: "can_view", label: "Bekijken" },
  { key: "can_create", label: "Aanmaken" },
  { key: "can_edit", label: "Bewerken" },
  { key: "can_delete", label: "Verwijderen" },
  { key: "can_view_financial", label: "Financieel" },
];

export interface RoleFormProps {
  initialRole?: Role;
  initialPermissions?: RolePermission[];
}

export function RoleForm({ initialRole, initialPermissions = [] }: RoleFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialRole);

  const [name, setName] = useState(initialRole?.name ?? "");
  const [key, setKey] = useState(initialRole?.key ?? "");
  const [description, setDescription] = useState(initialRole?.description ?? "");
  const [permissions, setPermissions] = useState<Record<string, Record<PermissionKey, boolean>>>(
    () => {
      const map: Record<string, Record<PermissionKey, boolean>> = {};
      for (const m of PERMISSION_MODULES) {
        const existing = initialPermissions.find((p) => p.module_key === m.key);
        map[m.key] = {
          can_view: existing?.can_view ?? false,
          can_create: existing?.can_create ?? false,
          can_edit: existing?.can_edit ?? false,
          can_delete: existing?.can_delete ?? false,
          can_view_financial: existing?.can_view_financial ?? false,
        };
      }
      return map;
    }
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePermission(moduleKey: string, perm: PermissionKey) {
    setPermissions((prev) => {
      const next = { ...prev[moduleKey], [perm]: !prev[moduleKey][perm] };
      if (perm === "can_view" && !next.can_view) {
        next.can_create = false;
        next.can_edit = false;
        next.can_delete = false;
        next.can_view_financial = false;
      }
      if (perm !== "can_view" && next[perm]) next.can_view = true;
      return { ...prev, [moduleKey]: next };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!key.trim()) {
      setError("Geef de rol een korte sleutel op (bv. 'chef-kok').");
      return;
    }
    setSaving(true);
    const supabase = createClient();

    let roleId = initialRole?.id;

    if (isEdit && roleId) {
      const { error: updateError } = await supabase
        .from("roles")
        .update({ name: name.trim(), key: key.trim(), description: description.trim() || null })
        .eq("id", roleId);
      if (updateError) {
        setError("Opslaan mislukt: " + updateError.message);
        setSaving(false);
        return;
      }
    } else {
      const groupId = await getCurrentGroupId(supabase);
      if (!groupId) {
        setError("Kan groep van gebruiker niet bepalen. Log opnieuw in.");
        setSaving(false);
        return;
      }
      const { data: created, error: insertError } = await supabase
        .from("roles")
        .insert({
          group_id: groupId,
          name: name.trim(),
          key: key.trim(),
          description: description.trim() || null,
        })
        .select("id")
        .single();
      if (insertError || !created) {
        setError("Opslaan mislukt: " + (insertError?.message ?? "onbekende fout"));
        setSaving(false);
        return;
      }
      roleId = created.id;
    }

    await supabase.from("role_permissions").delete().eq("role_id", roleId!);
    const rows = PERMISSION_MODULES.filter((m) => permissions[m.key].can_view).map((m) => ({
      role_id: roleId!,
      module_key: m.key,
      ...permissions[m.key],
    }));
    if (rows.length > 0) {
      const { error: permError } = await supabase.from("role_permissions").insert(rows);
      if (permError) {
        setError("Rol opgeslagen, maar rechten niet: " + permError.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    router.push("/gebruikers/rollen");
  }

  async function handleDelete() {
    if (!initialRole) return;
    if (
      !window.confirm(
        `Rol "${initialRole.name}" verwijderen? Dit kan niet als de rol nog aan gebruikers is toegekend.`
      )
    ) {
      return;
    }
    setDeleting(true);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("roles").delete().eq("id", initialRole.id);
    setDeleting(false);
    if (deleteError) {
      setError(
        deleteError.code === "23503"
          ? "Deze rol is nog aan gebruikers toegekend en kan daarom niet verwijderd worden."
          : "Verwijderen mislukt: " + deleteError.message
      );
      return;
    }
    router.push("/gebruikers/rollen");
  }

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (e.key === "Enter" && target.tagName === "INPUT") {
          e.preventDefault();
        }
      }}
      className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Rolgegevens</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Naam</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Sleutel (intern, geen spaties)
            </label>
            <input
              required
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
              placeholder="bv. chef-kok"
              className="input"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">
              Omschrijving (optioneel)
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rechten per onderdeel</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
<table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Onderdeel</th>
                {PERMISSION_COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-3 text-center font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_MODULES.map((m) => (
                <tr key={m.key} className="border-t border-border">
                  <td className="px-5 py-3 font-medium">{m.label}</td>
                  {PERMISSION_COLUMNS.map((c) => (
                    <td key={c.key} className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={permissions[m.key][c.key]}
                        onChange={() => togglePermission(m.key, c.key)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
</div>
        </CardContent>
        <CardContent className="pt-0">
          <p className="text-xs text-muted">
            &quot;Financieel&quot; staat los van de andere rechten: iemand kan bijvoorbeeld
            recepturen mogen bewerken zonder kostprijzen en marges te zien.
          </p>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Opslaan…" : isEdit ? "Wijzigingen opslaan" : "Rol aanmaken"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push("/gebruikers/rollen")}>
          Annuleren
        </Button>
        {isEdit && !initialRole?.is_system && (
          <Button type="button" variant="danger" disabled={deleting} onClick={handleDelete} className="ml-auto">
            {deleting ? "Verwijderen…" : "Verwijderen"}
          </Button>
        )}
      </div>

      <style jsx>{`
        .input {
          display: block;
          width: 100%;
          height: 2.5rem;
          border-radius: 0.375rem;
          border: 1px solid var(--border);
          background: var(--surface);
          padding: 0 0.75rem;
          font-size: 0.875rem;
        }
      `}</style>
    </form>
  );
}

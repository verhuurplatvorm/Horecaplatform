"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import type { Company, Role, UserProfile } from "@/lib/types/database";

interface AccessRow {
  company_id: string;
  role_id: string;
  companyName: string;
  roleName: string;
}

export default function BewerkGebruikerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: userId } = use(params);
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const [fullName, setFullName] = useState("");
  const [isGroupAdmin, setIsGroupAdmin] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newCompanyId, setNewCompanyId] = useState("");
  const [newRoleId, setNewRoleId] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const [{ data: p }, { data: c }, { data: r }, { data: a }] = await Promise.all([
        supabase.from("user_profiles").select("*").eq("id", userId).single(),
        supabase.from("companies").select("*").order("name"),
        supabase.from("roles").select("*").order("name"),
        supabase
          .from("user_company_access")
          .select("company_id, role_id, companies(name), roles(name)")
          .eq("user_id", userId),
      ]);
      if (cancelled) return;

      if (p) {
        setProfile(p as UserProfile);
        setFullName(p.full_name);
        setIsGroupAdmin(p.is_group_admin);
        setIsActive(p.is_active);
      }
      setCompanies((c as Company[]) ?? []);
      setRoles((r as Role[]) ?? []);
      setAccess(
        (a ?? []).map((row) => ({
          company_id: row.company_id,
          role_id: row.role_id,
          // @ts-expect-error -- geneste relaties, niet in het handmatige Database-type
          companyName: row.companies?.name ?? "onbekend bedrijf",
          // @ts-expect-error -- geneste relaties
          roleName: row.roles?.name ?? "onbekende rol",
        }))
      );
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [userId, reloadToken]);

  function reload() {
    setReloadToken((t) => t + 1);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("user_profiles")
      .update({ full_name: fullName.trim(), is_group_admin: isGroupAdmin, is_active: isActive })
      .eq("id", userId);
    setSaving(false);
    if (updateError) {
      setError("Opslaan mislukt: " + updateError.message);
      return;
    }
    router.push("/gebruikers");
  }

  async function handleAddAccess() {
    if (!newCompanyId || !newRoleId) return;
    const supabase = createClient();
    const { error: insertError } = await supabase.from("user_company_access").upsert({
      user_id: userId,
      company_id: newCompanyId,
      role_id: newRoleId,
    });
    if (!insertError) {
      setNewCompanyId("");
      setNewRoleId("");
      reload();
    }
  }

  async function handleRemoveAccess(companyId: string) {
    const supabase = createClient();
    await supabase
      .from("user_company_access")
      .delete()
      .eq("user_id", userId)
      .eq("company_id", companyId);
    reload();
  }

  const availableCompanies = companies.filter(
    (c) => !access.some((a) => a.company_id === c.id)
  );

  if (loading) {
    return (
      <>
        <Topbar title="Gebruiker bewerken" />
        <main className="p-6 text-sm text-muted">Laden…</main>
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <Topbar title="Gebruiker bewerken" />
        <main className="p-6 text-sm text-muted">Gebruiker niet gevonden.</main>
      </>
    );
  }

  return (
    <>
      <Topbar title={`Bewerken: ${profile.full_name}`} />
      <main className="max-w-3xl space-y-4 p-6">
        <form onSubmit={handleSaveProfile}>
          <Card>
            <CardHeader>
              <CardTitle>Gebruikersgegevens</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Naam</label>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  E-mailadres
                </label>
                <input value={profile.email} disabled className="input opacity-60" />
                <p className="mt-1 text-xs text-muted">
                  E-mailadres wijzigen kan niet hier — dat loopt via Supabase Auth zelf.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isGroupAdmin}
                  onChange={(e) => setIsGroupAdmin(e.target.checked)}
                />
                Groepsbeheerder (ziet en beheert alle bedrijven, ongeacht onderstaande toegang)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Actief
              </label>
            </CardContent>
          </Card>

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}

          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Opslaan…" : "Wijzigingen opslaan"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.push("/gebruikers")}>
              Annuleren
            </Button>
          </div>
        </form>

        <Card>
          <CardHeader>
            <CardTitle>Toegang per bedrijf</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isGroupAdmin && (
              <p className="text-sm text-muted">
                Als groepsbeheerder heeft deze gebruiker sowieso toegang tot alle bedrijven.
                Onderstaande toewijzingen zijn dan niet nodig, maar blijven wel bewaard voor
                het geval &quot;Groepsbeheerder&quot; later wordt uitgezet.
              </p>
            )}
            {access.length === 0 ? (
              <p className="text-sm text-muted">Nog geen toegang tot specifieke bedrijven.</p>
            ) : (
              <ul className="divide-y divide-border">
                {access.map((a) => (
                  <li key={a.company_id} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      <span className="font-medium">{a.companyName}</span>{" "}
                      <span className="text-muted">— {a.roleName}</span>
                    </span>
                    <button
                      onClick={() => handleRemoveAccess(a.company_id)}
                      className="text-muted hover:text-danger"
                      title="Toegang intrekken"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {roles.length === 0 ? (
              <p className="text-sm text-copper">
                Er zijn nog geen rollen aangemaakt.{" "}
                <Link href="/gebruikers/rollen/nieuw" className="underline">
                  Maak eerst een rol aan
                </Link>{" "}
                voordat je toegang kunt toewijzen.
              </p>
            ) : (
              <div className="flex items-end gap-2 border-t border-border pt-4">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    Bedrijf
                  </label>
                  <select
                    value={newCompanyId}
                    onChange={(e) => setNewCompanyId(e.target.value)}
                    className="input"
                  >
                    <option value="">Kies bedrijf…</option>
                    {availableCompanies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-foreground">Rol</label>
                  <select
                    value={newRoleId}
                    onChange={(e) => setNewRoleId(e.target.value)}
                    className="input"
                  >
                    <option value="">Kies rol…</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAddAccess}
                  disabled={!newCompanyId || !newRoleId}
                >
                  <Plus className="h-4 w-4" />
                  Toevoegen
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

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
      </main>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Shield } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  is_group_admin: boolean;
  is_active: boolean;
}

export default function GebruikersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from("user_profiles")
        .select("id, full_name, email, is_group_admin, is_active")
        .order("full_name");
      if (cancelled) return;
      setUsers((data as UserRow[]) ?? []);
      setError(Boolean(fetchError));
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function reload() {
    setReloadToken((t) => t + 1);
  }

  return (
    <>
      <Topbar title="Gebruikers & rechten" />
      <main className="p-6 space-y-6">
        <div className="flex justify-end gap-2">
          <Link href="/gebruikers/rollen">
            <Button variant="secondary">
              <Shield className="h-4 w-4" />
              Rollen beheren
            </Button>
          </Link>
          <Button onClick={() => setInviting(true)}>
            <Plus className="h-4 w-4" />
            Gebruiker uitnodigen
          </Button>
        </div>

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
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-5 py-3 font-medium">
                      <Link
                        href={`/gebruikers/${u.id}/bewerken`}
                        className="hover:text-teal hover:underline"
                      >
                        {u.full_name}
                      </Link>
                    </td>
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
                {users.length === 0 && !loading && (
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

      {inviting && (
        <Modal title="Gebruiker uitnodigen" onClose={() => setInviting(false)}>
          <InviteForm
            onDone={() => {
              setInviting(false);
              reload();
            }}
            onCancel={() => setInviting(false)}
          />
        </Modal>
      )}
    </>
  );
}

function InviteForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [isGroupAdmin, setIsGroupAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);

    const res = await fetch("/api/users/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, email, isGroupAdmin }),
    });
    const body = await res.json();
    setSaving(false);

    if (!res.ok) {
      setErrorMsg(body.error ?? "Uitnodigen mislukt.");
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
        <label className="mb-1 block text-sm font-medium text-foreground">E-mailadres</label>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isGroupAdmin}
          onChange={(e) => setIsGroupAdmin(e.target.checked)}
        />
        Groepsbeheerder (ziet en beheert alle bedrijven)
      </label>
      <p className="text-xs text-muted">
        {isGroupAdmin
          ? "Deze gebruiker krijgt direct toegang tot alle bedrijven."
          : "Toegang tot specifieke bedrijven en rollen wijs je na het accepteren van de uitnodiging toe (via user_company_access)."}
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Bezig…" : "Uitnodiging versturen"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Annuleren
        </Button>
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

"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import type { MenuCard, MenuCardStatus } from "@/lib/types/database";

export default function MenukaartInstellingenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: menuCardId } = use(params);
  const router = useRouter();
  const { companies } = useCompanyScope();

  const [card, setCard] = useState<MenuCard | null>(null);
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [menuType, setMenuType] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<MenuCardStatus>("concept");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("menu_cards")
      .select("*")
      .eq("id", menuCardId)
      .single()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const c = data as MenuCard;
        setCard(c);
        setName(c.name);
        setCompanyId(c.company_id ?? "");
        setMenuType(c.menu_type ?? "");
        setDescription(c.description ?? "");
        setStartDate(c.start_date ?? "");
        setEndDate(c.end_date ?? "");
        setStatus(c.status);
      });
    return () => {
      cancelled = true;
    };
  }, [menuCardId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("menu_cards")
      .update({
        name: name.trim(),
        company_id: companyId || null,
        menu_type: menuType.trim() || null,
        description: description.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        status,
      })
      .eq("id", menuCardId);
    setSaving(false);
    if (updateError) {
      setError("Opslaan mislukt: " + updateError.message);
      return;
    }
    router.push(`/menukaarten/${menuCardId}`);
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `Menukaart "${card?.name}" verwijderen? De gekoppelde gerechten zelf blijven bestaan — alleen deze menukaart en zijn mappenstructuur verdwijnen.`
      )
    ) {
      return;
    }
    setDeleting(true);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("menu_cards").delete().eq("id", menuCardId);
    setDeleting(false);
    if (deleteError) {
      setError("Verwijderen mislukt: " + deleteError.message);
      return;
    }
    router.push("/menukaarten");
  }

  if (!card) {
    return (
      <>
        <Topbar title="Instellingen" />
        <main className="p-6 text-sm text-muted">Laden…</main>
      </>
    );
  }

  return (
    <>
      <Topbar title={`Instellingen: ${card.name}`} />
      <main className="max-w-2xl p-6">
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Menukaartgegevens</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-foreground">Naam</label>
                <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Bedrijf</label>
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="input">
                  <option value="">Groepsbreed</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Type</label>
                <input value={menuType} onChange={(e) => setMenuType(e.target.value)} className="input" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Startdatum</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Einddatum</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="input"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-foreground">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as MenuCardStatus)}
                  className="input"
                >
                  <option value="concept">Concept</option>
                  <option value="in_voorbereiding">In voorbereiding</option>
                  <option value="gepland">Gepland</option>
                  <option value="actief">Actief</option>
                  <option value="verlopen">Verlopen</option>
                  <option value="gearchiveerd">Gearchiveerd</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Interne omschrijving
                </label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input"
                />
              </div>
            </CardContent>
          </Card>

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}

          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Opslaan…" : "Wijzigingen opslaan"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(`/menukaarten/${menuCardId}`)}
            >
              Annuleren
            </Button>
            <Button type="button" variant="danger" disabled={deleting} onClick={handleDelete} className="ml-auto">
              {deleting ? "Verwijderen…" : "Menukaart verwijderen"}
            </Button>
          </div>
        </form>

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

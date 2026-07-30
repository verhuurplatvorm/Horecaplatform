"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import type { MenuCardStatus } from "@/lib/types/database";

export default function NieuweMenukaartPage() {
  const router = useRouter();
  const { companies } = useCompanyScope();

  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [menuType, setMenuType] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<MenuCardStatus>("concept");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const groupId = await getCurrentGroupId(supabase);
    if (!groupId) {
      setError("Kan groep van gebruiker niet bepalen. Log opnieuw in.");
      setSaving(false);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: created, error: insertError } = await supabase
      .from("menu_cards")
      .insert({
        group_id: groupId,
        company_id: companyId || null,
        name: name.trim(),
        menu_type: menuType.trim() || null,
        description: description.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        status,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();

    setSaving(false);
    if (insertError || !created) {
      setError("Opslaan mislukt: " + (insertError?.message ?? "onbekende fout"));
      return;
    }

    await supabase.from("menu_folders").insert({
      menu_card_id: created.id,
      name: "Hoofdmap",
      sort_order: 0,
    });

    router.push(`/menukaarten/${created.id}`);
  }

  return (
    <>
      <Topbar title="Nieuwe menukaart" />
      <main className="max-w-2xl p-6">
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Menukaartgegevens</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-foreground">Naam</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="bv. Menukaart Lunch 01-09-2026"
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Bedrijf</label>
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="input"
                >
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
                <input
                  value={menuType}
                  onChange={(e) => setMenuType(e.target.value)}
                  placeholder="bv. Lunchkaart, Dinerkaart, Borrelkaart"
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Startdatum
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Einddatum (optioneel)
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="input"
                />
              </div>
              <div>
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
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Interne omschrijving (optioneel)
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
              {saving ? "Aanmaken…" : "Menukaart aanmaken"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.push("/menukaarten")}>
              Annuleren
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

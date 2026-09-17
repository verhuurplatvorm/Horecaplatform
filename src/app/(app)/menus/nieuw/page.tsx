"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";

export default function NieuwMenuPage() {
  const router = useRouter();
  const { activeCompanyIds } = useCompanyScope();
  const [name, setName] = useState("");
  const [menuType, setMenuType] = useState("buffet");
  const [personCount, setPersonCount] = useState("50");
  const [serviceDate, setServiceDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) {
      setError("Geef het menu een naam.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const groupId = await getCurrentGroupId(supabase);
    if (!groupId) {
      setSaving(false);
      setError("Kan de groep niet bepalen.");
      return;
    }
    const { data, error: insertError } = await supabase
      .from("event_menus")
      .insert({
        group_id: groupId,
        company_id: activeCompanyIds.length === 1 ? activeCompanyIds[0] : null,
        name: name.trim(),
        menu_type: menuType.trim() || null,
        person_count: Math.max(1, Number(personCount) || 1),
        service_date: serviceDate || null,
      })
      .select("id")
      .single();
    setSaving(false);
    if (insertError || !data) {
      setError("Aanmaken mislukt: " + (insertError?.message ?? "onbekende fout"));
      return;
    }
    router.push(`/menus/${data.id}`);
  }

  return (
    <>
      <Topbar title="Nieuw menu of buffet" />
      <main className="max-w-xl space-y-4 p-6">
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div>
              <label className="mb-1 block text-sm font-medium">Naam</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="bv. BBQ Het Strand"
                className="input"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Type</label>
                <input
                  value={menuType}
                  onChange={(e) => setMenuType(e.target.value)}
                  placeholder="buffet, arrangement…"
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Aantal personen</label>
                <input
                  type="number"
                  min="1"
                  value={personCount}
                  onChange={(e) => setPersonCount(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Datum</label>
                <input
                  type="date"
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  className="input"
                />
              </div>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={create} disabled={saving}>
                {saving ? "Aanmaken…" : "Aanmaken"}
              </Button>
              <Button variant="secondary" onClick={() => router.push("/menus")}>
                Annuleren
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

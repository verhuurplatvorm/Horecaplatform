"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import type { Company, CompanyKind, LegalEntity } from "@/lib/types/database";

const COMPANY_KINDS: { value: CompanyKind; label: string }[] = [
  { value: "restaurant", label: "Restaurant" },
  { value: "strandpaviljoen", label: "Strandpaviljoen" },
  { value: "beachclub", label: "Beachclub" },
  { value: "hotel", label: "Hotel" },
  { value: "verblijfsaccommodatie", label: "Verblijfsaccommodatie" },
  { value: "brouwerij", label: "Brouwerij" },
  { value: "catering", label: "Catering" },
  { value: "verhuur", label: "Verhuur" },
  { value: "evenementenlocatie", label: "Evenementenlocatie" },
  { value: "centrale_beheermaatschappij", label: "Centrale beheermaatschappij" },
  { value: "holding", label: "Holding" },
  { value: "overig", label: "Overig" },
];

export interface CompanyFormProps {
  initialCompany?: Company;
}

export function CompanyForm({ initialCompany }: CompanyFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialCompany);

  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);
  const [isEmptyCompany, setIsEmptyCompany] = useState<boolean | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [name, setName] = useState(initialCompany?.name ?? "");
  const [tradeName, setTradeName] = useState(initialCompany?.trade_name ?? "");
  const [kind, setKind] = useState<CompanyKind>(initialCompany?.kind ?? "restaurant");
  const [legalEntityId, setLegalEntityId] = useState(
    initialCompany?.legal_entity_id ?? ""
  );
  const [newLegalEntityName, setNewLegalEntityName] = useState("");
  const [isSeasonal, setIsSeasonal] = useState(initialCompany?.is_seasonal ?? false);
  const [seasonStart, setSeasonStart] = useState(initialCompany?.season_start ?? "");
  const [seasonEnd, setSeasonEnd] = useState(initialCompany?.season_end ?? "");
  const [isActive, setIsActive] = useState(initialCompany?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("legal_entities")
      .select("*")
      .order("name")
      .then(({ data }) => setLegalEntities((data as LegalEntity[]) ?? []));
  }, []);

  // Alleen een leeg bedrijf (geen recepten, verkoopproducten,
  // leveranciers, voorraadmutaties of gebruikerstoegang) mag hard
  // verwijderd worden — anders blijft "inactief zetten" de enige optie.
  useEffect(() => {
    if (!initialCompany) return;
    let cancelled = false;

    async function checkEmpty() {
      const supabase = createClient();
      const companyId = initialCompany!.id;
      const counts = await Promise.all([
        supabase.from("locations").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        supabase.from("recipes").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        supabase.from("sales_products").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        supabase.from("suppliers").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        supabase.from("stock_movements").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        supabase.from("user_company_access").select("company_id", { count: "exact", head: true }).eq("company_id", companyId),
      ]);
      if (cancelled) return;
      setIsEmptyCompany(counts.every((r) => (r.count ?? 0) === 0));
    }

    checkEmpty();
    return () => {
      cancelled = true;
    };
  }, [initialCompany]);

  async function handleDelete() {
    if (!initialCompany) return;
    if (
      !window.confirm(
        `"${initialCompany.name}" definitief verwijderen? Dit bedrijf is leeg (geen recepten, verkoopdata of voorraad), dus dit kan veilig — maar is niet ongedaan te maken.`
      )
    ) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    const supabase = createClient();
    const { error: deleteErr } = await supabase
      .from("companies")
      .delete()
      .eq("id", initialCompany.id);
    setDeleting(false);

    if (deleteErr) {
      setDeleteError(
        "Verwijderen mislukt: " +
          deleteErr.message +
          " Waarschijnlijk is er toch nog data aan dit bedrijf gekoppeld — zet het op \"inactief\" in plaats daarvan."
      );
      return;
    }
    router.push("/bedrijven");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let finalLegalEntityId = legalEntityId;

    setSaving(true);
    const supabase = createClient();
    const groupId = await getCurrentGroupId(supabase);
    if (!groupId) {
      setError("Kan groep van gebruiker niet bepalen. Log opnieuw in.");
      setSaving(false);
      return;
    }

    if (!finalLegalEntityId) {
      if (!newLegalEntityName.trim()) {
        setError("Kies een bestaande juridische entiteit, of geef een naam op voor een nieuwe.");
        setSaving(false);
        return;
      }
      const { data: created, error: legalEntityError } = await supabase
        .from("legal_entities")
        .insert({ group_id: groupId, name: newLegalEntityName.trim() })
        .select("id")
        .single();
      if (legalEntityError || !created) {
        setError(
          "Kan juridische entiteit niet aanmaken: " +
            (legalEntityError?.message ?? "onbekende fout")
        );
        setSaving(false);
        return;
      }
      finalLegalEntityId = created.id;
    }

    const payload = {
      name: name.trim(),
      trade_name: tradeName.trim() || null,
      kind,
      legal_entity_id: finalLegalEntityId,
      is_seasonal: isSeasonal,
      season_start: isSeasonal && seasonStart ? seasonStart : null,
      season_end: isSeasonal && seasonEnd ? seasonEnd : null,
      is_active: isActive,
    };

    if (isEdit && initialCompany) {
      const { error: updateError } = await supabase
        .from("companies")
        .update(payload)
        .eq("id", initialCompany.id);
      setSaving(false);
      if (updateError) {
        setError("Opslaan mislukt: " + updateError.message);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from("companies")
        .insert({ ...payload, group_id: groupId });
      setSaving(false);
      if (insertError) {
        setError("Opslaan mislukt: " + insertError.message);
        return;
      }
    }

    router.push("/bedrijven");
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
          <CardTitle>Basisgegevens</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Naam" required>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </Field>
          <Field label="Handelsnaam (optioneel)">
            <input
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Type" required>
            <select
              required
              value={kind}
              onChange={(e) => setKind(e.target.value as CompanyKind)}
              className="input"
            >
              {COMPANY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Juridische entiteit" required>
            <select
              value={legalEntityId}
              onChange={(e) => setLegalEntityId(e.target.value)}
              className="input"
            >
              <option value="">Nieuwe entiteit aanmaken…</option>
              {legalEntities.map((le) => (
                <option key={le.id} value={le.id}>
                  {le.name}
                </option>
              ))}
            </select>
            {!legalEntityId && (
              <input
                value={newLegalEntityName}
                onChange={(e) => setNewLegalEntityName(e.target.value)}
                placeholder="Naam nieuwe juridische entiteit (bv. B.V.)"
                className="input mt-2"
              />
            )}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seizoen &amp; status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isSeasonal}
              onChange={(e) => setIsSeasonal(e.target.checked)}
            />
            Seizoensgebonden bedrijf
          </label>
          {isSeasonal && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start seizoen">
                <input
                  type="date"
                  value={seasonStart}
                  onChange={(e) => setSeasonStart(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Einde seizoen">
                <input
                  type="date"
                  value={seasonEnd}
                  onChange={(e) => setSeasonEnd(e.target.value)}
                  className="input"
                />
              </Field>
            </div>
          )}
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Actief
            </label>
            <p className="mt-1 text-xs text-muted">
              Zodra er recepten, voorraad of verkoopdata aan een bedrijf
              hangen, kan het niet meer verwijderd worden — alleen dan is
              &quot;inactief&quot; zetten mogelijk (alle data blijft bewaard,
              het bedrijf verdwijnt alleen uit de bedrijfsselector en kan
              later weer geactiveerd worden). Een écht leeg bedrijf mag wel
              hard verwijderd worden, zie de knop hieronder.
            </p>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}
      {deleteError && <p className="text-sm text-danger">{deleteError}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Opslaan…" : isEdit ? "Wijzigingen opslaan" : "Bedrijf aanmaken"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push("/bedrijven")}>
          Annuleren
        </Button>
        {isEdit && isEmptyCompany && (
          <Button
            type="button"
            variant="danger"
            disabled={deleting}
            onClick={handleDelete}
            className="ml-auto"
          >
            {deleting ? "Verwijderen…" : "Verwijderen (leeg bedrijf)"}
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

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-foreground">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}

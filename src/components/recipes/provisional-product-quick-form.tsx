"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import type { Product, Unit } from "@/lib/types/database";

type PriceBasis = "kg" | "l" | "stuk";

const BASIS: Record<PriceBasis, { baseKey: "g" | "ml" | "stuk"; label: string; factor: number }> = {
  kg: { baseKey: "g", label: "per kilo", factor: 1000 },
  l: { baseKey: "ml", label: "per liter", factor: 1000 },
  stuk: { baseKey: "stuk", label: "per stuk", factor: 1 },
};

/**
 * Voorlopig ingrediënt: voor een product dat je al in een recept wilt
 * gebruiken maar nog niet besteld hebt. Het rekent met een geschatte
 * prijs (eigen kostprijs). Komt het artikel later op een factuur of
 * prijslijst, dan wordt het als suggestie aan dit ingrediënt voorgesteld;
 * na koppelen geldt de echte leveranciersprijs en vervalt "voorlopig".
 */
export function ProvisionalProductQuickForm({
  prefillName = "",
  onSaved,
  onCancel,
}: {
  prefillName?: string;
  onSaved: (product: Product) => void;
  onCancel: () => void;
}) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [name, setName] = useState(prefillName);
  const [basis, setBasis] = useState<PriceBasis>("kg");
  const [price, setPrice] = useState("");
  const [pieceGrams, setPieceGrams] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("units")
      .select("*")
      .then(({ data }) => setUnits((data as Unit[]) ?? []));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Vul een naam in.");
      return;
    }
    const baseUnit = units.find((u) => u.key === BASIS[basis].baseKey);
    const gramUnit = units.find((u) => u.key === "g");
    if (!baseUnit) {
      setError("Eenheden nog niet geladen, probeer het zo opnieuw.");
      return;
    }
    const priceNumber = price.trim() === "" ? null : Number(price.replace(",", "."));
    if (priceNumber !== null && (Number.isNaN(priceNumber) || priceNumber < 0)) {
      setError("Vul een geldige prijs in (of laat het veld leeg).");
      return;
    }
    const grams = pieceGrams.trim() === "" ? null : Number(pieceGrams.replace(",", "."));

    setSaving(true);
    const supabase = createClient();
    const groupId = await getCurrentGroupId(supabase);
    if (!groupId) {
      setError("Kan groep van gebruiker niet bepalen. Log opnieuw in.");
      setSaving(false);
      return;
    }

    const { data: created, error: insertError } = await supabase
      .from("products")
      .insert({
        group_id: groupId,
        name: trimmed,
        custom_name: trimmed,
        kind: "inkoopartikel" as const,
        item_category: "food" as const,
        base_unit: baseUnit.key,
        base_unit_id: baseUnit.id,
        manual_price_per_base_unit:
          priceNumber === null ? null : priceNumber / BASIS[basis].factor,
        avg_unit_quantity: basis === "stuk" && grams && grams > 0 ? grams : null,
        avg_unit_id: basis === "stuk" && grams && grams > 0 ? gramUnit?.id ?? null : null,
        is_provisional: true,
      })
      .select("*")
      .single();

    setSaving(false);
    if (insertError || !created) {
      setError("Opslaan mislukt: " + (insertError?.message ?? "onbekende fout"));
      return;
    }
    onSaved(created as Product);
  }

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (e.key === "Enter" && target.tagName === "INPUT") e.preventDefault();
      }}
      className="space-y-3"
    >
      <p className="text-xs text-muted">
        Voor een product dat je nog niet besteld hebt. Het recept rekent voorlopig
        met jouw geschatte prijs. Staat het artikel later op een factuur of
        prijslijst, dan wordt het daar aan dit ingrediënt voorgesteld; na
        koppelen geldt de echte inkoopprijs.
      </p>
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">
          Naam <span className="text-danger">*</span>
        </label>
        <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Prijs geldt</label>
          <select
            value={basis}
            onChange={(e) => setBasis(e.target.value as PriceBasis)}
            className="input"
          >
            {(Object.keys(BASIS) as PriceBasis[]).map((k) => (
              <option key={k} value={k}>
                {BASIS[k].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Geschatte prijs (€ {BASIS[basis].label})
          </label>
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="bv. 24,50"
            className="input"
          />
        </div>
      </div>
      {basis === "stuk" && (
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            1 stuk weegt ongeveer (gram, optioneel)
          </label>
          <input
            inputMode="decimal"
            value={pieceGrams}
            onChange={(e) => setPieceGrams(e.target.value)}
            placeholder="bv. 100"
            className="input"
          />
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Opslaan…" : "Voorlopig ingrediënt aanmaken"}
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

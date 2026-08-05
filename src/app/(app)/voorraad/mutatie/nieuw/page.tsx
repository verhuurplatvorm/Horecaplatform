"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import type { StockMovementType, Unit } from "@/lib/types/database";

interface SearchResult {
  type: "product" | "halfproduct";
  id: string;
  name: string;
  baseUnitId: string | null;
}

const MOVEMENT_TYPES: { value: StockMovementType; label: string; sign: "+" | "-" | "±" }[] = [
  { value: "ontvangst", label: "Ontvangst (inkoop binnengekomen)", sign: "+" },
  { value: "productie", label: "Productie (zelf gemaakt)", sign: "+" },
  { value: "verbruik", label: "Verbruik (handmatig afgeboekt)", sign: "-" },
  { value: "derving", label: "Derving / afval", sign: "-" },
  { value: "correctie", label: "Correctie", sign: "±" },
  { value: "overboeking_uit", label: "Overboeking — uit (naar ander bedrijf)", sign: "-" },
  { value: "overboeking_in", label: "Overboeking — in (van ander bedrijf)", sign: "+" },
  { value: "telling", label: "Telling (inventarisatie-correctie)", sign: "±" },
];

export default function NieuweVoorraadmutatiePage() {
  const router = useRouter();
  const { activeCompanyIds } = useCompanyScope();
  const companyId = activeCompanyIds[0] ?? null;

  const [units, setUnits] = useState<Unit[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [movementType, setMovementType] = useState<StockMovementType>("ontvangst");
  const [quantity, setQuantity] = useState("");
  const [unitId, setUnitId] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("units")
      .select("*")
      .order("dimension")
      .order("sort_order")
      .then(({ data }) => setUnits((data as Unit[]) ?? []));
  }, []);

  useEffect(() => {
    if (query.trim().length < 2 || selected) return;
    let cancelled = false;
    const timeout = setTimeout(async () => {
      const supabase = createClient();
      const [{ data: products }, { data: halfproducts }] = await Promise.all([
        supabase
          .from("products")
          .select("id, name, base_unit_id")
          .or(`name.ilike.%${query}%,custom_name.ilike.%${query}%`)
          .limit(8),
        supabase
          .from("recipes")
          .select("id, name, base_unit_id")
          .eq("recipe_kind", "halfproduct")
          .ilike("name", `%${query}%`)
          .limit(8),
      ]);
      if (cancelled) return;
      setResults([
        ...(products ?? []).map((p) => ({
          type: "product" as const,
          id: p.id,
          name: p.name,
          baseUnitId: p.base_unit_id,
        })),
        ...(halfproducts ?? []).map((r) => ({
          type: "halfproduct" as const,
          id: r.id,
          name: r.name,
          baseUnitId: r.base_unit_id,
        })),
      ]);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, selected]);

  const unitsForSelected = selected?.baseUnitId
    ? units.filter(
        (u) => u.dimension === units.find((x) => x.id === selected.baseUnitId)?.dimension
      )
    : units;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!companyId) {
      setError("Selecteer eerst een bedrijf via de bedrijfsselector.");
      return;
    }
    if (!selected || !quantity.trim() || !unitId) {
      setError("Kies een artikel, hoeveelheid en eenheid.");
      return;
    }

    const chosenUnit = units.find((u) => u.id === unitId);
    const baseUnit = units.find((u) => u.id === selected.baseUnitId);
    if (!chosenUnit || !baseUnit || chosenUnit.dimension !== baseUnit.dimension) {
      setError("De gekozen eenheid past niet bij dit artikel.");
      return;
    }
    const factor = chosenUnit.factor_to_base / baseUnit.factor_to_base;
    const rawQty = Number(quantity) * factor;

    const sign = MOVEMENT_TYPES.find((m) => m.value === movementType)?.sign;
    const signedQty =
      sign === "-" ? -Math.abs(rawQty) : sign === "+" ? Math.abs(rawQty) : rawQty;

    setSaving(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("stock_movements").insert({
      company_id: companyId,
      product_id: selected.type === "product" ? selected.id : null,
      recipe_id: selected.type === "halfproduct" ? selected.id : null,
      movement_type: movementType,
      quantity_change: signedQty,
      batch_number: batchNumber.trim() || null,
      expiry_date: expiryDate || null,
      note: note.trim() || null,
    });
    setSaving(false);

    if (insertError) {
      setError("Opslaan mislukt: " + insertError.message);
      return;
    }

    router.push("/voorraad");
  }

  return (
    <>
      <Topbar title="Voorraadmutatie registreren" />
      <main className="max-w-xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Nieuwe mutatie</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Artikel
                </label>
                {selected ? (
                  <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm">
                    <span>
                      {selected.name}{" "}
                      <span className="text-xs text-muted">
                        ({selected.type === "product" ? "product" : "halfproduct"})
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(null);
                        setQuery("");
                        setUnitId("");
                      }}
                      className="text-xs text-teal hover:underline"
                    >
                      Wijzigen
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Zoek product of halfproduct…"
                      className="input"
                    />
                    {selected === null && query.trim().length >= 2 && results.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-lg">
                        {results.map((r) => (
                          <button
                            key={`${r.type}-${r.id}`}
                            type="button"
                            onClick={() => {
                              setSelected(r);
                              setUnitId(r.baseUnitId ?? "");
                            }}
                            className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-background"
                          >
                            {r.name}{" "}
                            <span className="text-xs text-muted">
                              ({r.type === "product" ? "product" : "halfproduct"})
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Type mutatie
                </label>
                <select
                  value={movementType}
                  onChange={(e) => setMovementType(e.target.value as StockMovementType)}
                  className="input"
                >
                  {MOVEMENT_TYPES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label} ({m.sign})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Hoeveelheid
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Eenheid
                  </label>
                  <select
                    value={unitId}
                    onChange={(e) => setUnitId(e.target.value)}
                    className="input"
                  >
                    <option value="">Kies…</option>
                    {unitsForSelected.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Batchnummer (optioneel)
                  </label>
                  <input
                    value={batchNumber}
                    onChange={(e) => setBatchNumber(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Houdbaar tot (optioneel)
                  </label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Opmerking
                </label>
                <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}

              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Opslaan…" : "Mutatie registreren"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => router.push("/voorraad")}>
                  Annuleren
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>

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
    </>
  );
}

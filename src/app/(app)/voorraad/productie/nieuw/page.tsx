"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import type { RecipeIngredient, Unit } from "@/lib/types/database";

interface HalfproductLite {
  id: string;
  name: string;
  base_unit_id: string | null;
  yield_quantity: number | null;
}

interface PreviewLine {
  name: string;
  quantity: number;
  unitName: string;
}

export default function NieuweProductiePage() {
  const router = useRouter();
  const { activeCompanyIds } = useCompanyScope();
  const companyId = activeCompanyIds[0] ?? null;

  const [units, setUnits] = useState<Unit[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HalfproductLite[]>([]);
  const [selected, setSelected] = useState<HalfproductLite | null>(null);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<PreviewLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("units")
      .select("*")
      .then(({ data }) => setUnits((data as Unit[]) ?? []));
  }, []);

  useEffect(() => {
    if (query.trim().length < 2 || selected) return;
    let cancelled = false;
    const timeout = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("recipes")
        .select("id, name, base_unit_id, yield_quantity")
        .eq("recipe_kind", "halfproduct")
        .ilike("name", `%${query}%`)
        .limit(8);
      if (!cancelled) setResults((data as HalfproductLite[]) ?? []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, selected]);

  // Preview van te verbruiken ingrediënten (informatief; de daadwerkelijke
  // afboeking gebeurt server-side door register_recipe_production).
  useEffect(() => {
    if (!selected || !quantity.trim() || Number(quantity) <= 0) return;
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const { data: ingredients } = await supabase
        .from("recipe_ingredients")
        .select("*")
        .eq("recipe_id", selected!.id);
      if (cancelled || !ingredients) return;

      const lines: PreviewLine[] = [];
      for (const ri of ingredients as RecipeIngredient[]) {
        const unit = units.find((u) => u.id === ri.unit_id);
        let name = "onbekend";
        if (ri.product_id) {
          const { data: p } = await supabase
            .from("products")
            .select("name")
            .eq("id", ri.product_id)
            .single();
          name = p?.name ?? name;
        } else if (ri.sub_recipe_id) {
          const { data: r } = await supabase
            .from("recipes")
            .select("name")
            .eq("id", ri.sub_recipe_id)
            .single();
          name = r?.name ?? name;
        }
        lines.push({
          name,
          quantity: ri.quantity * Number(quantity),
          unitName: unit?.name ?? "",
        });
      }
      if (!cancelled) setPreview(lines);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [selected, quantity, units]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!companyId) {
      setError("Selecteer eerst een bedrijf via de bedrijfsselector.");
      return;
    }
    if (!selected || !quantity.trim() || Number(quantity) <= 0) {
      setError("Kies een halfproduct en een geproduceerde hoeveelheid.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("register_recipe_production", {
      p_recipe_id: selected.id,
      p_company_id: companyId,
      p_quantity: Number(quantity),
      p_note: note.trim() || undefined,
    });
    setSaving(false);

    if (rpcError) {
      setError("Registreren mislukt: " + rpcError.message);
      return;
    }

    setSuccess(true);
    setTimeout(() => router.push("/voorraad"), 1200);
  }

  const baseUnitName = selected?.base_unit_id
    ? units.find((u) => u.id === selected.base_unit_id)?.name
    : null;

  return (
    <>
      <Topbar title="Productie registreren" />
      <main className="max-w-xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Nieuwe productie</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Halfproduct
                </label>
                {selected ? (
                  <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm">
                    <span>{selected.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(null);
                        setQuery("");
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
                      placeholder="Zoek halfproduct…"
                      className="input"
                    />
                    {selected === null && query.trim().length >= 2 && results.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-lg">
                        {results.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setSelected(r)}
                            className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-background"
                          >
                            {r.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Geproduceerde hoeveelheid{" "}
                  {baseUnitName && (
                    <span className="text-muted">(in {baseUnitName})</span>
                  )}
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
                  Opmerking
                </label>
                <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
              </div>

              {selected && quantity.trim() && Number(quantity) > 0 && preview.length > 0 && (
                <div className="rounded-md border border-border bg-background p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                    Dit trekt automatisch af van de voorraad:
                  </p>
                  <ul className="space-y-1 text-sm">
                    {preview.map((line, i) => (
                      <li key={i} className="flex justify-between">
                        <span>{line.name}</span>
                        <span className="tabular text-muted">
                          {line.quantity.toLocaleString("nl-NL", {
                            maximumFractionDigits: 2,
                          })}{" "}
                          {line.unitName}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {error && <p className="text-sm text-danger">{error}</p>}
              {success && (
                <p className="text-sm text-success">
                  Productie geregistreerd, voorraad bijgewerkt.
                </p>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Bezig…" : "Productie registreren"}
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

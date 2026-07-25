"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import type { Recipe, Unit } from "@/lib/types/database";

export function HalfproductQuickForm({
  prefillName = "",
  companyId,
  onSaved,
  onCancel,
}: {
  prefillName?: string;
  companyId: string | null;
  onSaved: (recipe: Recipe) => void;
  onCancel: () => void;
}) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [name, setName] = useState(prefillName);
  const [category, setCategory] = useState("");
  const [baseUnitId, setBaseUnitId] = useState("");
  const [yieldQuantity, setYieldQuantity] = useState("");
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

  const unitsByDimension = units.reduce<Record<string, Unit[]>>((acc, u) => {
    acc[u.dimension] = acc[u.dimension] ?? [];
    acc[u.dimension].push(u);
    return acc;
  }, {});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!baseUnitId || !yieldQuantity) {
      setError("Basiseenheid en opbrengst zijn verplicht.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const groupId = await getCurrentGroupId(supabase);
    if (!groupId) {
      setError("Kan groep van gebruiker niet bepalen. Log opnieuw in.");
      setSaving(false);
      return;
    }
    const { data: created, error: insertError } = await supabase
      .from("recipes")
      .insert({
        group_id: groupId,
        name: name.trim(),
        category: category.trim() || null,
        recipe_kind: "halfproduct" as const,
        status: "concept" as const,
        company_id: companyId,
        is_central: !companyId,
        base_unit_id: baseUnitId,
        yield_quantity: Number(yieldQuantity),
      })
      .select("*")
      .single();

    setSaving(false);

    if (insertError || !created) {
      setError("Opslaan mislukt: " + (insertError?.message ?? "onbekende fout"));
      return;
    }

    onSaved(created as Recipe);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-muted">
        Leg hier alleen de basis vast. De ingrediënten van dit halfproduct
        voeg je zo meteen toe door het straks te openen en te bewerken, net
        als een gerecht.
      </p>
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">
          Naam <span className="text-danger">*</span>
        </label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">
          Categorie
        </label>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="bv. saus, dressing, deeg"
          className="input"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Basiseenheid <span className="text-danger">*</span>
          </label>
          <select
            required
            value={baseUnitId}
            onChange={(e) => setBaseUnitId(e.target.value)}
            className="input"
          >
            <option value="">Kies…</option>
            {Object.entries(unitsByDimension).map(([dim, list]) => (
              <optgroup key={dim} label={dim}>
                {list.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Opbrengst <span className="text-danger">*</span>
          </label>
          <input
            required
            type="number"
            step="any"
            value={yieldQuantity}
            onChange={(e) => setYieldQuantity(e.target.value)}
            placeholder="bv. 1000"
            className="input"
          />
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Opslaan…" : "Halfproduct aanmaken"}
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

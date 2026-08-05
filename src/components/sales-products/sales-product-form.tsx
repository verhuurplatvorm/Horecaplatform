"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import type { SalesProduct, SalesProductComponent } from "@/lib/types/database";

interface RecipeLite {
  id: string;
  name: string;
  portion_size: number | null;
}

interface ComponentRow {
  id?: string;
  recipeId: string | null;
  recipeName: string | null;
  portionSize: number | null;
  quantity: string;
}

export interface SalesProductFormProps {
  initialSalesProduct?: SalesProduct;
  initialComponents?: SalesProductComponent[];
}

export function SalesProductForm({
  initialSalesProduct,
  initialComponents = [],
}: SalesProductFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialSalesProduct);
  const { companies, activeCompanyIds } = useCompanyScope();

  const [companyId, setCompanyId] = useState(
    initialSalesProduct?.company_id ?? activeCompanyIds[0] ?? ""
  );
  const [name, setName] = useState(initialSalesProduct?.name ?? "");
  const [category, setCategory] = useState(initialSalesProduct?.category ?? "");
  const [salesPrice, setSalesPrice] = useState(
    initialSalesProduct?.sales_price_incl_vat?.toString() ?? ""
  );
  const [vatRate, setVatRate] = useState(
    initialSalesProduct?.vat_rate?.toString() ?? "9"
  );
  const [posReference, setPosReference] = useState(
    initialSalesProduct?.pos_reference ?? ""
  );
  const [isActive, setIsActive] = useState(
    initialSalesProduct?.is_active ?? true
  );

  const [rows, setRows] = useState<ComponentRow[]>(
    initialComponents.length > 0
      ? initialComponents.map((c) => ({
          id: c.id,
          recipeId: c.recipe_id,
          recipeName: null,
          portionSize: null,
          quantity: String(c.quantity),
        }))
      : [{ recipeId: null, recipeName: null, portionSize: null, quantity: "1" }]
  );

  const [recipeCosts, setRecipeCosts] = useState<Map<string, number>>(
    new Map()
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bij bewerken: namen/portiegroottes van de bestaande gekoppelde
  // recepten ophalen, en meteen hun kostprijs voor dit bedrijf.
  useEffect(() => {
    if (initialComponents.length === 0) return;
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const recipeIds = initialComponents.map((c) => c.recipe_id);
      const { data: recipes } = await supabase
        .from("recipes")
        .select("id, name, portion_size")
        .in("id", recipeIds);
      if (cancelled || !recipes) return;

      const recipeMap = new Map(recipes.map((r) => [r.id, r]));
      setRows((prev) =>
        prev.map((row) => {
          if (row.recipeId && recipeMap.has(row.recipeId)) {
            const r = recipeMap.get(row.recipeId)!;
            return { ...row, recipeName: r.name, portionSize: r.portion_size };
          }
          return row;
        })
      );
      for (const r of recipes) await loadRecipeCost(r.id);
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function loadRecipeCost(recipeId: string) {
    if (!companyId) return;
    const supabase = createClient();
    const { data: cost } = await supabase.rpc("calculate_recipe_cost", {
      p_recipe_id: recipeId,
      p_company_id: companyId,
    });
    setRecipeCosts((prev) => new Map(prev).set(recipeId, cost ?? 0));
  }

  const lineCosts = useMemo(() => {
    return rows.map((row) => {
      const qty = parseFloat(row.quantity);
      if (!row.recipeId || !Number.isFinite(qty)) return null;
      const recipeCost = recipeCosts.get(row.recipeId);
      if (recipeCost === undefined) return null;
      const portionSize = row.portionSize && row.portionSize > 0 ? row.portionSize : 1;
      return qty * (recipeCost / portionSize);
    });
  }, [rows, recipeCosts]);

  const totalCost: number = lineCosts.reduce<number>(
    (sum, c) => (c !== null ? sum + c : sum),
    0
  );
  const priceExclVat =
    salesPrice && vatRate
      ? Number(salesPrice) / (1 + Number(vatRate) / 100)
      : null;
  const foodCostPct =
    priceExclVat && priceExclVat > 0 ? (totalCost / priceExclVat) * 100 : null;
  const marginEuro = priceExclVat !== null ? priceExclVat - totalCost : null;

  function updateRow(index: number, patch: Partial<ComponentRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { recipeId: null, recipeName: null, portionSize: null, quantity: "1" },
    ]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!companyId) {
      setError("Kies een bedrijf.");
      return;
    }
    const validRows = rows.filter((r) => r.recipeId && r.quantity.trim());
    if (validRows.length === 0) {
      setError("Koppel minimaal één receptuur.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const payload = {
      company_id: companyId,
      name: name.trim(),
      category: category.trim() || null,
      sales_price_incl_vat: Number(salesPrice),
      vat_rate: Number(vatRate),
      pos_reference: posReference.trim() || null,
      is_active: isActive,
    };

    let salesProductId = initialSalesProduct?.id;

    if (isEdit && salesProductId) {
      const { error: updateError } = await supabase
        .from("sales_products")
        .update(payload)
        .eq("id", salesProductId);
      if (updateError) {
        setError("Opslaan mislukt: " + updateError.message);
        setSaving(false);
        return;
      }
      await supabase
        .from("sales_product_components")
        .delete()
        .eq("sales_product_id", salesProductId);
    } else {
      const groupId = await getCurrentGroupId(supabase);
      if (!groupId) {
        setError("Kan groep van gebruiker niet bepalen. Log opnieuw in.");
        setSaving(false);
        return;
      }
      const { data: created, error: insertError } = await supabase
        .from("sales_products")
        .insert({ ...payload, group_id: groupId })
        .select("id")
        .single();
      if (insertError || !created) {
        setError("Opslaan mislukt: " + (insertError?.message ?? "onbekende fout"));
        setSaving(false);
        return;
      }
      salesProductId = created.id;
    }

    const { error: componentsError } = await supabase
      .from("sales_product_components")
      .insert(
        validRows.map((r, i) => ({
          sales_product_id: salesProductId,
          recipe_id: r.recipeId,
          quantity: Number(r.quantity),
          sort_order: i,
        }))
      );

    setSaving(false);

    if (componentsError) {
      setError("Verkoopproduct opgeslagen, maar receptkoppeling niet: " + componentsError.message);
      return;
    }

    router.push("/verkoopproducten");
  }

  async function handleDelete() {
    if (!initialSalesProduct) return;
    if (
      !window.confirm(
        `"${initialSalesProduct.name}" definitief verwijderen? Dit kan niet ongedaan worden gemaakt.`
      )
    ) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    const supabase = createClient();
    const { error: deleteErr } = await supabase
      .from("sales_products")
      .delete()
      .eq("id", initialSalesProduct.id);
    setDeleting(false);

    if (deleteErr) {
      setDeleteError("Verwijderen mislukt: " + deleteErr.message);
      return;
    }
    router.push("/verkoopproducten");
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
          <Field label="Bedrijf" required>
            <select
              required
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="input"
              disabled={isEdit}
            >
              <option value="">Kies een bedrijf…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Verkoopnaam" required>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Verkoopcategorie">
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="bv. hoofdgerechten, dranken"
              className="input"
            />
          </Field>
          <Field label="Kassakoppeling (referentie)">
            <input
              value={posReference}
              onChange={(e) => setPosReference(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Verkoopprijs incl. btw" required>
            <input
              required
              type="number"
              step="0.01"
              value={salesPrice}
              onChange={(e) => setSalesPrice(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Btw-percentage" required>
            <input
              required
              type="number"
              step="0.01"
              value={vatRate}
              onChange={(e) => setVatRate(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Status">
            <label className="flex h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Actief
            </label>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Receptcomponenten</CardTitle>
          <Button type="button" variant="secondary" size="sm" onClick={addRow}>
            <Plus className="h-3.5 w-3.5" />
            Component toevoegen
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!companyId && (
            <p className="text-xs text-copper">
              Kies eerst een bedrijf om recepten te kunnen koppelen en live
              kostprijzen te zien.
            </p>
          )}
          {rows.map((row, i) => (
            <div key={i} className="rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  {row.recipeId ? (
                    <span className="text-sm text-foreground">
                      {row.recipeName}
                    </span>
                  ) : (
                    <RecipeSearch
                      onPick={(id, name, portionSize) => {
                        updateRow(i, { recipeId: id, recipeName: name, portionSize });
                        loadRecipeCost(id);
                      }}
                    />
                  )}
                </div>
                <input
                  type="number"
                  step="any"
                  value={row.quantity}
                  onChange={(e) => updateRow(i, { quantity: e.target.value })}
                  className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-xs"
                  placeholder="Aantal"
                />
                <span className="tabular w-24 text-right text-xs font-medium text-foreground">
                  {lineCosts[i] !== null ? `€ ${lineCosts[i]!.toFixed(4)}` : "—"}
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="text-muted hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid grid-cols-3 gap-4 py-4">
          <div>
            <p className="text-sm text-muted">Kostprijs</p>
            <p className="tabular text-xl font-semibold text-foreground">
              € {totalCost.toFixed(4)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted">Foodcost%</p>
            <p className="tabular text-xl font-semibold text-foreground">
              {foodCostPct !== null ? `${foodCostPct.toFixed(1)}%` : "—"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted">Brutomarge (excl. btw)</p>
            <p className="tabular text-xl font-semibold text-foreground">
              {marginEuro !== null ? `€ ${marginEuro.toFixed(2)}` : "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}
      {deleteError && <p className="text-sm text-danger">{deleteError}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Opslaan…" : isEdit ? "Wijzigingen opslaan" : "Verkoopproduct aanmaken"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push("/verkoopproducten")}
        >
          Annuleren
        </Button>
        {isEdit && (
          <Button
            type="button"
            variant="danger"
            disabled={deleting}
            onClick={handleDelete}
            className="ml-auto"
          >
            {deleting ? "Verwijderen…" : "Verwijderen"}
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

function RecipeSearch({
  onPick,
}: {
  onPick: (id: string, name: string, portionSize: number | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecipeLite[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) return;
    let cancelled = false;
    const timeout = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("recipes")
        .select("id, name, portion_size")
        .ilike("name", `%${query}%`)
        .limit(8);
      if (!cancelled) setResults((data as RecipeLite[]) ?? []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  const visible = query.trim().length < 2 ? [] : results;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Zoek receptuur…"
          className="h-8 w-full rounded-md border border-border bg-surface pl-7 pr-2 text-xs"
        />
      </div>
      {visible.length > 0 && (
        <div className="absolute z-10 mt-1 w-72 rounded-md border border-border bg-surface shadow-lg">
          {visible.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.id, r.name, r.portion_size)}
              className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-background"
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

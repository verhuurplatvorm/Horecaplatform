"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import type {
  Recipe,
  RecipeIngredient,
  RecipeStatus,
  Unit,
} from "@/lib/types/database";

interface ProductLite {
  id: string;
  name: string;
  base_unit_id: string | null;
}

interface RecipeLite {
  id: string;
  name: string;
  yield_quantity: number | null;
  yield_unit: string | null;
}

interface IngredientRow {
  id?: string;
  type: "product" | "subrecept";
  productId: string | null;
  productName: string | null;
  subRecipeId: string | null;
  subRecipeName: string | null;
  subRecipeYield: number | null;
  subRecipeYieldUnit: string | null;
  quantity: string;
  unitId: string | null;
  lossPercentage: string;
  note: string;
}

export interface RecipeFormProps {
  initialRecipe?: Recipe;
  initialIngredients?: RecipeIngredient[];
}

export function RecipeForm({
  initialRecipe,
  initialIngredients = [],
}: RecipeFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialRecipe);
  const { activeCompanyIds, scope, companies } = useCompanyScope();

  const referenceCompanyId =
    initialRecipe?.company_id ?? activeCompanyIds[0] ?? null;

  const [units, setUnits] = useState<Unit[]>([]);
  const [name, setName] = useState(initialRecipe?.name ?? "");
  const [category, setCategory] = useState(initialRecipe?.category ?? "");
  const [preparation, setPreparation] = useState(
    initialRecipe?.preparation ?? ""
  );
  const [status, setStatus] = useState<RecipeStatus>(
    initialRecipe?.status ?? "concept"
  );
  const [portionSize, setPortionSize] = useState(
    initialRecipe?.portion_size?.toString() ?? ""
  );
  const [portionUnit, setPortionUnit] = useState(
    initialRecipe?.portion_unit ?? "portie"
  );
  const [yieldQuantity, setYieldQuantity] = useState(
    initialRecipe?.yield_quantity?.toString() ?? ""
  );
  const [yieldUnit, setYieldUnit] = useState(initialRecipe?.yield_unit ?? "");
  const [salesPrice, setSalesPrice] = useState(
    initialRecipe?.sales_price?.toString() ?? ""
  );
  const [scopeChoice, setScopeChoice] = useState<"central" | "company">(
    initialRecipe
      ? initialRecipe.company_id
        ? "company"
        : "central"
      : referenceCompanyId
      ? "company"
      : "central"
  );

  const [rows, setRows] = useState<IngredientRow[]>(
    initialIngredients.length > 0
      ? initialIngredients.map((ri) => ({
          id: ri.id,
          type: ri.sub_recipe_id ? "subrecept" : "product",
          productId: ri.product_id,
          productName: null, // ingevuld door effect hieronder
          subRecipeId: ri.sub_recipe_id,
          subRecipeName: null,
          subRecipeYield: null,
          subRecipeYieldUnit: null,
          quantity: String(ri.quantity),
          unitId: ri.unit_id,
          lossPercentage: ri.loss_percentage?.toString() ?? "",
          note: ri.note ?? "",
        }))
      : [emptyRow()]
  );

  // Cache van live opgehaalde prijzen/kostprijzen, zodat wijzigingen aan
  // hoeveelheden direct herberekenen zonder opnieuw te bevragen.
  const [productPrices, setProductPrices] = useState<
    Map<string, { pricePerBaseUnit: number; baseUnitId: string | null }>
  >(new Map());
  const [subRecipeCosts, setSubRecipeCosts] = useState<Map<string, number>>(
    new Map()
  );

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

  // Bij bewerken: namen van bestaande gekoppelde producten/subrecepten
  // ophalen zodat de picker meteen de juiste naam toont.
  useEffect(() => {
    if (initialIngredients.length === 0) return;
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const productIds = initialIngredients
        .map((r) => r.product_id)
        .filter(Boolean) as string[];
      const subRecipeIds = initialIngredients
        .map((r) => r.sub_recipe_id)
        .filter(Boolean) as string[];

      const [{ data: products }, { data: subRecipes }] = await Promise.all([
        productIds.length
          ? supabase
              .from("products")
              .select("id, name, base_unit_id")
              .in("id", productIds)
          : Promise.resolve({ data: [] as ProductLite[] }),
        subRecipeIds.length
          ? supabase
              .from("recipes")
              .select("id, name, yield_quantity, yield_unit")
              .in("id", subRecipeIds)
          : Promise.resolve({ data: [] as RecipeLite[] }),
      ]);
      if (cancelled) return;

      const productMap = new Map((products ?? []).map((p) => [p.id, p]));
      const recipeMap = new Map((subRecipes ?? []).map((r) => [r.id, r]));

      setRows((prev) =>
        prev.map((row) => {
          if (row.productId && productMap.has(row.productId)) {
            const p = productMap.get(row.productId)!;
            return { ...row, productName: p.name };
          }
          if (row.subRecipeId && recipeMap.has(row.subRecipeId)) {
            const r = recipeMap.get(row.subRecipeId)!;
            return {
              ...row,
              subRecipeName: r.name,
              subRecipeYield: r.yield_quantity,
              subRecipeYieldUnit: r.yield_unit,
            };
          }
          return row;
        })
      );

      // Live prijzen/kostprijzen ook meteen ophalen voor de kostprijsweergave.
      for (const p of products ?? []) await loadProductPrice(p.id);
      for (const r of subRecipes ?? []) await loadSubRecipeCost(r.id);
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProductPrice(productId: string) {
    if (!referenceCompanyId) return;
    const supabase = createClient();
    const [{ data: cost }, { data: product }] = await Promise.all([
      supabase
        .from("current_product_cost")
        .select("price_per_base_unit")
        .eq("product_id", productId)
        .eq("company_id", referenceCompanyId)
        .maybeSingle(),
      supabase.from("products").select("base_unit_id").eq("id", productId).single(),
    ]);
    setProductPrices((prev) => {
      const next = new Map(prev);
      next.set(productId, {
        pricePerBaseUnit: cost?.price_per_base_unit ?? 0,
        baseUnitId: product?.base_unit_id ?? null,
      });
      return next;
    });
  }

  async function loadSubRecipeCost(subRecipeId: string) {
    if (!referenceCompanyId) return;
    const supabase = createClient();
    const { data: cost } = await supabase.rpc("calculate_recipe_cost", {
      p_recipe_id: subRecipeId,
      p_company_id: referenceCompanyId,
    });
    setSubRecipeCosts((prev) => new Map(prev).set(subRecipeId, cost ?? 0));
  }

  const unitsById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  function unitsForDimension(dimensionOfUnitId: string | null) {
    if (!dimensionOfUnitId) return units;
    const dim = unitsById.get(dimensionOfUnitId)?.dimension;
    return dim ? units.filter((u) => u.dimension === dim) : units;
  }

  const lineCosts = useMemo(() => {
    return rows.map((row) => {
      const qty = parseFloat(row.quantity);
      if (!Number.isFinite(qty)) return null;

      if (row.type === "product" && row.productId) {
        const priceInfo = productPrices.get(row.productId);
        if (!priceInfo) return null;
        const chosenUnit = row.unitId ? unitsById.get(row.unitId) : null;
        const baseUnit = priceInfo.baseUnitId
          ? unitsById.get(priceInfo.baseUnitId)
          : null;
        if (!chosenUnit || !baseUnit || chosenUnit.dimension !== baseUnit.dimension) {
          return null; // incompatibele/onbekende eenheid — geen gok wagen
        }
        const factor = chosenUnit.factor_to_base / baseUnit.factor_to_base;
        const lossPct = parseFloat(row.lossPercentage) || 0;
        return qty * factor * priceInfo.pricePerBaseUnit * (1 + lossPct / 100);
      }

      if (row.type === "subrecept" && row.subRecipeId) {
        const subCost = subRecipeCosts.get(row.subRecipeId);
        if (subCost === undefined || !row.subRecipeYield) return null;
        return subCost * (qty / row.subRecipeYield);
      }

      return null;
    });
  }, [rows, productPrices, subRecipeCosts, unitsById]);

  const totalCost: number = lineCosts.reduce<number>(
    (sum, c) => (c !== null ? sum + c : sum),
    0
  );
  const hasIncompleteLines = lineCosts.some((c) => c === null) && rows.some(
    (r) => r.productId || r.subRecipeId
  );

  function updateRow(index: number, patch: Partial<IngredientRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validRows = rows.filter(
      (r) => (r.productId || r.subRecipeId) && r.quantity.trim()
    );
    if (validRows.length === 0) {
      setError("Voeg minimaal één receptregel toe.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const companyId = scopeChoice === "company" ? referenceCompanyId : null;

    const payload = {
      name: name.trim(),
      category: category.trim() || null,
      preparation: preparation.trim() || null,
      status,
      company_id: companyId,
      is_central: scopeChoice === "central",
      portion_size: portionSize ? Number(portionSize) : null,
      portion_unit: portionUnit.trim() || null,
      yield_quantity: yieldQuantity ? Number(yieldQuantity) : null,
      yield_unit: yieldUnit.trim() || null,
      sales_price: salesPrice ? Number(salesPrice) : null,
    };

    let recipeId = initialRecipe?.id;

    if (isEdit && recipeId) {
      const { error: updateError } = await supabase
        .from("recipes")
        .update(payload)
        .eq("id", recipeId);
      if (updateError) {
        setError("Opslaan mislukt: " + updateError.message);
        setSaving(false);
        return;
      }
      await supabase.from("recipe_ingredients").delete().eq("recipe_id", recipeId);
    } else {
      const { data: created, error: insertError } = await supabase
        .from("recipes")
        .insert(payload)
        .select("id")
        .single();
      if (insertError || !created) {
        setError("Opslaan mislukt: " + (insertError?.message ?? "onbekende fout"));
        setSaving(false);
        return;
      }
      recipeId = created.id;
    }

    const { error: linesError } = await supabase.from("recipe_ingredients").insert(
      validRows.map((r, i) => ({
        recipe_id: recipeId,
        product_id: r.type === "product" ? r.productId : null,
        sub_recipe_id: r.type === "subrecept" ? r.subRecipeId : null,
        quantity: Number(r.quantity),
        unit_id: r.type === "product" ? r.unitId : null,
        unit: r.type === "subrecept" ? r.subRecipeYieldUnit ?? "" : "",
        loss_percentage: r.lossPercentage ? Number(r.lossPercentage) : null,
        note: r.note.trim() || null,
        sort_order: i,
      }))
    );

    setSaving(false);

    if (linesError) {
      setError(
        "Receptuur opgeslagen, maar receptregels niet: " + linesError.message +
          (linesError.message.includes("Circulaire")
            ? ""
            : " Controleer op een circulaire subreceptuur.")
      );
      return;
    }

    router.push("/recepturen");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Basisgegevens</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Naam" required>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Categorie">
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="bv. voorgerecht, subreceptuur, drank"
              className="input"
            />
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as RecipeStatus)}
              className="input"
            >
              <option value="concept">Concept</option>
              <option value="goedgekeurd">Goedgekeurd</option>
              <option value="vervallen">Vervallen</option>
            </select>
          </Field>
          <Field label="Bereik">
            <select
              value={scopeChoice}
              onChange={(e) =>
                setScopeChoice(e.target.value as "central" | "company")
              }
              className="input"
            >
              <option value="central">Centrale standaard (alle bedrijven)</option>
              <option value="company" disabled={!referenceCompanyId}>
                Alleen{" "}
                {scope.mode === "group"
                  ? "geselecteerd bedrijf"
                  : companies.find((c) => c.id === referenceCompanyId)?.name ??
                    "dit bedrijf"}
              </option>
            </select>
          </Field>
          <Field label="Bereidingswijze" span2>
            <textarea
              value={preparation}
              onChange={(e) => setPreparation(e.target.value)}
              rows={4}
              className="input"
            />
          </Field>
          <Field label="Portiegrootte">
            <input
              type="number"
              step="any"
              value={portionSize}
              onChange={(e) => setPortionSize(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Portie-eenheid">
            <input
              value={portionUnit}
              onChange={(e) => setPortionUnit(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Opbrengst (voor gebruik als subreceptuur)">
            <input
              type="number"
              step="any"
              value={yieldQuantity}
              onChange={(e) => setYieldQuantity(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Opbrengsteenheid">
            <input
              value={yieldUnit}
              onChange={(e) => setYieldUnit(e.target.value)}
              placeholder="bv. ml, g, porties"
              className="input"
            />
          </Field>
          <Field label="Verkoopprijs (incl. btw)">
            <input
              type="number"
              step="0.01"
              value={salesPrice}
              onChange={(e) => setSalesPrice(e.target.value)}
              className="input"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Receptregels</CardTitle>
          <Button type="button" variant="secondary" size="sm" onClick={addRow}>
            <Plus className="h-3.5 w-3.5" />
            Regel toevoegen
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!referenceCompanyId && (
            <p className="text-xs text-copper">
              Selecteer een bedrijf via de bedrijfsselector rechtsboven om live
              kostprijzen te zien tijdens het invoeren.
            </p>
          )}
          {rows.map((row, i) => (
            <IngredientLine
              key={i}
              row={row}
              units={unitsForDimension(
                row.type === "product" && row.productId
                  ? productPrices.get(row.productId)?.baseUnitId ?? null
                  : null
              )}
              cost={lineCosts[i]}
              currentRecipeId={initialRecipe?.id}
              onChange={(patch) => updateRow(i, patch)}
              onRemove={() => removeRow(i)}
              onProductPicked={(id, name, baseUnitId) => {
                updateRow(i, {
                  productId: id,
                  productName: name,
                  unitId: baseUnitId,
                });
                loadProductPrice(id);
              }}
              onSubRecipePicked={(id, name, yieldQty, yieldUnit) => {
                updateRow(i, {
                  subRecipeId: id,
                  subRecipeName: name,
                  subRecipeYield: yieldQty,
                  subRecipeYieldUnit: yieldUnit,
                });
                loadSubRecipeCost(id);
              }}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <p className="text-sm text-muted">Live kostprijs (schatting)</p>
            <p className="tabular text-xl font-semibold text-foreground">
              € {totalCost.toFixed(4)}
            </p>
            {hasIncompleteLines && (
              <p className="text-xs text-copper">
                Eén of meer regels missen een prijs of geldige eenheid en tellen
                nog niet mee.
              </p>
            )}
          </div>
          {salesPrice && Number(salesPrice) > 0 && (
            <div className="text-right">
              <p className="text-sm text-muted">Foodcost%</p>
              <p className="tabular text-xl font-semibold text-foreground">
                {((totalCost / Number(salesPrice)) * 100).toFixed(1)}%
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Opslaan…" : isEdit ? "Wijzigingen opslaan" : "Receptuur aanmaken"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push("/recepturen")}>
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
        textarea.input {
          height: auto;
          padding: 0.5rem 0.75rem;
        }
      `}</style>
    </form>
  );
}

function emptyRow(): IngredientRow {
  return {
    type: "product",
    productId: null,
    productName: null,
    subRecipeId: null,
    subRecipeName: null,
    subRecipeYield: null,
    subRecipeYieldUnit: null,
    quantity: "",
    unitId: null,
    lossPercentage: "",
    note: "",
  };
}

function Field({
  label,
  required,
  span2,
  children,
}: {
  label: string;
  required?: boolean;
  span2?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : undefined}>
      <label className="mb-1 block text-sm font-medium text-foreground">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}

function IngredientLine({
  row,
  units,
  cost,
  currentRecipeId,
  onChange,
  onRemove,
  onProductPicked,
  onSubRecipePicked,
}: {
  row: IngredientRow;
  units: Unit[];
  cost: number | null;
  currentRecipeId?: string;
  onChange: (patch: Partial<IngredientRow>) => void;
  onRemove: () => void;
  onProductPicked: (id: string, name: string, baseUnitId: string | null) => void;
  onSubRecipePicked: (
    id: string,
    name: string,
    yieldQty: number | null,
    yieldUnit: string | null
  ) => void;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center gap-2">
        <select
          value={row.type}
          onChange={(e) =>
            onChange({
              type: e.target.value as "product" | "subrecept",
              productId: null,
              subRecipeId: null,
            })
          }
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
        >
          <option value="product">Product</option>
          <option value="subrecept">Subreceptuur</option>
        </select>
        <div className="flex-1">
          {row.type === "product" ? (
            row.productId ? (
              <span className="text-sm text-foreground">{row.productName}</span>
            ) : (
              <ProductSearch onPick={onProductPicked} />
            )
          ) : row.subRecipeId ? (
            <span className="text-sm text-foreground">{row.subRecipeName}</span>
          ) : (
            <SubRecipeSearch
              excludeId={currentRecipeId}
              onPick={onSubRecipePicked}
            />
          )}
        </div>
        <button type="button" onClick={onRemove} className="text-muted hover:text-danger">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <input
          type="number"
          step="any"
          placeholder="Hoeveelheid"
          value={row.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
        />
        {row.type === "product" ? (
          <select
            value={row.unitId ?? ""}
            onChange={(e) => onChange({ unitId: e.target.value || null })}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
          >
            <option value="">Eenheid…</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex h-8 items-center px-2 text-xs text-muted">
            {row.subRecipeYieldUnit ?? "eenheid van subrecept"}
          </div>
        )}
        {row.type === "product" && (
          <input
            type="number"
            step="0.01"
            placeholder="Verlies %"
            value={row.lossPercentage}
            onChange={(e) => onChange({ lossPercentage: e.target.value })}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
          />
        )}
        <input
          placeholder="Opmerking"
          value={row.note}
          onChange={(e) => onChange({ note: e.target.value })}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs sm:col-span-2"
        />
        <div className="tabular flex h-8 items-center justify-end text-xs font-medium text-foreground">
          {cost !== null ? `€ ${cost.toFixed(4)}` : "—"}
        </div>
      </div>
    </div>
  );
}

function ProductSearch({
  onPick,
}: {
  onPick: (id: string, name: string, baseUnitId: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductLite[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) return;
    let cancelled = false;
    const timeout = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("products")
        .select("id, name, base_unit_id")
        .ilike("name", `%${query}%`)
        .limit(8);
      if (!cancelled) setResults((data as ProductLite[]) ?? []);
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
          placeholder="Zoek product…"
          className="h-8 w-full rounded-md border border-border bg-surface pl-7 pr-2 text-xs"
        />
      </div>
      {visible.length > 0 && (
        <div className="absolute z-10 mt-1 w-72 rounded-md border border-border bg-surface shadow-lg">
          {visible.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.id, p.name, p.base_unit_id)}
              className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-background"
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SubRecipeSearch({
  excludeId,
  onPick,
}: {
  excludeId?: string;
  onPick: (
    id: string,
    name: string,
    yieldQty: number | null,
    yieldUnit: string | null
  ) => void;
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
        .select("id, name, yield_quantity, yield_unit")
        .ilike("name", `%${query}%`)
        .limit(8);
      if (!cancelled) {
        setResults(
          ((data as RecipeLite[]) ?? []).filter((r) => r.id !== excludeId)
        );
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, excludeId]);

  const visible = query.trim().length < 2 ? [] : results;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Zoek subreceptuur…"
          className="h-8 w-full rounded-md border border-border bg-surface pl-7 pr-2 text-xs"
        />
      </div>
      {visible.length > 0 && (
        <div className="absolute z-10 mt-1 w-72 rounded-md border border-border bg-surface shadow-lg">
          {visible.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.id, r.name, r.yield_quantity, r.yield_unit)}
              className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-background"
            >
              {r.name}
              {r.yield_quantity && (
                <span className="text-muted">
                  {" "}
                  ({r.yield_quantity} {r.yield_unit})
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Package,
  SoupIcon,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { IngredientSearch, type PickedIngredient } from "@/components/recipes/ingredient-search";
import type {
  Recipe,
  RecipeIngredient,
  RecipeKind,
  RecipeStatus,
  Unit,
} from "@/lib/types/database";

interface IngredientRow {
  id?: string;
  type: "product" | "halfproduct";
  refId: string | null;
  refName: string | null;
  baseUnitId: string | null;
  yieldQuantity: number | null;
  quantity: string;
  unitId: string | null;
  lossPercentage: string;
  isOptional: boolean;
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
  const [recipeKind, setRecipeKind] = useState<RecipeKind>(
    initialRecipe?.recipe_kind ?? "gerecht"
  );
  const [name, setName] = useState(initialRecipe?.name ?? "");
  const [category, setCategory] = useState(initialRecipe?.category ?? "");
  const [preparation, setPreparation] = useState(
    initialRecipe?.preparation ?? ""
  );
  const [platingInstructions, setPlatingInstructions] = useState(
    initialRecipe?.plating_instructions ?? ""
  );
  const [photoUrl, setPhotoUrl] = useState(initialRecipe?.photo_url ?? "");
  const [status, setStatus] = useState<RecipeStatus>(
    initialRecipe?.status ?? "concept"
  );
  const [portionUnit, setPortionUnit] = useState(
    initialRecipe?.portion_unit ?? "portie"
  );
  const [baseUnitId, setBaseUnitId] = useState(
    initialRecipe?.base_unit_id ?? ""
  );
  const [yieldQuantity, setYieldQuantity] = useState(
    initialRecipe?.yield_quantity?.toString() ?? ""
  );
  const [salesPrice, setSalesPrice] = useState(
    initialRecipe?.sales_price?.toString() ?? ""
  );
  const [vatRate, setVatRate] = useState(
    initialRecipe?.vat_rate?.toString() ?? "9"
  );
  const [targetFoodCostPct, setTargetFoodCostPct] = useState("30");
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
          type: ri.sub_recipe_id ? "halfproduct" : "product",
          refId: ri.product_id ?? ri.sub_recipe_id,
          refName: null,
          baseUnitId: null,
          yieldQuantity: null,
          quantity: String(ri.quantity),
          unitId: ri.unit_id,
          lossPercentage: ri.loss_percentage?.toString() ?? "",
          isOptional: ri.is_optional,
          note: ri.note ?? "",
        }))
      : [emptyRow()]
  );

  const [productPrices, setProductPrices] = useState<
    Map<string, { pricePerBaseUnit: number; baseUnitId: string | null }>
  >(new Map());
  const [halfproductCosts, setHalfproductCosts] = useState<
    Map<string, { totalCost: number; yieldQuantity: number | null; baseUnitId: string | null }>
  >(new Map());

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

  // Bij bewerken: namen en basiseenheden van bestaande regels ophalen.
  useEffect(() => {
    if (initialIngredients.length === 0) return;
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const productIds = initialIngredients
        .map((r) => r.product_id)
        .filter(Boolean) as string[];
      const halfproductIds = initialIngredients
        .map((r) => r.sub_recipe_id)
        .filter(Boolean) as string[];

      const [{ data: products }, { data: halfproducts }] = await Promise.all([
        productIds.length
          ? supabase.from("products").select("id, name, base_unit_id").in("id", productIds)
          : Promise.resolve({ data: [] }),
        halfproductIds.length
          ? supabase
              .from("recipes")
              .select("id, name, base_unit_id, yield_quantity")
              .in("id", halfproductIds)
          : Promise.resolve({ data: [] }),
      ]);
      if (cancelled) return;

      const productMap = new Map((products ?? []).map((p) => [p.id, p]));
      const halfproductMap = new Map((halfproducts ?? []).map((r) => [r.id, r]));

      setRows((prev) =>
        prev.map((row) => {
          if (row.type === "product" && row.refId && productMap.has(row.refId)) {
            const p = productMap.get(row.refId)!;
            return { ...row, refName: p.name, baseUnitId: p.base_unit_id };
          }
          if (row.type === "halfproduct" && row.refId && halfproductMap.has(row.refId)) {
            const r = halfproductMap.get(row.refId)!;
            return {
              ...row,
              refName: r.name,
              baseUnitId: r.base_unit_id,
              yieldQuantity: r.yield_quantity,
            };
          }
          return row;
        })
      );

      for (const p of products ?? []) await loadProductPrice(p.id);
      for (const r of halfproducts ?? []) await loadHalfproductCost(r.id);
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
    setProductPrices((prev) =>
      new Map(prev).set(productId, {
        pricePerBaseUnit: cost?.price_per_base_unit ?? 0,
        baseUnitId: product?.base_unit_id ?? null,
      })
    );
  }

  async function loadHalfproductCost(recipeId: string) {
    if (!referenceCompanyId) return;
    const supabase = createClient();
    const [{ data: cost }, { data: recipe }] = await Promise.all([
      supabase.rpc("calculate_recipe_cost", {
        p_recipe_id: recipeId,
        p_company_id: referenceCompanyId,
      }),
      supabase
        .from("recipes")
        .select("yield_quantity, base_unit_id")
        .eq("id", recipeId)
        .single(),
    ]);
    setHalfproductCosts((prev) =>
      new Map(prev).set(recipeId, {
        totalCost: cost ?? 0,
        yieldQuantity: recipe?.yield_quantity ?? null,
        baseUnitId: recipe?.base_unit_id ?? null,
      })
    );
  }

  const unitsById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  function unitsForDimension(referenceUnitId: string | null) {
    if (!referenceUnitId) return units;
    const dim = unitsById.get(referenceUnitId)?.dimension;
    return dim ? units.filter((u) => u.dimension === dim) : units;
  }

  const lineCosts = useMemo(() => {
    return rows.map((row) => {
      const qty = parseFloat(row.quantity);
      if (!Number.isFinite(qty) || !row.refId || !row.unitId) return null;
      const chosenUnit = unitsById.get(row.unitId);

      if (row.type === "product") {
        const priceInfo = productPrices.get(row.refId);
        if (!priceInfo) return null;
        const baseUnit = priceInfo.baseUnitId ? unitsById.get(priceInfo.baseUnitId) : null;
        if (!chosenUnit || !baseUnit || chosenUnit.dimension !== baseUnit.dimension) return null;
        const factor = chosenUnit.factor_to_base / baseUnit.factor_to_base;
        const lossPct = parseFloat(row.lossPercentage) || 0;
        return qty * factor * priceInfo.pricePerBaseUnit * (1 + lossPct / 100);
      }

      const hpInfo = halfproductCosts.get(row.refId);
      if (!hpInfo || !hpInfo.yieldQuantity) return null;
      const baseUnit = hpInfo.baseUnitId ? unitsById.get(hpInfo.baseUnitId) : null;
      if (!chosenUnit || !baseUnit || chosenUnit.dimension !== baseUnit.dimension) return null;
      const factor = chosenUnit.factor_to_base / baseUnit.factor_to_base;
      return (qty * factor / hpInfo.yieldQuantity) * hpInfo.totalCost;
    });
  }, [rows, productPrices, halfproductCosts, unitsById]);

  const ingredientCost: number = rows.reduce<number>(
    (sum, row, i) => (row.type === "product" && lineCosts[i] !== null ? sum + lineCosts[i]! : sum),
    0
  );
  const halfproductCost: number = rows.reduce<number>(
    (sum, row, i) => (row.type === "halfproduct" && lineCosts[i] !== null ? sum + lineCosts[i]! : sum),
    0
  );
  const totalCost = ingredientCost + halfproductCost;

  const incompleteLineIndexes = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row, i }) => (row.refId || row.quantity.trim()) && lineCosts[i] === null)
    .map(({ i }) => i);

  // Niet-blokkerende duplicaatwaarschuwing per regel.
  const duplicateIndexes = useMemo(() => {
    const seen = new Map<string, number>();
    const dupes = new Set<number>();
    rows.forEach((row, i) => {
      if (!row.refId) return;
      const key = `${row.type}:${row.refId}`;
      if (seen.has(key)) {
        dupes.add(i);
        dupes.add(seen.get(key)!);
      } else {
        seen.set(key, i);
      }
    });
    return dupes;
  }, [rows]);

  const salesPriceExclEstimate =
    salesPrice && vatRate
      ? Number(salesPrice) / (1 + Number(vatRate) / 100)
      : null;
  const foodCostPct =
    salesPriceExclEstimate && salesPriceExclEstimate > 0
      ? (totalCost / salesPriceExclEstimate) * 100
      : null;
  const marginEuro =
    salesPriceExclEstimate !== null ? salesPriceExclEstimate - totalCost : null;
  const advisedPrice =
    targetFoodCostPct && Number(targetFoodCostPct) > 0
      ? totalCost / (Number(targetFoodCostPct) / 100)
      : null;

  function updateRow(index: number, patch: Partial<IngredientRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function duplicateRow(index: number) {
    setRows((prev) => {
      const copy = { ...prev[index], id: undefined };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
  }

  function moveRow(index: number, direction: -1 | 1) {
    setRows((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function handlePick(index: number, picked: PickedIngredient) {
    updateRow(index, {
      type: picked.type,
      refId: picked.id,
      refName: picked.name,
      baseUnitId: picked.baseUnitId,
      yieldQuantity: picked.yieldQuantity ?? null,
      unitId: picked.baseUnitId,
    });
    if (picked.type === "product") loadProductPrice(picked.id);
    else loadHalfproductCost(picked.id);
  }

  async function handleSubmit(e: React.FormEvent, publishStatus?: RecipeStatus) {
    e.preventDefault();
    setError(null);

    const finalStatus = publishStatus ?? status;
    const validRows = rows.filter((r) => r.refId && r.quantity.trim());

    if (validRows.length === 0) {
      setError("Voeg minimaal één ingrediënt of halfproduct toe.");
      return;
    }

    if (finalStatus === "goedgekeurd" && incompleteLineIndexes.length > 0) {
      setError(
        "Kan niet publiceren: één of meer regels missen een geldige prijs, hoeveelheid of eenheid. Sla op als concept, of vul de ontbrekende gegevens aan."
      );
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const companyId = scopeChoice === "company" ? referenceCompanyId : null;

    const payload = {
      name: name.trim(),
      category: category.trim() || null,
      preparation: preparation.trim() || null,
      plating_instructions: platingInstructions.trim() || null,
      photo_url: photoUrl.trim() || null,
      status: finalStatus,
      recipe_kind: recipeKind,
      company_id: companyId,
      is_central: scopeChoice === "central",
      portion_unit: recipeKind === "gerecht" ? portionUnit.trim() || null : null,
      portion_size: recipeKind === "gerecht" ? 1 : null,
      base_unit_id: recipeKind === "halfproduct" ? baseUnitId || null : null,
      yield_quantity: recipeKind === "halfproduct" ? Number(yieldQuantity) || null : null,
      sales_price: recipeKind === "gerecht" && salesPrice ? Number(salesPrice) : null,
      vat_rate: Number(vatRate),
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
        product_id: r.type === "product" ? r.refId : null,
        sub_recipe_id: r.type === "halfproduct" ? r.refId : null,
        quantity: Number(r.quantity),
        unit_id: r.unitId,
        unit: "",
        loss_percentage: r.lossPercentage ? Number(r.lossPercentage) : null,
        is_optional: r.isOptional,
        note: r.note.trim() || null,
        sort_order: i,
      }))
    );

    setSaving(false);

    if (linesError) {
      setError(
        "Opgeslagen, maar receptregels niet: " +
          linesError.message +
          (linesError.message.toLowerCase().includes("circulair")
            ? ""
            : " Mogelijk een circulaire halfproduct-koppeling.")
      );
      return;
    }

    router.push("/recepturen");
  }

  return (
    <form onSubmit={(e) => handleSubmit(e)} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Basisgegevens</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Soort" required>
            <select
              value={recipeKind}
              onChange={(e) => setRecipeKind(e.target.value as RecipeKind)}
              className="input"
              disabled={isEdit}
            >
              <option value="gerecht">Gerecht (verkoopbaar, per 1 portie)</option>
              <option value="halfproduct">Halfproduct (vooraf bereid)</option>
            </select>
          </Field>
          <Field label="Naam" required>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </Field>
          <Field label="Categorie">
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={
                recipeKind === "gerecht"
                  ? "bv. voorgerecht, hoofdgerecht"
                  : "bv. saus, dressing, deeg"
              }
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
              <option value="goedgekeurd">Actief (gepubliceerd)</option>
              <option value="vervallen">Gearchiveerd</option>
            </select>
          </Field>
          <Field label="Bereik">
            <select
              value={scopeChoice}
              onChange={(e) => setScopeChoice(e.target.value as "central" | "company")}
              className="input"
            >
              <option value="central">Centrale standaard (alle bedrijven)</option>
              <option value="company" disabled={!referenceCompanyId}>
                Alleen{" "}
                {scope.mode === "group"
                  ? "geselecteerd bedrijf"
                  : companies.find((c) => c.id === referenceCompanyId)?.name ?? "dit bedrijf"}
              </option>
            </select>
          </Field>

          {recipeKind === "gerecht" ? (
            <>
              <Field label="Portie-eenheid">
                <input value={portionUnit} onChange={(e) => setPortionUnit(e.target.value)} className="input" />
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
              <Field label="Btw-percentage">
                <select
                  value={vatRate}
                  onChange={(e) => setVatRate(e.target.value)}
                  className="input"
                >
                  <option value="0">0%</option>
                  <option value="9">9%</option>
                  <option value="21">21%</option>
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Basiseenheid" required>
                <select
                  required
                  value={baseUnitId}
                  onChange={(e) => setBaseUnitId(e.target.value)}
                  className="input"
                >
                  <option value="">Kies…</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.dimension})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Opbrengst" required>
                <input
                  required
                  type="number"
                  step="any"
                  value={yieldQuantity}
                  onChange={(e) => setYieldQuantity(e.target.value)}
                  className="input"
                />
              </Field>
            </>
          )}

          <Field label="Foto (URL)">
            <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} className="input" />
          </Field>
          <Field label="Bereidingswijze" span2>
            <textarea
              value={preparation}
              onChange={(e) => setPreparation(e.target.value)}
              rows={3}
              className="input"
            />
          </Field>
          <Field label="Opmaakinstructies" span2>
            <textarea
              value={platingInstructions}
              onChange={(e) => setPlatingInstructions(e.target.value)}
              rows={2}
              className="input"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {recipeKind === "gerecht" ? "Ingrediënten & halfproducten" : "Ingrediënten"}
          </CardTitle>
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
              units={unitsForDimension(row.baseUnitId)}
              cost={lineCosts[i]}
              isDuplicate={duplicateIndexes.has(i)}
              isIncomplete={incompleteLineIndexes.includes(i)}
              companyId={referenceCompanyId}
              onChange={(patch) => updateRow(i, patch)}
              onRemove={() => removeRow(i)}
              onDuplicate={() => duplicateRow(i)}
              onMoveUp={() => moveRow(i, -1)}
              onMoveDown={() => moveRow(i, 1)}
              onPick={(picked) => handlePick(i, picked)}
            />
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setRows((prev) => [...prev, emptyRow()])}
          >
            Regel toevoegen
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Kostprijs ingrediënten" value={`€ ${ingredientCost.toFixed(4)}`} />
            <Stat label="Kostprijs halfproducten" value={`€ ${halfproductCost.toFixed(4)}`} />
            <Stat label="Totale kostprijs" value={`€ ${totalCost.toFixed(4)}`} emphasis />
            <Stat
              label="Foodcost%"
              value={foodCostPct !== null ? `${foodCostPct.toFixed(1)}%` : "—"}
              tone={foodCostPct !== null && foodCostPct > Number(targetFoodCostPct) ? "bad" : "good"}
            />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Brutomarge"
              value={marginEuro !== null ? `€ ${marginEuro.toFixed(2)}` : "—"}
            />
            <div>
              <p className="text-sm text-muted">Gewenst foodcost%</p>
              <input
                type="number"
                step="0.1"
                value={targetFoodCostPct}
                onChange={(e) => setTargetFoodCostPct(e.target.value)}
                className="input h-8 w-20"
              />
            </div>
            <Stat
              label="Adviesverkoopprijs"
              value={advisedPrice !== null ? `€ ${advisedPrice.toFixed(2)}` : "—"}
            />
          </div>
          {incompleteLineIndexes.length > 0 && (
            <p className="flex items-center gap-1 text-xs text-copper">
              <TriangleAlert className="h-3.5 w-3.5" />
              {incompleteLineIndexes.length} regel(s) missen een geldige prijs of
              eenheid en tellen nog niet mee. Publiceren als &quot;actief&quot; is
              hierdoor geblokkeerd.
            </p>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving} onClick={(e) => handleSubmit(e, "concept")}>
          {saving ? "Opslaan…" : "Opslaan als concept"}
        </Button>
        <Button
          type="button"
          disabled={saving}
          onClick={(e) => handleSubmit(e, "goedgekeurd")}
        >
          Opslaan & publiceren
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
    refId: null,
    refName: null,
    baseUnitId: null,
    yieldQuantity: null,
    quantity: "",
    unitId: null,
    lossPercentage: "",
    isOptional: false,
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

function Stat({
  label,
  value,
  emphasis,
  tone,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: "good" | "bad";
}) {
  return (
    <div>
      <p className="text-sm text-muted">{label}</p>
      <p
        className={`tabular font-semibold text-foreground ${emphasis ? "text-xl" : "text-lg"} ${
          tone === "bad" ? "text-danger" : tone === "good" ? "text-success" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function IngredientLine({
  row,
  units,
  cost,
  isDuplicate,
  isIncomplete,
  companyId,
  onChange,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onPick,
}: {
  row: IngredientRow;
  units: Unit[];
  cost: number | null;
  isDuplicate: boolean;
  isIncomplete: boolean;
  companyId: string | null;
  onChange: (patch: Partial<IngredientRow>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPick: (picked: PickedIngredient) => void;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        isDuplicate ? "border-copper/50 bg-copper/5" : "border-border"
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex flex-col gap-0.5">
          <button type="button" onClick={onMoveUp} className="text-muted hover:text-foreground">
            <ArrowUp className="h-3 w-3" />
          </button>
          <button type="button" onClick={onMoveDown} className="text-muted hover:text-foreground">
            <ArrowDown className="h-3 w-3" />
          </button>
        </div>

        <div className="flex-1">
          {row.refId ? (
            <span className="flex items-center gap-2 text-sm text-foreground">
              {row.type === "product" ? (
                <Package className="h-3.5 w-3.5 text-teal" />
              ) : (
                <SoupIcon className="h-3.5 w-3.5 text-copper" />
              )}
              {row.refName}
            </span>
          ) : (
            <IngredientSearch companyId={companyId} onPick={onPick} />
          )}
        </div>

        <button type="button" onClick={onDuplicate} className="text-muted hover:text-teal" title="Dupliceren">
          <Copy className="h-4 w-4" />
        </button>
        <button type="button" onClick={onRemove} className="text-muted hover:text-danger" title="Verwijderen">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {isDuplicate && (
        <p className="mb-2 flex items-center gap-1 text-xs text-copper">
          <TriangleAlert className="h-3 w-3" />
          Dit ingrediënt/halfproduct staat al op een andere regel.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <input
          type="number"
          step="any"
          placeholder="Hoeveelheid"
          value={row.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
        />
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
        {row.type === "product" ? (
          <input
            type="number"
            step="0.01"
            placeholder="Verlies %"
            value={row.lossPercentage}
            onChange={(e) => onChange({ lossPercentage: e.target.value })}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
          />
        ) : (
          <div />
        )}
        <label className="flex h-8 items-center gap-1 text-xs text-muted">
          <input
            type="checkbox"
            checked={row.isOptional}
            onChange={(e) => onChange({ isOptional: e.target.checked })}
          />
          Optioneel
        </label>
        <input
          placeholder="Opmerking"
          value={row.note}
          onChange={(e) => onChange({ note: e.target.value })}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs sm:col-span-1"
        />
        <div
          className={`tabular flex h-8 items-center justify-end text-xs font-medium ${
            isIncomplete ? "text-copper" : "text-foreground"
          }`}
        >
          {cost !== null ? `€ ${cost.toFixed(4)}` : isIncomplete ? "onvolledig" : "—"}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Package,
  SoupIcon,
  Trash2,
  TriangleAlert,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
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
  /** Dwingt het type af (gebruikt door de losse Halfproducten-module) en
   * verbergt de Soort-keuze. */
  lockedKind?: RecipeKind;
}

export function RecipeForm({
  initialRecipe,
  initialIngredients = [],
  lockedKind,
}: RecipeFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialRecipe);
  const { activeCompanyIds, scope, companies } = useCompanyScope();

  const referenceCompanyId =
    initialRecipe?.company_id ?? activeCompanyIds[0] ?? null;

  const [units, setUnits] = useState<Unit[]>([]);
  const [recipeKind, setRecipeKind] = useState<RecipeKind>(
    initialRecipe?.recipe_kind ?? lockedKind ?? "gerecht"
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
  const [storageMethod, setStorageMethod] = useState(
    initialRecipe?.storage_method ?? ""
  );
  const [shelfLifeDays, setShelfLifeDays] = useState(
    initialRecipe?.shelf_life_days?.toString() ?? ""
  );
  const [salesPrice, setSalesPrice] = useState(
    initialRecipe?.sales_price?.toString() ?? ""
  );
  const [vatRate, setVatRate] = useState(
    initialRecipe?.vat_rate?.toString() ?? "9"
  );
  const [targetFoodCostPct, setTargetFoodCostPct] = useState("30");
  const [wastePercentage, setWastePercentage] = useState(
    initialRecipe?.waste_percentage?.toString() ?? "0"
  );
  const [marginFreeCosts, setMarginFreeCosts] = useState(
    initialRecipe?.margin_free_costs?.toString() ?? "0"
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
    Map<
      string,
      {
        pricePerBaseUnit: number;
        baseUnitId: string | null;
        allergens: string[];
        traces: string[];
        nutritionPer100: Record<string, number> | null;
        priceDirection: "up" | "down" | null;
        purchasePrice: number | null;
        packagingDescription: string | null;
      }
    >
  >(new Map());
  const [halfproductCosts, setHalfproductCosts] = useState<
    Map<
      string,
      {
        totalCost: number;
        yieldQuantity: number | null;
        baseUnitId: string | null;
        allergensContains: string[];
        allergensTraces: string[];
        nutritionTotals: Record<string, number>;
      }
    >
  >(new Map());

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
  }, [referenceCompanyId]);

  async function loadProductPrice(productId: string) {
    if (!referenceCompanyId) return;
    const supabase = createClient();
    const [{ data: cost }, { data: product }, { data: history }, { data: activeSupplierPrice }] =
      await Promise.all([
        supabase
          .from("current_product_cost")
          .select("price_per_base_unit")
          .eq("product_id", productId)
          .eq("company_id", referenceCompanyId)
          .maybeSingle(),
        supabase
          .from("products")
          .select("base_unit_id, allergens, contains_traces, nutrition_per_100")
          .eq("id", productId)
          .single(),
        supabase
          .from("price_change_history")
          .select("old_price_per_base_unit, new_price_per_base_unit")
          .eq("product_id", productId)
          .eq("company_id", referenceCompanyId)
          .not("old_price_per_base_unit", "is", null)
          .order("valid_from", { ascending: false })
          .limit(1),
        supabase
          .from("supplier_products")
          .select("purchase_price, packaging_description")
          .eq("product_id", productId)
          .is("valid_to", null)
          .order("valid_from", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
    const latestChange = history?.[0];
    const priceDirection: "up" | "down" | null =
      latestChange?.new_price_per_base_unit != null && latestChange?.old_price_per_base_unit != null
        ? latestChange.new_price_per_base_unit > latestChange.old_price_per_base_unit
          ? "up"
          : latestChange.new_price_per_base_unit < latestChange.old_price_per_base_unit
          ? "down"
          : null
        : null;
    setProductPrices((prev) =>
      new Map(prev).set(productId, {
        pricePerBaseUnit: cost?.price_per_base_unit ?? 0,
        baseUnitId: product?.base_unit_id ?? null,
        allergens: product?.allergens ?? [],
        traces: product?.contains_traces ?? [],
        nutritionPer100: product?.nutrition_per_100 ?? null,
        priceDirection,
        purchasePrice: activeSupplierPrice?.purchase_price ?? null,
        packagingDescription: activeSupplierPrice?.packaging_description ?? null,
      })
    );
  }

  async function loadHalfproductCost(recipeId: string) {
    if (!referenceCompanyId) return;
    const supabase = createClient();
    const [{ data: cost }, { data: recipe }, { data: allergens }, { data: nutrition }] =
      await Promise.all([
        supabase.rpc("calculate_recipe_cost", {
          p_recipe_id: recipeId,
          p_company_id: referenceCompanyId,
        }),
        supabase
          .from("recipes")
          .select("yield_quantity, base_unit_id")
          .eq("id", recipeId)
          .single(),
        supabase.rpc("calculate_recipe_allergens", { p_recipe_id: recipeId }),
        supabase.rpc("calculate_recipe_nutrition", { p_recipe_id: recipeId }),
      ]);
    setHalfproductCosts((prev) =>
      new Map(prev).set(recipeId, {
        totalCost: cost ?? 0,
        yieldQuantity: recipe?.yield_quantity ?? null,
        baseUnitId: recipe?.base_unit_id ?? null,
        allergensContains: allergens?.bevat ?? [],
        allergensTraces: allergens?.sporen ?? [],
        nutritionTotals: nutrition ?? {},
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
  const ingredientAndHalfproductCost = ingredientCost + halfproductCost;
  const wastePct = Number(wastePercentage) || 0;
  const wasteAmount = ingredientAndHalfproductCost * (wastePct / 100);
  const costBeforeMarginFree = ingredientAndHalfproductCost + wasteAmount;
  const marginFreeCostsNum = Number(marginFreeCosts) || 0;
  const totalCost = costBeforeMarginFree + marginFreeCostsNum;

  const allergenSummary = useMemo(() => {
    const contains = new Set<string>();
    const traces = new Set<string>();
    for (const row of rows) {
      if (!row.refId) continue;
      if (row.type === "product") {
        const info = productPrices.get(row.refId);
        info?.allergens.forEach((a) => contains.add(a));
        info?.traces.forEach((a) => traces.add(a));
      } else {
        const info = halfproductCosts.get(row.refId);
        info?.allergensContains.forEach((a) => contains.add(a));
        info?.allergensTraces.forEach((a) => traces.add(a));
      }
    }
    for (const a of contains) traces.delete(a);
    return { contains: [...contains].sort(), traces: [...traces].sort() };
  }, [rows, productPrices, halfproductCosts]);

  const nutritionTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    rows.forEach((row) => {
      if (!row.refId || !row.unitId) return;
      const qty = parseFloat(row.quantity);
      if (!Number.isFinite(qty)) return;
      const chosenUnit = unitsById.get(row.unitId);
      if (!chosenUnit) return;

      if (row.type === "product") {
        const info = productPrices.get(row.refId);
        if (!info?.nutritionPer100 || !info.baseUnitId) return;
        const baseUnit = unitsById.get(info.baseUnitId);
        if (!baseUnit || chosenUnit.dimension !== baseUnit.dimension) return;
        const factor = chosenUnit.factor_to_base / baseUnit.factor_to_base;
        const convertedQty = qty * factor;
        for (const [key, value] of Object.entries(info.nutritionPer100)) {
          totals[key] = (totals[key] ?? 0) + (value * convertedQty) / 100;
        }
      } else {
        const info = halfproductCosts.get(row.refId);
        if (!info || !info.yieldQuantity || !info.baseUnitId) return;
        const baseUnit = unitsById.get(info.baseUnitId);
        if (!baseUnit || chosenUnit.dimension !== baseUnit.dimension) return;
        const factor = chosenUnit.factor_to_base / baseUnit.factor_to_base;
        const convertedQty = qty * factor;
        const ratio = convertedQty / info.yieldQuantity;
        for (const [key, value] of Object.entries(info.nutritionTotals)) {
          totals[key] = (totals[key] ?? 0) + value * ratio;
        }
      }
    });
    return totals;
  }, [rows, productPrices, halfproductCosts, unitsById]);

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
      ? costBeforeMarginFree / (Number(targetFoodCostPct) / 100) + marginFreeCostsNum
      : null;
  const advisedPriceInclVat =
    advisedPrice !== null ? advisedPrice * (1 + Number(vatRate) / 100) : null;

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
      storage_method: recipeKind === "halfproduct" ? storageMethod.trim() || null : null,
      shelf_life_days: recipeKind === "halfproduct" && shelfLifeDays ? Number(shelfLifeDays) : null,
      sales_price: recipeKind === "gerecht" && salesPrice ? Number(salesPrice) : null,
      vat_rate: Number(vatRate),
      waste_percentage: wastePercentage ? Number(wastePercentage) : 0,
      margin_free_costs: marginFreeCosts ? Number(marginFreeCosts) : 0,
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
      const groupId = await getCurrentGroupId(supabase);
      if (!groupId) {
        setError("Kan groep van gebruiker niet bepalen. Log opnieuw in.");
        setSaving(false);
        return;
      }
      const { data: created, error: insertError } = await supabase
        .from("recipes")
        .insert({ ...payload, group_id: groupId })
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

  async function handleDelete() {
    if (!initialRecipe) return;
    const label = initialRecipe.recipe_kind === "gerecht" ? "gerecht" : "halfproduct";
    if (
      !window.confirm(
        `Dit ${label} "${initialRecipe.name}" definitief verwijderen? Dit kan niet ongedaan worden gemaakt.`
      )
    ) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    const supabase = createClient();

    // Een automatisch verkoopproduct (spec: gerecht + prijs + bedrijf)
    // houdt via sales_product_components een koppeling naar dit gerecht
    // vast, en die koppeling is bewust ON DELETE RESTRICT (voorkomt dat
    // een handmatig verkoopproduct stilzwijgend een receptregel verliest).
    // Voor het automatische geval ruimen we dat verkoopproduct zelf eerst
    // op — de trigger heeft het toch alleen voor dít gerecht aangemaakt.
    await supabase
      .from("sales_products")
      .delete()
      .eq("auto_generated_from_recipe_id", initialRecipe.id);

    const { error: deleteErr } = await supabase
      .from("recipes")
      .delete()
      .eq("id", initialRecipe.id);
    setDeleting(false);

    if (deleteErr) {
      setDeleteError(
        deleteErr.code === "23503"
          ? `Dit ${label} wordt nog gebruikt in een handmatig verkoopproduct of een ander recept en kan daarom niet verwijderd worden. Ontkoppel het daar eerst, of zet het op "gearchiveerd".`
          : "Verwijderen mislukt: " + deleteErr.message
      );
      return;
    }
    router.push("/recepturen");
  }

  const basisgegevensCard = (
      <Card>
        <CardHeader>
          <CardTitle>Basisgegevens</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {!lockedKind && (
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
          )}
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
                {scopeChoice === "company" && salesPrice && (
                  <p className="mt-1 text-xs text-muted">
                    Hiermee wordt automatisch een verkoopproduct voor dit
                    bedrijf bijgehouden.
                  </p>
                )}
                {scopeChoice === "central" && salesPrice && (
                  <p className="mt-1 text-xs text-copper">
                    Bij &quot;Centrale standaard&quot; wordt geen automatisch
                    verkoopproduct aangemaakt — kies een specifiek bedrijf
                    bij Bereik, of maak er handmatig een aan bij
                    Verkoopproducten.
                  </p>
                )}
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
              <Field label="Houdbaarheid (dagen)">
                <input
                  type="number"
                  value={shelfLifeDays}
                  onChange={(e) => setShelfLifeDays(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Bewaarmethode" span2>
                <input
                  value={storageMethod}
                  onChange={(e) => setStorageMethod(e.target.value)}
                  placeholder="bv. Gekoeld bewaren bij max. 7°C"
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
  );

  const ingredientenCard = (
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
          {rows.length > 0 && (
            <div className="hidden grid-cols-2 gap-2 px-3 text-xs font-medium uppercase tracking-wide text-muted sm:grid sm:grid-cols-7">
              <span>Hoeveelheid</span>
              <span>Eenheid</span>
              <span>Verlies %</span>
              <span>Optioneel</span>
              <span>Opmerking</span>
              <span className="text-right">Prijs/eenheid</span>
              <span className="text-right">Totale kostprijs</span>
            </div>
          )}
          {rows.map((row, i) => (
            <IngredientLine
              key={i}
              row={row}
              units={unitsForDimension(row.baseUnitId)}
              cost={lineCosts[i]}
              priceDirection={
                row.type === "product" && row.refId
                  ? productPrices.get(row.refId)?.priceDirection ?? null
                  : null
              }
              purchasePrice={
                row.type === "product" && row.refId
                  ? productPrices.get(row.refId)?.purchasePrice ?? null
                  : null
              }
              packagingDescription={
                row.type === "product" && row.refId
                  ? productPrices.get(row.refId)?.packagingDescription ?? null
                  : null
              }
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
  );

  const kostprijsCard = (
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm text-muted">Ingrediëntkosten</p>
              <p className="text-lg font-medium text-foreground">
                € {ingredientAndHalfproductCost.toFixed(4)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted">Afval% (algemeen)</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={wastePercentage}
                  onChange={(e) => setWastePercentage(e.target.value)}
                  className="input h-8 w-20"
                />
                <span className="text-xs text-muted">
                  = € {wasteAmount.toFixed(4)}
                </span>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted">Margevrije kosten (€)</p>
              <input
                type="number"
                step="0.01"
                min="0"
                value={marginFreeCosts}
                onChange={(e) => setMarginFreeCosts(e.target.value)}
                className="input h-8 w-24"
              />
              <p className="mt-0.5 text-xs text-muted">
                telt mee in kostprijs, niet in de marge
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-border pt-3 sm:grid-cols-3">
            <Stat label="Totale kostprijs" value={`€ ${totalCost.toFixed(4)}`} emphasis />
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
              label="Adviesverkoopprijs (incl. btw)"
              value={
                advisedPriceInclVat !== null
                  ? `€ ${advisedPriceInclVat.toFixed(2)}`
                  : "—"
              }
              emphasis
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              label="Verkoopprijs (incl. btw)"
              value={salesPrice ? `€ ${Number(salesPrice).toFixed(2)}` : "—"}
            />
            <Stat
              label="Foodcost%"
              value={foodCostPct !== null ? `${foodCostPct.toFixed(1)}%` : "—"}
              tone={foodCostPct !== null && foodCostPct > Number(targetFoodCostPct) ? "bad" : "good"}
            />
            <Stat
              label="Brutomarge (excl. btw)"
              value={marginEuro !== null ? `€ ${marginEuro.toFixed(2)}` : "—"}
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

          {totalCost > 0 && <CostPieChart rows={rows} lineCosts={lineCosts} totalCost={totalCost} />}
        </CardContent>
      </Card>
  );

  const allergenenCard = (
      <Card>
        <CardHeader>
          <CardTitle>Allergenen &amp; voedingswaarden (automatisch)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">Bevat</p>
              {allergenSummary.contains.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {allergenSummary.contains.map((a) => (
                    <span
                      key={a}
                      className="rounded-full bg-danger/10 px-2 py-0.5 text-xs capitalize text-danger"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">Geen bekende allergenen</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">
                Kan sporen bevatten van
              </p>
              {allergenSummary.traces.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {allergenSummary.traces.map((a) => (
                    <span
                      key={a}
                      className="rounded-full bg-copper/10 px-2 py-0.5 text-xs capitalize text-copper"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">Geen bekende sporen</p>
              )}
            </div>
          </div>

          {Object.keys(nutritionTotals).length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">
                Voedingswaarden{" "}
                {recipeKind === "gerecht" ? "per portie" : "per volledige batch"}
              </p>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {Object.entries(nutritionTotals).map(([key, value]) => (
                  <div key={key}>
                    <p className="text-xs capitalize text-muted">
                      {key.replace(/_/g, " ")}
                    </p>
                    <p className="tabular font-medium text-foreground">
                      {value.toFixed(1)}
                      {key === "energie" ? " kcal" : " g"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
  );

  const gebruiktInCard =
    isEdit && recipeKind === "halfproduct" && initialRecipe ? (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Gebruikt in</CardTitle>
          <div className="flex gap-2">
            <Link href={`/halfproducten/${initialRecipe.id}/producties`}>
              <Button type="button" variant="secondary" size="sm">
                Producties
              </Button>
            </Link>
            <Link href={`/halfproducten/${initialRecipe.id}/sticker/nieuw`}>
              <Button type="button" variant="secondary" size="sm">
                Sticker afdrukken
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <UsageList recipeId={initialRecipe.id} companyId={referenceCompanyId} />
        </CardContent>
      </Card>
    ) : null;

  const errorBlock = (
    <>
      {error && <p className="text-sm text-danger">{error}</p>}
      {deleteError && <p className="text-sm text-danger">{deleteError}</p>}
    </>
  );

  const buttonsBlock = (
    <div className="flex gap-2">
      <Button type="submit" disabled={saving} onClick={(e) => handleSubmit(e, "concept")}>
        {saving ? "Opslaan…" : "Opslaan als concept"}
      </Button>
      <Button type="button" disabled={saving} onClick={(e) => handleSubmit(e, "goedgekeurd")}>
        Opslaan & publiceren
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={() => router.push(recipeKind === "halfproduct" ? "/halfproducten" : "/recepturen")}
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
  );

  return (
    <form onSubmit={(e) => handleSubmit(e)} className="space-y-4">
      {recipeKind === "halfproduct" ? (
        <>
          {/* Het volledige recept (ingrediënten + kostprijs) linksboven,
              zodat het meteen zichtbaar is — de rest ernaast. */}
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-start">
            <div className="space-y-4">
              {ingredientenCard}
              {kostprijsCard}
            </div>
            <div className="space-y-4">
              {basisgegevensCard}
              {allergenenCard}
              {gebruiktInCard}
            </div>
          </div>
          {errorBlock}
          {buttonsBlock}
        </>
      ) : (
        <>
          {basisgegevensCard}
          {ingredientenCard}
          {kostprijsCard}
          {allergenenCard}
          {gebruiktInCard}
          {errorBlock}
          {buttonsBlock}
        </>
      )}

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

const PIE_COLORS = [
  "#0f766e", // teal
  "#b45309", // copper
  "#16a34a", // success
  "#dc2626", // danger
  "#7c3aed",
  "#0891b2",
  "#ca8a04",
  "#db2777",
  "#4f46e5",
  "#65a30d",
];

/** Kostprijs-taartdiagram: verdeling van de totale kostprijs over de
 * ingrediënten/halfproducten, puur SVG (geen extra library nodig). */
function CostPieChart({
  rows,
  lineCosts,
  totalCost,
}: {
  rows: IngredientRow[];
  lineCosts: (number | null)[];
  totalCost: number;
}) {
  const slices = rows
    .map((row, i) => ({
      label: row.refName ?? "Onbekend",
      cost: lineCosts[i] ?? 0,
    }))
    .filter((s) => s.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  if (slices.length === 0 || totalCost <= 0) return null;

  const radius = 60;
  const cx = 70;
  const cy = 70;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const startAngles = slices.reduce<number[]>((acc, slice, i) => {
    const prevEnd = i === 0 ? -90 : acc[i - 1] + (slices[i - 1].cost / totalCost) * 360;
    acc.push(prevEnd);
    return acc;
  }, []);

  const paths = slices.map((slice, i) => {
    const fraction = slice.cost / totalCost;
    const angle = fraction * 360;
    const startAngle = startAngles[i];
    const endAngle = startAngle + angle;

    const x1 = cx + radius * Math.cos(toRad(startAngle));
    const y1 = cy + radius * Math.sin(toRad(startAngle));
    const x2 = cx + radius * Math.cos(toRad(endAngle));
    const y2 = cy + radius * Math.sin(toRad(endAngle));
    const largeArc = angle > 180 ? 1 : 0;

    // Eén ingrediënt dat de hele kostprijs is: gewone cirkel i.p.v. een
    // ontaarde taartpunt (SVG-arcs kunnen geen volledige 360° in één pad).
    const d =
      fraction >= 0.9999
        ? `M ${cx - radius} ${cy} A ${radius} ${radius} 0 1 1 ${cx + radius} ${cy} A ${radius} ${radius} 0 1 1 ${cx - radius} ${cy} Z`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;

    return { d, color: PIE_COLORS[i % PIE_COLORS.length], label: slice.label, fraction };
  });

  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
      <svg viewBox="0 0 140 140" className="h-32 w-32 shrink-0">
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.color} stroke="var(--surface)" strokeWidth="1" />
        ))}
      </svg>
      <ul className="space-y-1 text-xs">
        {paths.slice(0, 8).map((p, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: p.color }}
            />
            <span className="text-foreground">{p.label}</span>
            <span className="text-muted">({(p.fraction * 100).toFixed(0)}%)</span>
          </li>
        ))}
        {paths.length > 8 && (
          <li className="text-muted">+ {paths.length - 8} andere</li>
        )}
      </ul>
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
  priceDirection,
  purchasePrice,
  packagingDescription,
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
  priceDirection?: "up" | "down" | null;
  purchasePrice?: number | null;
  packagingDescription?: string | null;
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
  const qty = parseFloat(row.quantity);
  const pricePerUnit =
    cost !== null && Number.isFinite(qty) && qty > 0 ? cost / qty : null;
  const unitName = units.find((u) => u.id === row.unitId)?.name ?? null;

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
            <div>
              <span className="flex items-center gap-2 text-sm text-foreground">
                {row.type === "product" ? (
                  <Package className="h-3.5 w-3.5 text-teal" />
                ) : (
                  <SoupIcon className="h-3.5 w-3.5 text-copper" />
                )}
                {row.refName}
                {row.type === "halfproduct" && (
                  <Link
                    href={`/halfproducten/${row.refId}/bewerken`}
                    target="_blank"
                    className="text-xs text-teal hover:underline"
                  >
                    Halfproduct openen →
                  </Link>
                )}
              </span>
              {row.type === "product" && (purchasePrice != null || packagingDescription) && (
                <p className="ml-5 text-xs text-muted">
                  {packagingDescription ?? "onbekende verpakking"}
                  {purchasePrice != null && ` · € ${purchasePrice.toFixed(2)} inkoop`}
                </p>
              )}
            </div>
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
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
        <div className="tabular flex h-8 items-center justify-end text-xs text-muted">
          {cost !== null && pricePerUnit !== null
            ? `€ ${pricePerUnit.toFixed(4)} / ${unitName ?? "eenh."}`
            : "—"}
        </div>
        <div
          className={`tabular flex h-8 items-center justify-end gap-1 text-xs font-medium ${
            isIncomplete ? "text-copper" : "text-foreground"
          }`}
        >
          {priceDirection === "up" && (
            <TrendingUp className="h-3 w-3 shrink-0 text-danger" aria-label="Prijs recent gestegen" />
          )}
          {priceDirection === "down" && (
            <TrendingDown className="h-3 w-3 shrink-0 text-success" aria-label="Prijs recent gedaald" />
          )}
          {cost !== null ? `€ ${cost.toFixed(4)}` : isIncomplete ? "onvolledig" : "—"}
        </div>
      </div>
    </div>
  );
}

interface UsageRow {
  using_recipe_id: string;
  using_recipe_name: string;
  using_recipe_kind: RecipeKind;
  company_name: string | null;
  quantity: number;
  unit_name: string | null;
  cost_contribution: number | null;
}

function UsageList({
  recipeId,
  companyId,
}: {
  recipeId: string;
  companyId: string | null;
}) {
  const [rows, setRows] = useState<UsageRow[] | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .rpc("get_recipe_usage", { p_recipe_id: recipeId, p_company_id: companyId })
      .then(({ data }) => {
        if (!cancelled) setRows((data as UsageRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [recipeId, companyId]);

  if (!companyId) {
    return (
      <p className="text-sm text-muted">
        Selecteer een bedrijf via de bedrijfsselector rechtsboven om te zien
        waar dit halfproduct gebruikt wordt.
      </p>
    );
  }

  if (rows === null) {
    return <p className="text-sm text-muted">Laden…</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted">
        Dit halfproduct wordt nog nergens in gebruikt.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border text-sm">
      {rows.map((r) => (
        <li key={r.using_recipe_id} className="flex items-center justify-between py-2">
          <Link
            href={
              r.using_recipe_kind === "halfproduct"
                ? `/halfproducten/${r.using_recipe_id}/bewerken`
                : `/recepturen/${r.using_recipe_id}/bewerken`
            }
            className="flex items-center gap-2 text-teal hover:underline"
          >
            {r.using_recipe_kind === "halfproduct" ? (
              <SoupIcon className="h-3.5 w-3.5" />
            ) : (
              <Package className="h-3.5 w-3.5" />
            )}
            {r.using_recipe_name}
          </Link>
          <span className="tabular text-muted">
            {r.quantity} {r.unit_name ?? ""}
            {r.company_name && ` · ${r.company_name}`}
            {r.cost_contribution !== null &&
              ` · € ${r.cost_contribution.toFixed(4)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}


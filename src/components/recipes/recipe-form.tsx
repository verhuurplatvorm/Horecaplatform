"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
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
import { usePermissions } from "@/components/permissions/permissions-context";
import { convertQuantity } from "@/lib/units/convert";
import { approximateMeasure, halfproductLineCost, ingredientLineCost, recipeTotals } from "@/lib/costing";
import { RecipeHistory } from "@/components/recipes/recipe-history";
import { RecipeFinancialTable } from "@/components/recipes/recipe-financial-table";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { IngredientSearch, type PickedIngredient } from "@/components/recipes/ingredient-search";
import { IngredientTextInput } from "@/components/recipes/ingredient-text-input";
import {
  parseIngredientText,
  type ParsedIngredientLine,
} from "@/lib/recipes/parse-ingredient-line";
import type {
  Recipe,
  RecipeIngredient,
  RecipeKind,
  RecipeStatus,
  Unit,
} from "@/lib/types/database";

let rowUidCounter = 0;
/** Vaste sleutel per regel in het scherm (niet opgeslagen), zodat een regel
 * die nog gezocht wordt altijd de juiste blijft, ook als er intussen regels
 * bijkomen of wegvallen. */
function newRowUid() {
  rowUidCounter += 1;
  return `r${rowUidCounter}`;
}

/** Voortgang van de automatische herkenning van een uit tekst ingevoerde regel. */
type MatchState = "zoekt" | "meerdere" | "onbekend";

interface IngredientRow {
  uid: string;
  matchState?: MatchState;
  id?: string;
  type: "ingrediënt" | "halfproduct";
  refId: string | null;
  refName: string | null;
  unmatchedName: string | null;
  unmatchedArticleNumber: string | null;
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

const EU_ALLERGENS = [
  "gluten","schaaldieren","eieren","vis","pinda","soja","melk",
  "noten","selderij","mosterd","sesam","sulfiet","lupine","weekdieren",
] as const;

export function RecipeForm({
  initialRecipe,
  initialIngredients = [],
  lockedKind,
}: RecipeFormProps) {
  const router = useRouter();
  // Terug naar waar dit recept/halfproduct vandaan geopend is — vanuit
  // een menu, een ander recept of het overzicht.
  const goBack = useReturnNavigation(
    (initialRecipe?.recipe_kind ?? lockedKind) === "halfproduct"
      ? "/halfproducten"
      : "/recepturen"
  );
  const isEdit = Boolean(initialRecipe);
  const { activeCompanyIds, scope, companies } = useCompanyScope();
  const { can } = usePermissions();

  const referenceCompanyId =
    initialRecipe?.company_id ?? activeCompanyIds[0] ?? null;

  const [units, setUnits] = useState<Unit[]>([]);
  const [recipeKind, setRecipeKind] = useState<RecipeKind>(
    initialRecipe?.recipe_kind ?? lockedKind ?? "gerecht"
  );
  const canViewFinancial = can(
    recipeKind === "halfproduct" ? "halfproducten" : "recepturen"
  ).canViewFinancial;
  const [formTab, setFormTab] = useState<"algemeen" | "financieel" | "voeding" | "galerij" | "gebruikt" | "historie">("algemeen");
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
  // Handmatig = de kok bepaalt de eindopbrengst (leidend, nooit overschreven);
  // automatisch = de opbrengst volgt de som van de ingrediënten. Een nieuw
  // halfproduct start automatisch, een bestaand houdt wat het had.
  const [yieldManual, setYieldManual] = useState<boolean>(
    initialRecipe ? initialRecipe.yield_is_manual ?? true : false
  );
  const [lossDraft, setLossDraft] = useState<string | null>(null);
  // Verlies/reductie in % t.o.v. de beginhoeveelheid. In de automatische stand
  // is de opbrengst = som van de ingrediënten × (1 − verlies). Wordt bij het
  // openen afgeleid uit de opgeslagen opbrengst.
  const [lossPct, setLossPct] = useState(0);
  // Beginhoeveelheid die de kok zelf invult als het systeem hem niet kan
  // berekenen (bv. liters en kilo's door elkaar). Alleen om het verlies-% en
  // de bruikbare hoeveelheid aan elkaar te koppelen; wordt niet opgeslagen.
  const [manualBegin, setManualBegin] = useState("");
  // Bij stuks-regels zonder bekend gewicht: de kok geeft bij benadering op
  // hoeveel gram/ml die regel samen is (uid → getal). Alleen voor de som.
  const [stukEstimates, setStukEstimates] = useState<Record<string, string>>({});
  const [yieldQuantity, setYieldQuantity] = useState(
    initialRecipe?.yield_quantity?.toString() ?? ""
  );
  const [labourKitchen, setLabourKitchen] = useState(
    initialRecipe?.labour_minutes_kitchen?.toString() ?? ""
  );
  const [labourOther, setLabourOther] = useState(
    initialRecipe?.labour_minutes_other?.toString() ?? ""
  );
  const [labourRate, setLabourRate] = useState(
    initialRecipe?.labour_cost_per_hour?.toString() ?? ""
  );
  const [productionLocation, setProductionLocation] = useState(
    initialRecipe?.production_location ?? ""
  );
  const [recipeSynonyms, setRecipeSynonyms] = useState(
    (initialRecipe?.synonyms ?? []).join(", ")
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
          uid: newRowUid(),
          id: ri.id,
          type: ri.sub_recipe_id ? "halfproduct" : "ingrediënt",
          refId: ri.product_id ?? ri.sub_recipe_id,
          refName: null,
          unmatchedName: ri.unmatched_name,
          unmatchedArticleNumber: ri.unmatched_article_number,
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
        avgUnitQuantity: number | null;
        avgUnitId: string | null;
        netUnitQuantity: number | null;
        defaultLossPct: number | null;
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

  // Weergave van de voedingswaarden: het hele halfproduct, per 100
  // basiseenheden, of per portie. Puur een deelfactor — de onderliggende
  // berekening blijft dezelfde.
  const [nutritionView, setNutritionView] = useState<"totaal" | "per100" | "portie">(
    "totaal"
  );
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
          ? supabase
              .from("products")
              .select("id, name, custom_name, base_unit_id")
              .in("id", productIds)
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
          if (row.type === "ingrediënt" && row.refId && productMap.has(row.refId)) {
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
          .select("base_unit_id, avg_unit_quantity, avg_unit_id, net_unit_quantity, default_loss_percentage, allergens, contains_traces, nutrition_per_100")
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
        avgUnitQuantity: product?.avg_unit_quantity ?? null,
        avgUnitId: product?.avg_unit_id ?? null,
        netUnitQuantity: product?.net_unit_quantity ?? null,
        defaultLossPct: product?.default_loss_percentage ?? null,
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

  // Eenheden die voor een regel te kiezen zijn: dezelfde dimensie als de
  // basiseenheid van het ingrediënt — én, als het ingrediënt een brug
  // heeft ("1 stuk = 95 gram"), ook "stuk" bij een gewicht/inhoud-basis
  // of juist de brug-dimensie bij een stuk-basis.
  /**
   * Beschrijft in gewone taal welke conversiefactor de kostprijs van een
   * regel bepaalt — alleen relevant als de regel-eenheid in een andere
   * dimensie staat dan de basiseenheid van het ingrediënt.
   */
  function describeConversion(
    info:
      | {
          baseUnitId: string | null;
          avgUnitQuantity: number | null;
          avgUnitId: string | null;
          netUnitQuantity: number | null;
        }
      | undefined,
    lineUnit: { dimension: string } | null | undefined,
    unitMap: Map<string, Unit>
  ): string | null {
    if (!info?.avgUnitQuantity || !info.avgUnitId || !lineUnit) return null;
    const baseUnit = info.baseUnitId ? unitMap.get(info.baseUnitId) : null;
    if (!baseUnit || baseUnit.dimension === lineUnit.dimension) return null;
    const avgUnitName = unitMap.get(info.avgUnitId)?.name ?? "";
    if (info.netUnitQuantity) {
      return `1 stuk = ${info.netUnitQuantity} ${avgUnitName} bruikbaar (van ${info.avgUnitQuantity} ${avgUnitName} bruto)`;
    }
    return `1 stuk = ${info.avgUnitQuantity} ${avgUnitName}`;
  }

  function unitsForDimension(referenceUnitId: string | null, productRefId?: string | null) {
    if (!referenceUnitId) return units;
    const ref = unitsById.get(referenceUnitId);
    if (!ref) return units;
    const bridge = productRefId ? productPrices.get(productRefId) : null;
    const avgUnit = bridge?.avgUnitId ? unitsById.get(bridge.avgUnitId) : null;
    const hasBridge = !!(bridge?.avgUnitQuantity && avgUnit);
    return units.filter((u) => {
      if (u.dimension === ref.dimension) return true;
      if (!hasBridge) return false;
      if (ref.dimension === "aantal") return u.dimension === avgUnit!.dimension;
      return u.dimension === "aantal" && avgUnit!.dimension === ref.dimension;
    });
  }

  const lineCosts = useMemo(() => {
    return rows.map((row) => {
      const qty = parseFloat(row.quantity);
      if (!Number.isFinite(qty) || !row.refId || !row.unitId) return null;
      const chosenUnit = unitsById.get(row.unitId);

      if (row.type === "ingrediënt") {
        const priceInfo = productPrices.get(row.refId);
        if (!priceInfo) return null;
        const explicitLoss = row.lossPercentage.trim() === "" ? null : parseFloat(row.lossPercentage);
        return ingredientLineCost({
          quantity: qty,
          unit: chosenUnit,
          baseUnit: priceInfo.baseUnitId ? unitsById.get(priceInfo.baseUnitId) : null,
          info: priceInfo,
          unitsById,
          lineLossPct: Number.isFinite(explicitLoss as number) ? (explicitLoss as number) : null,
        });
      }

      const hpInfo = halfproductCosts.get(row.refId);
      if (!hpInfo) return null;
      return halfproductLineCost({
        quantity: qty,
        unit: chosenUnit,
        baseUnit: hpInfo.baseUnitId ? unitsById.get(hpInfo.baseUnitId) : null,
        yieldQuantity: hpInfo.yieldQuantity,
        totalCost: hpInfo.totalCost,
        unitsById,
      });
    });
  }, [rows, productPrices, halfproductCosts, unitsById]);

  const ingredientCost: number = rows.reduce<number>(
    (sum, row, i) => (row.type === "ingrediënt" && lineCosts[i] !== null ? sum + lineCosts[i]! : sum),
    0
  );
  const halfproductCost: number = rows.reduce<number>(
    (sum, row, i) => (row.type === "halfproduct" && lineCosts[i] !== null ? sum + lineCosts[i]! : sum),
    0
  );
  const wastePct = Number(wastePercentage) || 0;
  const marginFreeCostsNum = Number(marginFreeCosts) || 0;
  const yieldQuantityNum = Number(yieldQuantity) || 0;
  const {
    lines: ingredientAndHalfproductCost,
    wasteAmount,
    costBeforeMarginFree,
    totalCost,
    costPerBaseUnit,
  } = recipeTotals({
    ingredientCost,
    halfproductCost,
    wastePct,
    marginFreeCosts: marginFreeCostsNum,
    yieldQuantity: yieldQuantityNum,
    isHalfproduct: recipeKind === "halfproduct",
  });
  const baseUnitName = baseUnitId ? unitsById.get(baseUnitId)?.name ?? null : null;

  // Naast de prijs per basiseenheid (ml/gram) ook de prijs per liter/kilo
  // tonen wanneer dat een zinvolle, andere eenheid is — makkelijker te
  // vergelijken met leveranciersprijzen die meestal per liter/kilo staan.
  const LARGER_UNIT_KEY: Record<string, { key: string; factor: number }> = {
    ml: { key: "l", factor: 1000 },
    milliliter: { key: "l", factor: 1000 },
    g: { key: "kg", factor: 1000 },
    gram: { key: "kg", factor: 1000 },
  };
  const baseUnit = baseUnitId ? unitsById.get(baseUnitId) : null;
  const largerUnitDef = baseUnit
    ? LARGER_UNIT_KEY[baseUnit.key] ?? LARGER_UNIT_KEY[baseUnit.name.toLowerCase()]
    : null;
  const largerUnit = largerUnitDef
    ? units.find((u) => u.key === largerUnitDef.key)
    : null;
  const costPerLargerUnit =
    costPerBaseUnit !== null && largerUnitDef ? costPerBaseUnit * largerUnitDef.factor : null;

  // Som van de ingrediënten in de eigen basiseenheid van dit recept —
  // alleen regels met dezelfde dimensie (bv. allemaal inhoud, of
  // allemaal gewicht) tellen mee, net als bij de "Totale hoeveelheid"
  // hierboven. Gebruikt om "Opbrengst" automatisch voor te stellen.
  // Per regel: hoeveel dat is in de basiseenheid van dit recept. Eerst de
  // exacte omrekening; lukt die niet, dan "in de buurt": gewicht en inhoud
  // worden 1 gram ≈ 1 ml gelijkgesteld (voor een verloren-% schatting, niet
  // voor kostprijzen van ingrediënten), en een stuks-regel gebruikt het
  // gram/ml-getal dat de kok zelf opgaf.
  const yieldLines = useMemo(() => {
    const targetUnit = baseUnitId ? unitsById.get(baseUnitId) : null;
    const out: { uid: string; name: string; value: number | null; approx: boolean; needsEstimate: boolean; stuk?: boolean }[] = [];
    if (!targetUnit) return out;
    for (const row of rows) {
      if (isEmptyRow(row) || !row.quantity.trim()) continue;
      const qty = parseFloat(row.quantity);
      const rowUnit = row.unitId ? unitsById.get(row.unitId) : null;
      if (!Number.isFinite(qty) || !rowUnit) {
        out.push({ uid: row.uid, name: row.refName ?? "regel", value: null, approx: false, needsEstimate: false });
        continue;
      }
      const bridge = row.type === "ingrediënt" && row.refId ? productPrices.get(row.refId) : null;
      const exact = convertQuantity(qty, rowUnit, targetUnit, bridge, unitsById);
      if (exact !== null) {
        out.push({ uid: row.uid, name: row.refName ?? "regel", value: exact, approx: false, needsEstimate: false });
        continue;
      }
      const approx = approximateMeasure(qty, rowUnit, targetUnit);
      if (approx !== null) {
        out.push({ uid: row.uid, name: row.refName ?? "regel", value: approx, approx: true, needsEstimate: false });
        continue;
      }
      const targetIsMeasure = targetUnit.dimension === "gewicht" || targetUnit.dimension === "inhoud";
      if (rowUnit.dimension === "aantal" && row.refId && targetIsMeasure && targetUnit.factor_to_base) {
        const est = Number((stukEstimates[row.uid] ?? "").replace(",", "."));
        if (est > 0) {
          out.push({
            uid: row.uid,
            name: row.refName ?? "regel",
            value: est / targetUnit.factor_to_base,
            approx: true,
            needsEstimate: false,
            stuk: true,
          });
        } else {
          out.push({ uid: row.uid, name: row.refName ?? "regel", value: null, approx: false, needsEstimate: true, stuk: true });
        }
        continue;
      }
      out.push({ uid: row.uid, name: row.refName ?? "regel", value: null, approx: false, needsEstimate: false });
    }
    return out;
  }, [rows, baseUnitId, unitsById, productPrices, stukEstimates]);

  const computedYieldFromIngredients = useMemo(() => {
    const known = yieldLines.filter((l) => l.value !== null);
    return known.length > 0 ? known.reduce((sum, l) => sum + (l.value as number), 0) : null;
  }, [yieldLines]);
  const yieldIsApproximate = yieldLines.some((l) => l.approx);

  // Regels die echt niet in de som kunnen (onvolledig of stuks zonder opgegeven gram/ml).
  const yieldSkippedCount = yieldLines.filter((l) => l.value === null).length;

  // Totaal van de ingrediënten in gram of ml (bij benadering), ook als de
  // opbrengst in stuks is (bv. 45 bollen uit 5 liter). Alleen om te tonen
  // hoeveel één stuk ongeveer is.
  const measureRef = useMemo(() => {
    const gUnit = units.find((u) => u.key === "g");
    const mlUnit = units.find((u) => u.key === "ml");
    let weight = 0;
    let volume = 0;
    for (const row of rows) {
      if (isEmptyRow(row) || !row.quantity.trim()) continue;
      const u = row.unitId ? unitsById.get(row.unitId) : null;
      if (u?.dimension === "gewicht") weight++;
      else if (u?.dimension === "inhoud") volume++;
    }
    const target = volume > weight ? mlUnit : gUnit;
    if (!target || weight + volume === 0) return null;
    let total = 0;
    for (const row of rows) {
      if (isEmptyRow(row) || !row.quantity.trim()) continue;
      const qty = parseFloat(row.quantity);
      const rowUnit = row.unitId ? unitsById.get(row.unitId) : null;
      if (!Number.isFinite(qty) || !rowUnit) continue;
      const bridge = row.type === "ingrediënt" && row.refId ? productPrices.get(row.refId) : null;
      const v = convertQuantity(qty, rowUnit, target, bridge, unitsById) ?? approximateMeasure(qty, rowUnit, target);
      if (v !== null) total += v;
    }
    return total > 0 ? { total, unitName: target.name } : null;
  }, [rows, units, unitsById, productPrices]);

  // Bestaand halfproduct waarvan de opbrengst al gelijk is aan de som van de
  // ingrediënten: dat is gewoon "automatisch". Dat tonen we ook zo, zodat de
  // standaard automatisch is en alleen echt afwijkende opbrengsten (jus,
  // ingekookt, gebakken) als handmatig blijven staan. De waarde zelf
  // verandert hierbij niet. Gebeurt één keer, zodra de som bekend is.
  const yieldModeChecked = useRef(false);
  useEffect(() => {
    if (yieldModeChecked.current) return;
    if (!initialRecipe || recipeKind !== "halfproduct") {
      yieldModeChecked.current = true;
      return;
    }
    if (!yieldManual) {
      yieldModeChecked.current = true;
      return;
    }
    const stored = Number(initialRecipe.yield_quantity) || 0;
    const missingInfo =
      initialIngredients.some((ri) => ri.product_id || ri.sub_recipe_id) &&
      (yieldSkippedCount > 0 || computedYieldFromIngredients === null);
    // Wacht tot de eenheden en prijzen geladen zijn (anders is de som nog niet compleet).
    if (units.length === 0 || computedYieldFromIngredients === null || missingInfo) return;
    yieldModeChecked.current = true;
    if (stored > 0 && computedYieldFromIngredients > 0) {
      // Een opbrengst onder (of boven) de som is gewoon een verlies-%, geen
      // reden om "handmatig" te zijn: de standaard blijft automatisch. Alleen
      // een heel andere opbrengst (bv. 24 stuks uit 2 kilo) blijft handmatig.
      const loss = (1 - stored / computedYieldFromIngredients) * 100;
      if (loss >= -300 && loss < 99) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLossPct(loss);
        setYieldManual(false);
      }
    } else if (!(stored > 0) && computedYieldFromIngredients > 0) {
      // Nog geen opbrengst ingevuld: dan volgt die gewoon de som (automatisch).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLossPct(0);
      setYieldManual(false);
    }
  }, [
    computedYieldFromIngredients,
    yieldSkippedCount,
    units.length,
    yieldManual,
    recipeKind,
    initialRecipe,
    initialIngredients,
  ]);

  // Staat de eenheid van de opbrengst op "stuk" terwijl de ingrediënten in
  // gram/liter staan (en is de opbrengst nog niet door de kok bepaald), dan
  // is stuks een restant van de import. We zetten het eenmalig om naar
  // gram of milliliter, zodat er een echt totaal komt. Zelf een eenheid
  // kiezen wint altijd.
  const unitAutoDone = useRef(false);
  useEffect(() => {
    if (unitAutoDone.current || recipeKind !== "halfproduct" || units.length === 0) return;
    const cur = baseUnitId ? unitsById.get(baseUnitId) : null;
    if (!cur) return;
    if (cur.dimension !== "aantal") {
      unitAutoDone.current = true;
      return;
    }
    if (yieldManual && Number(yieldQuantity) > 0) return;
    let weight = 0;
    let volume = 0;
    let count = 0;
    for (const row of rows) {
      if (isEmptyRow(row) || !row.quantity.trim()) continue;
      const u = row.unitId ? unitsById.get(row.unitId) : null;
      if (!u) continue;
      if (u.dimension === "gewicht") weight++;
      else if (u.dimension === "inhoud") volume++;
      else count++;
    }
    if (weight + volume === 0 || count >= weight + volume) return;
    const target = units.find((u) => u.key === (volume > weight ? "ml" : "g"));
    if (!target) return;
    unitAutoDone.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBaseUnitId(target.id);
    setYieldQuantity("");
  }, [rows, units, unitsById, baseUnitId, recipeKind, yieldManual, yieldQuantity]);

  // De som is alleen betrouwbaar als ALLE regels met een hoeveelheid naar de
  // eenheid van de opbrengst om te rekenen zijn. Een deelsom (bv. alleen de
  // gram-regels terwijl het meeste in liters is) zou de opbrengst en dus de
  // kostprijs per kilo veel te laag/hoog maken; liters en kilo's worden
  // nooit zonder bekende dichtheid aan elkaar gelijkgesteld.
  const yieldAutoReliable = computedYieldFromIngredients !== null && yieldSkippedCount === 0;

  // In automatische stand volgt de opbrengst de som van de ingrediënten. In
  // handmatige stand blijft de waarde van de kok altijd staan, ook als er
  // ingrediënten bijkomen of wijzigen.
  useEffect(() => {
    if (
      recipeKind === "halfproduct" &&
      !yieldManual &&
      yieldAutoReliable &&
      computedYieldFromIngredients !== null &&
      computedYieldFromIngredients > 0
    ) {
      const target = computedYieldFromIngredients * (1 - lossPct / 100);
      const typed = Number(yieldQuantity.replace(",", "."));
      // Niet overschrijven wat de kok net typt (bv. "7," tijdens het typen).
      if (Number.isFinite(typed) && yieldQuantity.trim() !== "" && Math.abs(typed - target) <= Math.max(1e-6, Math.abs(target) * 1e-6)) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setYieldQuantity(target.toFixed(3).replace(/\.?0+$/, ""));
    }
  }, [computedYieldFromIngredients, recipeKind, yieldManual, yieldAutoReliable, lossPct, yieldQuantity]);

  const allergenSummary = useMemo(() => {
    const contains = new Set<string>();
    const traces = new Set<string>();
    for (const row of rows) {
      if (!row.refId) continue;
      if (row.type === "ingrediënt") {
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

    // Een ingrediënt zonder ingevulde allergeengegevens maakt het hele
    // halfproduct onzeker: dan is "bevat niet" niet hard te maken.
    let hasUnknownSource = false;
    for (const row of rows) {
      if (!row.refId) continue;
      if (row.type === "ingrediënt") {
        const info = productPrices.get(row.refId);
        if (!info || (info.allergens.length === 0 && info.traces.length === 0)) {
          hasUnknownSource = true;
        }
      }
    }
    const known = new Set([...contains, ...traces]);
    const free = hasUnknownSource
      ? []
      : EU_ALLERGENS.filter((a) => !known.has(a));
    const unknown = hasUnknownSource
      ? EU_ALLERGENS.filter((a) => !known.has(a))
      : [];

    return {
      contains: [...contains].sort(),
      traces: [...traces].sort(),
      free: [...free].sort(),
      unknown: [...unknown].sort(),
    };
  }, [rows, productPrices, halfproductCosts]);

  const nutritionTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    rows.forEach((row) => {
      if (!row.refId || !row.unitId) return;
      const qty = parseFloat(row.quantity);
      if (!Number.isFinite(qty)) return;
      const chosenUnit = unitsById.get(row.unitId);
      if (!chosenUnit) return;

      if (row.type === "ingrediënt") {
        const info = productPrices.get(row.refId);
        if (!info?.nutritionPer100 || !info.baseUnitId) return;
        const baseUnit = unitsById.get(info.baseUnitId);
        if (!baseUnit) return;
        const convertedQty = convertQuantity(qty, chosenUnit, baseUnit, info, unitsById);
        if (convertedQty === null) return;
        for (const [key, value] of Object.entries(info.nutritionPer100)) {
          totals[key] = (totals[key] ?? 0) + (value * convertedQty) / 100;
        }
      } else {
        const info = halfproductCosts.get(row.refId);
        if (!info || !info.yieldQuantity || !info.baseUnitId) return;
        const baseUnit = unitsById.get(info.baseUnitId);
        if (!baseUnit) return;
        const convertedQty = convertQuantity(qty, chosenUnit, baseUnit, null, unitsById);
        if (convertedQty === null) return;
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
      const copy = { ...prev[index], id: undefined, uid: newRowUid() };
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

  const [rematching, setRematching] = useState(false);
  const [rematchMessage, setRematchMessage] = useState<string | null>(null);

  async function handleRematch() {
    setRematching(true);
    setRematchMessage(null);
    const supabase = createClient();
    const updated = [...rows];
    let resolvedCount = 0;
    const newlyMatchedIds: string[] = [];
    const newlyMatchedHalfs: string[] = [];

    // Halfproducten (oudste eerst) die als ingrediënt in dit recept kunnen
    // staan; het recept zelf valt af zodat het nooit zichzelf bevat.
    const { data: halfList } = await supabase
      .from("recipes")
      .select("id, name, base_unit_id, yield_quantity")
      .eq("recipe_kind", "halfproduct")
      .order("created_at", { ascending: true })
      .limit(5000);
    const halfByName = new Map<string, { id: string; name: string; base_unit_id: string | null; yield_quantity: number | null }>();
    for (const h of halfList ?? []) {
      if (h.id === initialRecipe?.id) continue;
      const key = h.name.trim().toLowerCase();
      if (key && !halfByName.has(key)) halfByName.set(key, h);
    }

    for (let i = 0; i < updated.length; i++) {
      const row = updated[i];
      if (row.refId || !row.unmatchedName) continue;

      // Eerst een halfproduct met exact dezelfde naam (zelfde volgorde als
      // bij het importeren).
      const half = halfByName.get(row.unmatchedName.trim().toLowerCase());
      if (half) {
        updated[i] = {
          ...row,
          type: "halfproduct",
          refId: half.id,
          refName: half.name,
          unmatchedName: null,
          unmatchedArticleNumber: null,
          baseUnitId: half.base_unit_id,
          yieldQuantity: half.yield_quantity ?? null,
          unitId: row.unitId ?? half.base_unit_id,
        };
        resolvedCount++;
        newlyMatchedHalfs.push(half.id);
        if (row.id) {
          await supabase
            .from("recipe_ingredients")
            .update({
              product_id: null,
              sub_recipe_id: half.id,
              unmatched_name: null,
              unmatched_article_number: null,
              unit_id: row.unitId ?? half.base_unit_id,
            })
            .eq("id", row.id);
        }
        continue;
      }

      let match: { id: string; name: string; base_unit_id: string | null } | null = null;

      // Eerst op leverancier-artikelnummer proberen (betrouwbaarst),
      // pas als terugval op een exacte naam — nooit op gelijkenis, om
      // dezelfde reden als bij het importeren zelf: geen gok, alleen
      // zekere koppelingen.
      if (row.unmatchedArticleNumber) {
        const { data } = await supabase
          .from("products")
          .select("id, name, base_unit_id")
          .eq("article_number", row.unmatchedArticleNumber)
          .limit(1)
          .maybeSingle();
        if (data) match = data;
      }
      if (!match) {
        const { data } = await supabase
          .from("products")
          .select("id, name, base_unit_id")
          .ilike("name", row.unmatchedName)
          .limit(1)
          .maybeSingle();
        if (data) match = data;
      }

      if (match) {
        updated[i] = {
          ...row,
          type: "ingrediënt",
          refId: match.id,
          refName: match.name,
          unmatchedName: null,
          unmatchedArticleNumber: null,
          baseUnitId: match.base_unit_id,
          unitId: row.unitId ?? match.base_unit_id,
        };
        resolvedCount++;
        newlyMatchedIds.push(match.id);

        // Meteen bewaren als deze regel al eerder is opgeslagen — niet
        // wachten tot de gebruiker op "Opslaan" klikt, anders raakt de
        // koppeling kwijt als het scherm zonder opslaan verlaten wordt.
        if (row.id) {
          await supabase
            .from("recipe_ingredients")
            .update({
              product_id: match.id,
              sub_recipe_id: null,
              unmatched_name: null,
              unmatched_article_number: null,
              unit_id: row.unitId ?? match.base_unit_id,
            })
            .eq("id", row.id);
        }
      }
    }

    setRows(updated);

    // Prijzen van de zojuist gekoppelde ingrediënten direct ophalen —
    // anders blijft de regel "onvolledig" tonen (met prijs "—") tot de
    // pagina volledig herladen wordt, terwijl de koppeling al bestaat.
    await Promise.all(
      [
        ...[...new Set(newlyMatchedIds)].map((id) => loadProductPrice(id)),
        ...[...new Set(newlyMatchedHalfs)].map((id) => loadHalfproductCost(id)),
      ]
    );

    setRematching(false);
    setRematchMessage(
      resolvedCount > 0
        ? `${resolvedCount} ingrediënt(en) en halfproduct(en) gekoppeld.`
        : "Geen nieuwe koppelingen gevonden."
    );
  }

  function handlePick(index: number, picked: PickedIngredient) {
    const existingRowId = rows[index]?.id;
    // Eenheid alleen vervangen als de huidige eenheid een andere
    // dimensie heeft dan het nieuwe ingrediënt — bij het omwisselen van
    // bv. de ene olie naar de andere blijft "100 milliliter" gewoon staan.
    const currentUnit = rows[index]?.unitId ? unitsById.get(rows[index].unitId!) : null;
    const newBaseUnit = picked.baseUnitId ? unitsById.get(picked.baseUnitId) : null;
    // Een regel uit het tekstveld die nog niet gekoppeld was houdt de
    // eenheid die de kok zelf typte, ook als die (nog) niet omgerekend kan
    // worden — de regel meldt dat dan zelf.
    const keepUnit =
      currentUnit &&
      ((newBaseUnit && currentUnit.dimension === newBaseUnit.dimension) ||
        (rows[index]?.unmatchedName && !rows[index]?.refId));
    const nextUnitId = keepUnit ? rows[index].unitId : picked.baseUnitId;

    updateRow(index, {
      type: picked.type,
      refId: picked.id,
      refName: picked.name,
      unmatchedName: null,
      unmatchedArticleNumber: null,
      baseUnitId: picked.baseUnitId,
      yieldQuantity: picked.yieldQuantity ?? null,
      unitId: nextUnitId,
      matchState: undefined,
    });
    if (picked.type === "ingrediënt") loadProductPrice(picked.id);
    else loadHalfproductCost(picked.id);

    // Al eerder opgeslagen regel: wijziging meteen bewaren, niet pas
    // bij "Opslaan" — zelfde patroon als "Opnieuw zoeken in Ingrediënten".
    if (existingRowId) {
      const supabase = createClient();
      supabase
        .from("recipe_ingredients")
        .update({
          product_id: picked.type === "ingrediënt" ? picked.id : null,
          sub_recipe_id: picked.type === "halfproduct" ? picked.id : null,
          unmatched_name: null,
          unmatched_article_number: null,
          unit_id: nextUnitId,
        })
        .eq("id", existingRowId)
        .then(({ error: persistError }) => {
          if (persistError) {
            console.error("Kan ingrediëntwijziging niet direct opslaan:", persistError.message);
          }
        });
    }
  }

  // Extra product uit het zoekvenster ("venster open laten"): komt als
  // nieuwe regel onderaan, met de basiseenheid van het product alvast gekozen
  // zodat de kok alleen nog de hoeveelheid hoeft in te vullen.
  function addPickedRow(picked: PickedIngredient) {
    setRows((prev) => [
      ...prev,
      {
        ...emptyRow(),
        type: picked.type,
        refId: picked.id,
        refName: picked.name,
        baseUnitId: picked.baseUnitId,
        yieldQuantity: picked.yieldQuantity ?? null,
        unitId: picked.baseUnitId,
      },
    ]);
    if (picked.type === "ingrediënt") loadProductPrice(picked.id);
    else loadHalfproductCost(picked.id);
  }

  // ---------------------------------------------------------------------
  // Tekstinvoer: "2000 ml kookwijn wit" → regel met hoeveelheid, eenheid en
  // (als het zeker is) een koppeling aan het echte ingrediënt-ID.
  // De tekst zelf wordt nooit bewaard; alleen de gekoppelde regels tellen.
  // ---------------------------------------------------------------------
  const unitByKey = useMemo(() => new Map(units.map((u) => [u.key, u])), [units]);
  // Welke regel het zoekvenster nu open heeft (er is er maximaal één).
  const [searchUid, setSearchUid] = useState<string | null>(null);
  const [textEditOpen, setTextEditOpen] = useState(false);
  const [multiplyOpen, setMultiplyOpen] = useState(false);
  const [multiplyFactor, setMultiplyFactor] = useState("2");
  const [multiplyMessage, setMultiplyMessage] = useState<string | null>(null);

  function isEmptyRow(r: IngredientRow) {
    return !r.refId && !r.unmatchedName && !r.quantity.trim() && !r.note.trim();
  }

  function normalizeName(value: string) {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
  }

  function rowFromParsedLine(line: ParsedIngredientLine): IngredientRow {
    const unit = line.unitKey ? unitByKey.get(line.unitKey) : null;
    return {
      ...emptyRow(),
      unmatchedName: line.name || line.raw,
      quantity: line.quantity !== null ? String(line.quantity) : "",
      unitId: unit?.id ?? null,
      // Een eenheid die we niet kennen (tl, snufje, …) gaat niet verloren
      // maar komt als opmerking op de regel.
      note: line.unknownUnit ? `${line.quantity ?? ""} ${line.unknownUnit}`.trim() : "",
      matchState: "zoekt",
    };
  }

  /**
   * Zoekt de bij een ingetypte naam passende ingrediënt of halfproduct en
   * koppelt alleen als het ZEKER is: precies één exacte treffer, of
   * (zonder exacte) precies één naam die ermee begint.
   * Bij meerdere of geen treffers blijft de regel open voor een keuze.
   */
  async function resolveRow(uid: string, name: string): Promise<"gekoppeld" | "meerdere" | "onbekend"> {
    const trimmed = name.trim();
    const finish = (patch: Partial<IngredientRow>) =>
      setRows((prev) => prev.map((r) => (r.uid === uid && !r.refId ? { ...r, ...patch } : r)));

    if (trimmed.length < 2) {
      finish({ matchState: "onbekend" });
      return "onbekend";
    }
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("search_ingredients_picker", {
      p_search: trimmed,
      p_company_id: referenceCompanyId,
      p_limit: 8,
    });
    if (rpcError || !data) {
      finish({ matchState: "onbekend" });
      return "onbekend";
    }
    const hits = data as {
      kind: "ingrediënt" | "halfproduct";
      id: string;
      name: string;
      custom_name: string | null;
      base_unit_id: string | null;
      yield_quantity: number | null;
      match_rank: number;
    }[];
    if (hits.length === 0) {
      finish({ matchState: "onbekend" });
      return "onbekend";
    }
    // Eén exacte treffer (naam, synoniem of artikelnummer) wint van namen
    // die er alleen mee beginnen. Is er geen exacte, dan koppelen we alleen
    // als er precies één naam is die ermee begint.
    const exact = hits.filter((h) => h.match_rank === 0);
    const startsWith = hits.filter((h) => h.match_rank === 1);
    const sure = exact.length === 1 ? exact : exact.length === 0 ? startsWith : [];
    if (sure.length !== 1) {
      finish({ matchState: "meerdere" });
      return "meerdere";
    }
    const hit = sure[0];
    setRows((prev) =>
      prev.map((r) =>
        r.uid === uid && !r.refId
          ? {
              ...r,
              type: hit.kind,
              refId: hit.id,
              refName: hit.custom_name?.trim() || hit.name,
              unmatchedName: null,
              unmatchedArticleNumber: null,
              baseUnitId: hit.base_unit_id,
              yieldQuantity: hit.yield_quantity ?? null,
              unitId: r.unitId ?? hit.base_unit_id,
              matchState: undefined,
            }
          : r
      )
    );
    if (hit.kind === "ingrediënt") void loadProductPrice(hit.id);
    else void loadHalfproductCost(hit.id);
    return "gekoppeld";
  }

  /** Meerdere zoekopdrachten tegelijk, maar niet honderd tegelijk. */
  async function resolveMany(items: { uid: string; name: string }[]) {
    const results: ("gekoppeld" | "meerdere" | "onbekend")[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await resolveRow(items[i].uid, items[i].name);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, items.length) }, worker));
    return results;
  }

  async function addText(text: string) {
    const lines = parseIngredientText(text);
    if (lines.length === 0) return;
    const newRows = lines.map(rowFromParsedLine);
    // Lege startregels maken plaats voor de nieuwe regels.
    setRows((prev) => [...prev.filter((r) => !isEmptyRow(r)), ...newRows]);
    const results = await resolveMany(
      newRows.map((r) => ({ uid: r.uid, name: r.unmatchedName ?? "" }))
    );
    // Eén regel getypt en niet zeker herkend: meteen het zoekvenster erbij.
    if (newRows.length === 1 && results[0] !== "gekoppeld") setSearchUid(newRows[0].uid);
  }

  function rowsToText() {
    return rows
      .filter((r) => !isEmptyRow(r))
      .map((r) => {
        const unit = r.unitId ? unitsById.get(r.unitId) : null;
        const unitText = unit ? (unit.key === "stuk" ? "stuks" : unit.key) : "";
        return [r.quantity, unitText, r.refName ?? r.unmatchedName ?? ""].filter(Boolean).join(" ");
      })
      .join("\n");
  }

  /**
   * Tekst bewerken en toepassen. Een regel met dezelfde ingrediëntnaam als
   * een bestaande regel behoudt zijn koppeling, verlies %, optioneel en
   * opmerking; alleen hoeveelheid en eenheid worden overgenomen. Nieuwe
   * namen gaan door de gewone herkenning.
   */
  async function applyTextEdit(text: string) {
    const lines = parseIngredientText(text);
    const pool = rows.filter((r) => !isEmptyRow(r)).map((row) => ({ row, used: false }));
    const next: IngredientRow[] = [];
    const fresh: IngredientRow[] = [];
    for (const line of lines) {
      const key = normalizeName(line.name);
      const hit = pool.find(
        (p) => !p.used && normalizeName(p.row.refName ?? p.row.unmatchedName ?? "") === key
      );
      if (hit) {
        hit.used = true;
        const unit = line.unitKey ? unitByKey.get(line.unitKey) : null;
        next.push({
          ...hit.row,
          quantity: line.quantity !== null ? String(line.quantity) : hit.row.quantity,
          unitId: unit?.id ?? hit.row.unitId,
        });
      } else {
        const created = rowFromParsedLine(line);
        next.push(created);
        fresh.push(created);
      }
    }
    const removed = pool.filter((p) => !p.used).length;
    if (
      removed > 0 &&
      !window.confirm(`${removed} regel(s) staan niet meer in de tekst en worden uit het recept gehaald. Doorgaan?`)
    ) {
      return;
    }
    setRows(next.length > 0 ? next : [emptyRow()]);
    setTextEditOpen(false);
    await resolveMany(fresh.map((r) => ({ uid: r.uid, name: r.unmatchedName ?? "" })));
  }

  // Netto opbrengst (bruikbare hoeveelheid) invullen: het verlies-% rekent
  // direct mee. Zelfde logica voor het veld bovenaan en het veld in het blok
  // "Opbrengst en kostprijs".
  function handleYieldTyped(value: string) {
    setYieldQuantity(value);
    const typed = Number(value.replace(",", "."));
    if (yieldAutoReliable && computedYieldFromIngredients !== null && computedYieldFromIngredients > 0) {
      // Zelf een opbrengst typen = een ander verlies-%, blijft automatisch.
      if (Number.isFinite(typed) && typed > 0) {
        setLossPct((1 - typed / computedYieldFromIngredients) * 100);
        setYieldManual(false);
      } else {
        setYieldManual(true);
      }
    } else {
      setYieldManual(true);
    }
    setLossDraft(null);
  }

  // Eenheid van de opbrengst wisselen. Binnen dezelfde soort (kilo ↔ gram,
  // liter ↔ ml) rekent het getal mee, zodat 6,5 kilo niet 6,5 gram wordt.
  function changeYieldUnit(nextUnitId: string) {
    unitAutoDone.current = true;
    const prev = baseUnitId ? unitsById.get(baseUnitId) : null;
    const next = nextUnitId ? unitsById.get(nextUnitId) : null;
    if (prev && next && prev.dimension === next.dimension && Number(yieldQuantity) > 0) {
      const converted = (Number(yieldQuantity) * Number(prev.factor_to_base)) / Number(next.factor_to_base);
      setYieldQuantity(String(Math.round(converted * 10000) / 10000));
    }
    if (prev && next && prev.dimension === next.dimension && Number(manualBegin.replace(",", ".")) > 0) {
      const b = (Number(manualBegin.replace(",", ".")) * Number(prev.factor_to_base)) / Number(next.factor_to_base);
      setManualBegin(String(Math.round(b * 10000) / 10000));
    }
    // Gram ↔ milliliter: bij benadering 1 op 1 (zelfde aanname als bij het
    // optellen van de ingrediënten), zodat het getal blijft staan.
    const bothMeasures =
      prev && next && prev.dimension !== "aantal" && next.dimension !== "aantal" && prev.dimension !== next.dimension;
    if (prev && next && bothMeasures) {
      if (Number(yieldQuantity) > 0) {
        const converted = (Number(yieldQuantity) * Number(prev.factor_to_base)) / Number(next.factor_to_base);
        setYieldQuantity(String(Math.round(converted * 10000) / 10000));
      }
      if (Number(manualBegin.replace(",", ".")) > 0) {
        const b = (Number(manualBegin.replace(",", ".")) * Number(prev.factor_to_base)) / Number(next.factor_to_base);
        setManualBegin(String(Math.round(b * 10000) / 10000));
      }
    }
    if (prev && next && prev.dimension !== next.dimension && !bothMeasures) {
      // Van gewicht/inhoud naar stuks (of terug): het oude getal betekent iets
      // anders (5000 ml is geen 5000 stuks). Opnieuw invullen.
      setYieldQuantity("");
      setLossPct(0);
      setLossDraft(null);
      setYieldManual(true);
    }
    setBaseUnitId(nextUnitId);
  }

  function applyMultiply() {
    const factor = Number(multiplyFactor.replace(",", "."));
    if (!Number.isFinite(factor) || factor <= 0) {
      setMultiplyMessage("Vul een getal groter dan 0 in.");
      return;
    }
    setRows((prev) =>
      prev.map((r) => {
        const q = parseFloat(r.quantity);
        if (!Number.isFinite(q)) return r;
        return { ...r, quantity: String(Math.round(q * factor * 10000) / 10000) };
      })
    );
    // Bij een halfproduct schaalt de opbrengst mee, anders klopt de prijs
    // per kilo/liter niet meer.
    if (recipeKind === "halfproduct" && Number(yieldQuantity) > 0) {
      setYieldQuantity(String(Math.round(Number(yieldQuantity) * factor * 10000) / 10000));
    }
    setMultiplyMessage(
      `Alle hoeveelheden zijn × ${factor.toLocaleString("nl-NL")} gedaan. Controleer en klik op Opslaan; Annuleren zet alles terug.`
    );
    setMultiplyOpen(false);
  }

  async function handleSubmit(e: React.FormEvent, publishStatus?: RecipeStatus) {
    e.preventDefault();
    setError(null);

    const finalStatus = publishStatus ?? status;
    const validRows = rows.filter((r) => (r.refId || r.unmatchedName) && r.quantity.trim());

    if (validRows.length === 0) {
      setError("Voeg minimaal één ingrediënt of halfproduct toe.");
      return;
    }

    if (finalStatus === "goedgekeurd" && rows.some((r) => !r.refId && !isEmptyRow(r))) {
      setError(
        "Kan niet publiceren: één of meer ingrediënten zijn nog niet aan een product gekoppeld. Kies ze in het zoekvenster, of sla op als concept."
      );
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
      // Is automatisch niet betrouwbaar te berekenen, dan is wat er staat
      // per definitie door de kok bepaald.
      yield_is_manual: recipeKind === "halfproduct" ? yieldManual || !yieldAutoReliable : true,
      labour_minutes_kitchen: labourKitchen ? Number(labourKitchen) : null,
      labour_minutes_other: labourOther ? Number(labourOther) : null,
      labour_cost_per_hour: labourRate ? Number(labourRate) : null,
      production_location: productionLocation.trim() || null,
      synonyms: recipeSynonyms.split(",").map((x) => x.trim()).filter(Boolean),
      storage_method: recipeKind === "halfproduct" ? storageMethod.trim() || null : null,
      shelf_life_days: recipeKind === "halfproduct" && shelfLifeDays ? Number(shelfLifeDays) : null,
      sales_price: recipeKind === "gerecht" && salesPrice ? Number(salesPrice) : null,
      vat_rate: Number(vatRate),
      waste_percentage: wastePercentage ? Number(wastePercentage) : 0,
      margin_free_costs: marginFreeCosts ? Number(marginFreeCosts) : 0,
    };

    // Opgegeven gram/ml bij een stuks-regel (bv. "10 citroenen = 1000 gram")
    // onthouden we bij het product zelf (1 stuk = x gram/ml), zodat het bij
    // opslaan en heropenen blijft staan en overal meerekent.
    if (recipeKind === "halfproduct") {
      const targetUnit = unitsById.get(baseUnitId);
      const bridgeUnit = targetUnit
        ? units.find((u) => u.key === (targetUnit.dimension === "inhoud" ? "ml" : "g"))
        : undefined;
      if (bridgeUnit) {
        for (const row of rows) {
          if (row.type !== "ingrediënt" || !row.refId) continue;
          const info = productPrices.get(row.refId);
          if (info?.avgUnitQuantity && info.avgUnitId) continue;
          const est = Number((stukEstimates[row.uid] ?? "").replace(",", "."));
          const qty = Number(row.quantity.replace(",", "."));
          if (!(est > 0) || !(qty > 0)) continue;
          const rowUnit = row.unitId ? unitsById.get(row.unitId) : null;
          if (rowUnit?.dimension !== "aantal") continue;
          await supabase
            .from("products")
            .update({ avg_unit_quantity: est / qty, avg_unit_id: bridgeUnit.id })
            .eq("id", row.refId);
        }
      }
    }

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
        product_id: r.type === "ingrediënt" ? r.refId : null,
        sub_recipe_id: r.type === "halfproduct" ? r.refId : null,
        unmatched_name: !r.refId ? r.unmatchedName : null,
        unmatched_article_number: !r.refId ? r.unmatchedArticleNumber : null,
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

    goBack();
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
    goBack();
  }

  const basisgegevensCard = (
      <Card>
        <CardHeader>
          <CardTitle>Basisgegevens</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <details className="rounded-md border border-border px-3 py-2 sm:col-span-2 lg:col-span-4">
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              Categorie, status en bereik
            </summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
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
            </div>
          </details>

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
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="eindopbrengst">
                      Bruikbare hoeveelheid (eindopbrengst) <span className="text-danger">*</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="eindopbrengst"
                        required
                        type="number"
                        step="any"
                        min="0"
                        value={yieldQuantity}
                        onChange={(e) => handleYieldTyped(e.target.value)}
                        className="input min-w-[6rem] flex-1"
                      />
                      <select
                        aria-label="Eenheid van de opbrengst"
                        required
                        value={baseUnitId}
                        onChange={(e) => changeYieldUnit(e.target.value)}
                        className="input w-32 shrink-0"
                      >
                        <option value="">Eenheid…</option>
                        {units
                          .filter((u) => ["g", "kg", "ml", "l", "stuk"].includes(u.key) || u.id === baseUnitId)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                    </div>
                    {!baseUnitId && (
                      <p className="text-xs text-copper">Kies in welke eenheid de opbrengst is (kilo, liter, stuks).</p>
                    )}
                    {isEdit && baseUnitId !== (initialRecipe?.base_unit_id ?? "") && (
                      <p className="text-xs text-copper">
                        Let op: gerechten en recepten die dit halfproduct gebruiken rekenen met deze eenheid.
                        Een andere soort eenheid (bv. kilo → liter) kan die regels onvolledig maken.
                      </p>
                    )}
                  </div>
              <details className="rounded-md border border-border px-3 py-2 sm:col-span-2 lg:col-span-4">
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  Houdbaarheid, arbeid en overige instellingen
                </summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Houdbaarheid (dagen)">
                <input
                  type="number"
                  value={shelfLifeDays}
                  onChange={(e) => setShelfLifeDays(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Productielocatie">
                <input
                  value={productionLocation}
                  onChange={(e) => setProductionLocation(e.target.value)}
                  placeholder="bv. Centrale keuken"
                  className="input"
                />
              </Field>

              <Field label="Arbeid keuken (minuten)">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={labourKitchen}
                  onChange={(e) => setLabourKitchen(e.target.value)}
                  className="input"
                />
              </Field>

              <Field label="Overige arbeid (minuten)">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={labourOther}
                  onChange={(e) => setLabourOther(e.target.value)}
                  className="input"
                />
              </Field>

              <Field
                label="Uurtarief arbeid (€)"
                hint="Leeg laten = arbeid telt niet mee in de kostprijs"
              >
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={labourRate}
                  onChange={(e) => setLabourRate(e.target.value)}
                  className="input"
                />
              </Field>

              <Field
                label="Synoniemen"
                hint="Andere benamingen, gescheiden door komma's"
                span2
              >
                <input
                  value={recipeSynonyms}
                  onChange={(e) => setRecipeSynonyms(e.target.value)}
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
                </div>
              </details>
            </>
          )}

        </CardContent>
      </Card>
  );

  const bereidingCard = (
      <Card>
        <CardHeader>
          <CardTitle>Bereiding &amp; opmaak</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Bereidingswijze">
            <textarea
              value={preparation}
              onChange={(e) => setPreparation(e.target.value)}
              rows={4}
              className="input"
            />
          </Field>
          <Field label="Opmaakinstructies / opslag">
            <textarea
              value={platingInstructions}
              onChange={(e) => setPlatingInstructions(e.target.value)}
              rows={4}
              className="input"
            />
          </Field>
        </CardContent>
      </Card>
  );

  const galerijCard = (
      <Card>
        <CardHeader>
          <CardTitle>Galerij</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Foto (URL)">
            <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} className="input" />
          </Field>
          {photoUrl.trim() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl.trim()}
              alt={name || "Foto"}
              className="max-h-64 rounded-md border border-border object-contain"
            />
          ) : (
            <p className="text-sm text-muted">Nog geen foto toegevoegd.</p>
          )}
        </CardContent>
      </Card>
  );

  const unmatchedCount = rows.filter((r) => !r.refId && r.unmatchedName).length;

  // Status onder het invoerveld: groen = alles herkend, oranje = er wordt
  // gezocht, rood = minstens één ingrediënt is niet herkend.
  const filledRows = rows.filter((r) => !isEmptyRow(r));
  const searchingCount = filledRows.filter((r) => !r.refId && r.matchState === "zoekt").length;
  const unrecognizedRows = filledRows.filter((r) => !r.refId && r.matchState !== "zoekt");
  const recognitionStatus: "leeg" | "groen" | "oranje" | "rood" =
    filledRows.length === 0
      ? "leeg"
      : searchingCount > 0
      ? "oranje"
      : unrecognizedRows.length > 0
      ? "rood"
      : "groen";

  const ingredientenCard = (
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>
            {recipeKind === "gerecht" ? "Ingrediënten & halfproducten" : "Ingrediënten"}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {rematchMessage && <span className="text-xs text-muted">{rematchMessage}</span>}
            {unmatchedCount > 0 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleRematch}
                disabled={rematching}
              >
                {rematching ? "Bezig…" : "Opnieuw zoeken in Ingrediënten"}
              </Button>
            )}
            {filledRows.length > 0 && !textEditOpen && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setTextEditOpen(true)}>
                Als tekst bewerken
              </Button>
            )}
            {recipeKind === "halfproduct" && filledRows.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setMultiplyOpen((v) => !v)}
              >
                Receptuur vermenigvuldigen
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!referenceCompanyId && (
            <p className="text-xs text-copper">
              Selecteer een bedrijf via de bedrijfsselector rechtsboven om live
              kostprijzen te zien tijdens het invoeren.
            </p>
          )}

          {recipeKind === "halfproduct" && (() => {
            const begin: number | null = yieldAutoReliable
              ? computedYieldFromIngredients
              : Number(manualBegin.replace(",", ".")) > 0
              ? Number(manualBegin.replace(",", "."))
              : null;
            const endQty = yieldQuantityNum;
            const derivedLoss =
              begin !== null && begin > 0 && endQty > 0
                ? Math.round((1 - endQty / begin) * 1000) / 10
                : null;
            const unitLabel = baseUnitName ?? "eenheid";
            const fmt = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 3 });
            const yieldUnitObj = baseUnitId ? unitsById.get(baseUnitId) : null;
            const yieldIsCount = yieldUnitObj?.dimension === "aantal";
            const stukUnit = units.find((u) => u.key === "stuk");
            const measureUnit = units.find((u) => u.key === (measureRef?.unitName === "milliliter" ? "ml" : "g"));
            // Verlies-% en bruikbare hoeveelheid rekenen live naar elkaar:
            // typ je het een, dan past het ander direct mee aan.
            function onLossChange(raw: string) {
              setLossDraft(raw);
              if (begin === null || begin <= 0) return;
              const pct = Number(raw.replace(",", "."));
              if (raw.trim() === "" || !Number.isFinite(pct) || pct >= 100) return;
              // Negatief = gewichtstoename (bv. rijst die water opneemt).
              if (yieldAutoReliable) {
                setLossPct(pct);
                setYieldManual(false);
              } else {
                setYieldManual(true);
              }
              setYieldQuantity(String(Math.round(begin * (1 - pct / 100) * 1000) / 1000));
            }
            return (
              <div className="space-y-2 rounded-md border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">Opbrengst en kostprijs</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      yieldManual || !yieldAutoReliable
                        ? "bg-copper/15 text-copper"
                        : "bg-teal/10 text-teal"
                    }`}
                  >
                    {yieldManual || !yieldAutoReliable ? "Handmatig" : "Automatisch"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>Opbrengst in:</span>
                  <button
                    type="button"
                    onClick={() => measureUnit && yieldIsCount && changeYieldUnit(measureUnit.id)}
                    className={`rounded-md border px-2 py-1 ${
                      !yieldIsCount ? "border-teal bg-teal/10 text-teal" : "border-border hover:bg-surface"
                    }`}
                  >
                    Gewicht / inhoud
                  </button>
                  <button
                    type="button"
                    onClick={() => stukUnit && !yieldIsCount && changeYieldUnit(stukUnit.id)}
                    className={`rounded-md border px-2 py-1 ${
                      yieldIsCount ? "border-teal bg-teal/10 text-teal" : "border-border hover:bg-surface"
                    }`}
                  >
                    Stuks (bollen, porties, plakken)
                  </button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted">
                      Beginhoeveelheid ({yieldAutoReliable ? (yieldIsApproximate ? "berekend, in de buurt" : "berekend") : "zelf invullen"})
                    </p>
                    {yieldIsCount ? (
                      <>
                        <p className="tabular text-sm font-medium">
                          {measureRef ? `≈ ${fmt(measureRef.total)} ${measureRef.unitName}` : "—"}
                        </p>
                        <p className="text-xs text-muted">
                          {measureRef && endQty > 0
                            ? `1 stuk ≈ ${fmt(measureRef.total / endQty)} ${measureRef.unitName}. `
                            : ""}
                          De opbrengst is in stuks: vul hiernaast hoeveel stuks je hieruit haalt. De kostprijs per stuk
                          wordt daarmee berekend en rekent door in gerechten.
                        </p>
                      </>
                    ) : yieldAutoReliable && begin !== null ? (
                      <>
                        <p className="tabular text-sm font-medium">
                          {yieldIsApproximate ? "≈ " : ""}
                          {fmt(begin)} {unitLabel}
                        </p>
                        {yieldIsApproximate && (
                          <p className="text-xs text-muted">
                            Liters en kilo&apos;s zijn bij benadering bij elkaar opgeteld (1 ml ≈ 1 g).
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label="Beginhoeveelheid"
                          placeholder="optioneel"
                          value={manualBegin}
                          onChange={(e) => setManualBegin(e.target.value)}
                          className="input h-8"
                        />
                        <p className="text-xs text-copper">
                          {yieldSkippedCount > 0
                            ? `${yieldSkippedCount} regel(s) staan in een eenheid die niet naar ${unitLabel} om te rekenen is (bv. liters naar kilo's). `
                            : ""}
                          Vul de bruikbare hoeveelheid zelf in. Met een beginhoeveelheid kun je ook met een verlies-% rekenen.
                        </p>
                      </>
                    )}
                        {yieldLines.filter((l) => l.stuk).map((l) => (
                          <label key={l.uid} className="mt-1 block text-xs text-muted">
                            {l.name}: hoeveel gram of ml is dit ongeveer samen?
                            <input
                              type="text"
                              inputMode="decimal"
                              value={stukEstimates[l.uid] ?? ""}
                              onChange={(e) =>
                                setStukEstimates((prev) => ({ ...prev, [l.uid]: e.target.value }))
                              }
                              className="input mt-0.5 h-8"
                              placeholder="bv. 450"
                            />
                          </label>
                        ))}
                  </div>
                  <div>
                    <label className="text-xs text-muted" htmlFor="bereidingsverlies">
                      Verlies / reductie (%)
                    </label>
                    <input
                      id="bereidingsverlies"
                      type="text"
                      inputMode="decimal"
                      disabled={begin === null || begin <= 0}
                      placeholder={derivedLoss === null ? "optioneel" : undefined}
                      value={lossDraft ?? (derivedLoss === null ? "" : String(derivedLoss))}
                      onChange={(e) => onLossChange(e.target.value)}
                      onBlur={() => setLossDraft(null)}
                      className="input h-8"
                    />
                    <p className="text-xs text-muted">
                      {begin === null
                        ? yieldIsCount
                          ? "Niet van toepassing bij een opbrengst in stuks."
                          : "Vul eerst een beginhoeveelheid in."
                        : "Gekoppeld aan de bruikbare hoeveelheid. Negatief = gewichtstoename."}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs text-muted" htmlFor="netto-opbrengst">
                      Netto opbrengst
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="netto-opbrengst"
                        type="number"
                        step="any"
                        min="0"
                        value={yieldQuantity}
                        onChange={(e) => handleYieldTyped(e.target.value)}
                        className="input h-8 min-w-0 flex-1"
                      />
                      <select
                        aria-label="Eenheid van de netto opbrengst"
                        value={baseUnitId}
                        onChange={(e) => changeYieldUnit(e.target.value)}
                        className="input h-8 w-28 shrink-0"
                      >
                        {!baseUnitId && <option value="">Eenheid…</option>}
                        {units
                          .filter((u) => ["g", "kg", "ml", "l", "stuk"].includes(u.key) || u.id === baseUnitId)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <p className="text-xs text-muted">
                      Vul je dit in, dan rekent het verlies-% direct mee. Dit is de opbrengst die in de receptuur en de kostprijs per {unitLabel} wordt gebruikt.
                    </p>
                  </div>
                  {canViewFinancial && (
                    <div>
                      <p className="text-xs text-muted">Kostprijs</p>
                      <p className="tabular text-sm font-medium">€ {totalCost.toFixed(2)} totaal</p>
                      {costPerBaseUnit !== null && (
                        <p className="tabular text-xs text-muted">
                          € {costPerBaseUnit.toFixed(4)} per {unitLabel}
                          {costPerLargerUnit !== null && largerUnit
                            ? ` · € ${costPerLargerUnit.toFixed(2)} per ${largerUnit.name}`
                            : ""}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {multiplyOpen && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-2 text-sm">
              <span>Alle hoeveelheden (en de opbrengst) vermenigvuldigen met</span>
              <input
                type="text"
                inputMode="decimal"
                value={multiplyFactor}
                onChange={(e) => setMultiplyFactor(e.target.value)}
                className="h-8 w-20 rounded-md border border-border bg-surface px-2"
                aria-label="Vermenigvuldigingsfactor"
              />
              <Button type="button" size="sm" onClick={applyMultiply}>
                Toepassen
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setMultiplyOpen(false)}>
                Sluiten
              </Button>
            </div>
          )}
          {multiplyMessage && <p className="text-xs text-teal">{multiplyMessage}</p>}

          {textEditOpen ? (
            <IngredientTextInput
              mode="edit"
              initialText={rowsToText()}
              onAdd={applyTextEdit}
              onCancel={() => setTextEditOpen(false)}
            />
          ) : (
            <>
              {filledRows.length > 0 && (
                <div className="space-y-1.5">
                  {rows.map((row, i) =>
                    isEmptyRow(row) ? null : (
                    <IngredientLine
                      key={row.uid}
                      row={row}
                      units={unitsForDimension(row.baseUnitId, row.type === "ingrediënt" ? row.refId : null)}
                      currentUnit={row.unitId ? unitsById.get(row.unitId) ?? null : null}
                      cost={lineCosts[i]}
                      canViewFinancial={canViewFinancial}
                      priceDirection={
                        row.type === "ingrediënt" && row.refId
                          ? productPrices.get(row.refId)?.priceDirection ?? null
                          : null
                      }
                      purchasePrice={
                        row.type === "ingrediënt" && row.refId
                          ? productPrices.get(row.refId)?.purchasePrice ?? null
                          : null
                      }
                      packagingDescription={
                        row.type === "ingrediënt" && row.refId
                          ? productPrices.get(row.refId)?.packagingDescription ?? null
                          : null
                      }
                      conversionNote={
                        row.type === "ingrediënt" && row.refId
                          ? describeConversion(
                              productPrices.get(row.refId),
                              row.unitId ? unitsById.get(row.unitId) : null,
                              unitsById
                            )
                          : null
                      }
                      isDuplicate={duplicateIndexes.has(i)}
                      isIncomplete={incompleteLineIndexes.includes(i)}
                      companyId={referenceCompanyId}
                      searchOpen={searchUid === row.uid}
                      onSearchOpenChange={(open) => setSearchUid(open ? row.uid : null)}
                      onChange={(patch) => updateRow(i, patch)}
                      onRemove={() => removeRow(i)}
                      onDuplicate={() => duplicateRow(i)}
                      onMoveUp={() => moveRow(i, -1)}
                      onMoveDown={() => moveRow(i, 1)}
                      onPick={(picked) => handlePick(i, picked)}
                      onPickMore={addPickedRow}
                    />
                    )
                  )}
                </div>
              )}

              <IngredientTextInput onAdd={addText} />

              <div className="flex flex-wrap items-center gap-2">
                <IngredientSearch
                  companyId={referenceCompanyId}
                  onPick={addPickedRow}
                  onPickMore={addPickedRow}
                />
              </div>
            </>
          )}

          {recognitionStatus !== "leeg" && (
            <div
              role="status"
              className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                recognitionStatus === "groen"
                  ? "border-success/40 bg-success/10 text-success"
                  : recognitionStatus === "oranje"
                  ? "border-copper/40 bg-copper/10 text-copper"
                  : "border-danger/40 bg-danger/10 text-danger"
              }`}
            >
              <span className="font-medium">
                {recognitionStatus === "groen" &&
                  `Alle ${filledRows.length} ingrediënten zijn herkend en gekoppeld.`}
                {recognitionStatus === "oranje" &&
                  `Ingrediënten worden gezocht… (${searchingCount} nog bezig)`}
                {recognitionStatus === "rood" &&
                  `${unrecognizedRows.length} ingrediënt${unrecognizedRows.length === 1 ? "" : "en"} niet herkend — kies er een uit de database of maak een nieuw ingrediënt aan.`}
              </span>
              {recognitionStatus === "rood" && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setSearchUid(unrecognizedRows[0].uid)}
                >
                  Eerste oplossen
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
  );

  const geenFinancieelInzichtCard = (
    <Card>
      <CardContent className="py-4">
        <p className="text-sm text-muted">
          Kostprijs, inkoopprijzen en marge zijn hier niet zichtbaar voor jouw rol.
        </p>
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

          {/* Arbeid telt alleen mee als er een uurtarief is ingevuld. */}
          {Number(labourRate) > 0 &&
            (Number(labourKitchen) > 0 || Number(labourOther) > 0) && (
              <div className="rounded-md border border-border bg-background p-3 text-sm">
                <p className="text-muted">
                  Arbeid:{" "}
                  {(Number(labourKitchen) || 0) + (Number(labourOther) || 0)} min ×{" "}
                  € {Number(labourRate).toFixed(2)} / uur ={" "}
                  <strong className="text-foreground">
                    €{" "}
                    {(
                      (((Number(labourKitchen) || 0) + (Number(labourOther) || 0)) / 60) *
                      Number(labourRate)
                    ).toFixed(2)}
                  </strong>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Arbeidskosten worden apart getoond en tellen niet mee in de
                  ingrediëntkostprijs hierboven.
                </p>
              </div>
            )}

          {/* Maakt zichtbaar hoe de kostprijs per eenheid tot stand komt. */}
          {recipeKind === "halfproduct" && yieldQuantityNum > 0 && (
            <p className="rounded-md bg-teal/5 p-3 text-sm">
              <strong>€ {totalCost.toFixed(2)}</strong> totale kosten ÷{" "}
              <strong>
                {yieldQuantityNum} {baseUnitName ?? "basiseenheid"}
              </strong>{" "}
              opbrengst ={" "}
              <strong>
                € {(totalCost / yieldQuantityNum).toFixed(4)} per{" "}
                {baseUnitName ?? "basiseenheid"}
              </strong>
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 border-t border-border pt-3 sm:grid-cols-3">
            <Stat label="Totale kostprijs" value={`€ ${totalCost.toFixed(4)}`} emphasis />
            {recipeKind === "gerecht" ? (
              <>
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
              </>
            ) : (
              <>
                <Stat
                  label={`Prijs per ${baseUnitName ?? "basiseenheid"}`}
                  value={costPerBaseUnit !== null ? `€ ${costPerBaseUnit.toFixed(4)}` : "—"}
                  emphasis
                />
                {largerUnit && (
                  <Stat
                    label={`Prijs per ${largerUnit.name}`}
                    value={
                      costPerLargerUnit !== null ? `€ ${costPerLargerUnit.toFixed(2)}` : "—"
                    }
                  />
                )}
              </>
            )}
          </div>
          {recipeKind === "gerecht" && (
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
          )}
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
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">Bevat niet</p>
              {allergenSummary.free.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {allergenSummary.free.map((a) => (
                    <span
                      key={a}
                      className="rounded-full bg-success/10 px-2 py-0.5 text-xs capitalize text-success"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">
                  Niet vast te stellen zolang er ingrediënten zonder
                  allergeengegevens in het recept zitten.
                </p>
              )}
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">Onbekend</p>
              {allergenSummary.unknown.length > 0 ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {allergenSummary.unknown.map((a) => (
                      <span
                        key={a}
                        className="rounded-full bg-muted/10 px-2 py-0.5 text-xs capitalize text-muted"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-copper">
                    Eén of meer ingrediënten hebben nog geen allergenen ingevuld —
                    daardoor is voor deze allergenen niet te zeggen of ze voorkomen.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">
                  Alle 14 allergenen zijn bekend voor dit recept.
                </p>
              )}
            </div>
          </div>

          {Object.keys(nutritionTotals).length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">Voedingswaarden</p>
                <div className="flex gap-1 rounded-md border border-border bg-background p-0.5">
                  {(
                    [
                      ["totaal", "Hele halfproduct"],
                      ["per100", `Per 100 ${baseUnitName ?? "eenheden"}`],
                      ["portie", "Per portie"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setNutritionView(key)}
                      className={`rounded px-2 py-1 text-xs transition-colors ${
                        nutritionView === key
                          ? "bg-surface font-medium text-foreground shadow-sm"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {(() => {
                // Deelfactor bepalen; bij ontbrekende opbrengst of
                // portiegrootte tonen we het totaal met een uitleg in
                // plaats van een misleidend getal.
                const yieldQ = yieldQuantityNum;
                let factor = 1;
                let note: string | null = null;
                if (nutritionView === "per100") {
                  if (yieldQ > 0) factor = 100 / yieldQ;
                  else note = "Vul een opbrengst in om per 100 te kunnen rekenen.";
                } else if (nutritionView === "portie") {
                  // Halfproducten kennen (nog) geen portiegrootte; dan is
                  // "per portie" niet te berekenen zonder te gokken.
                  const portion = Number(initialRecipe?.portion_size ?? 0);
                  if (portion > 0 && yieldQ > 0) factor = portion / yieldQ;
                  else
                    note =
                      "Er is geen portiegrootte vastgelegd voor dit halfproduct, dus per portie is niet te berekenen. Hieronder staat het totaal.";
                }
                return (
                  <>
                    {note && <p className="mb-2 text-xs text-copper">{note}</p>}
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      {Object.entries(nutritionTotals).map(([key, value]) => (
                        <div key={key}>
                          <p className="text-xs capitalize text-muted">
                            {key.replace(/_/g, " ")}
                          </p>
                          <p className="tabular font-medium text-foreground">
                            {(value * (note ? 1 : factor)).toFixed(1)}
                            {key === "energie" ? " kcal" : " g"}
                          </p>
                          {key === "energie" && (
                            <p className="text-xs text-muted">
                              {(value * (note ? 1 : factor) * 4.184).toFixed(0)} kJ
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
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
            <Link href="#producties">
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
        onClick={goBack}
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
    <form
      id="recipe-form"
      onSubmit={(e) => handleSubmit(e)}
      onKeyDown={(e) => {
        // Enter in een los invoerveld (bv. Hoeveelheid) mag het hele
        // formulier niet versturen — dat stuurt je terug naar het
        // overzicht en verliest alle ingevulde regels. Alleen een
        // expliciete klik op "Opslaan" mag opslaan.
        const target = e.target as HTMLElement;
        if (e.key === "Enter" && target.tagName === "INPUT") {
          e.preventDefault();
        }
      }}
      className="space-y-4"
    >
      {(() => {
        const tabs: { key: typeof formTab; label: string }[] = [
          { key: "algemeen", label: "Algemeen" },
          ...(canViewFinancial ? [{ key: "financieel" as const, label: "Financieel" }] : []),
          { key: "voeding", label: "Voedingswaarde" },
          { key: "galerij", label: "Galerij" },
          ...(gebruiktInCard ? [{ key: "gebruikt" as const, label: "Gebruik" }] : []),
          ...(isEdit ? [{ key: "historie" as const, label: "Historie" }] : []),
        ];
        return (
          <div className="flex gap-1 border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setFormTab(t.key)}
                className={`border-b-2 px-3 py-2 text-sm transition-colors ${
                  formTab === t.key
                    ? "border-teal font-medium text-teal"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        );
      })()}

      {/* Algemeen: wat het is, wat erin zit, hoe het gemaakt wordt.
          De overige tabs blijven gemonteerd (verborgen) zodat één keer
          opslaan alle velden bewaart, ongeacht welke tab open staat. */}
      <div className={formTab === "algemeen" ? "space-y-4" : "hidden"}>
        {basisgegevensCard}
        {ingredientenCard}
        {bereidingCard}
      </div>
      <div className={formTab === "galerij" ? "space-y-4" : "hidden"}>
        {galerijCard}
      </div>
      <div className={formTab === "voeding" ? "space-y-4" : "hidden"}>
        {allergenenCard}
      </div>
      {formTab === "financieel" && (
        <div className="space-y-4">
          {canViewFinancial ? (
            <>
              {kostprijsCard}
              {initialRecipe && (
                <RecipeFinancialTable
                  recipeId={initialRecipe.id}
                  yieldQuantity={yieldQuantityNum || initialRecipe.yield_quantity}
                  baseUnitName={baseUnitName}
                  wastePercentage={Number(wastePct) || 0}
                  marginFreeCosts={marginFreeCostsNum || 0}
                  labourCost={
                    Number(labourRate) > 0
                      ? (((Number(labourKitchen) || 0) + (Number(labourOther) || 0)) / 60) *
                        Number(labourRate)
                      : 0
                  }
                />
              )}
            </>
          ) : (
            geenFinancieelInzichtCard
          )}
        </div>
      )}
      {formTab === "gebruikt" && gebruiktInCard && (
        <div className="space-y-4">{gebruiktInCard}</div>
      )}
      {formTab === "historie" && initialRecipe && (
        <RecipeHistory recipeId={initialRecipe.id} />
      )}
      {errorBlock}
      {buttonsBlock}

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
    uid: newRowUid(),
    type: "ingrediënt",
    refId: null,
    refName: null,
    unmatchedName: null,
    unmatchedArticleNumber: null,
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
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  span2?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : undefined}>
      <label className="mb-1 block text-sm font-medium text-foreground">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
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
  canViewFinancial,
  priceDirection,
  purchasePrice,
  packagingDescription,
  conversionNote,
  isDuplicate,
  isIncomplete,
  companyId,
  currentUnit,
  searchOpen,
  onSearchOpenChange,
  onChange,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onPick,
  onPickMore,
}: {
  row: IngredientRow;
  units: Unit[];
  cost: number | null;
  canViewFinancial: boolean;
  priceDirection?: "up" | "down" | null;
  purchasePrice?: number | null;
  packagingDescription?: string | null;
  conversionNote?: string | null;
  isDuplicate: boolean;
  isIncomplete: boolean;
  companyId: string | null;
  currentUnit: Unit | null;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<IngredientRow>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPick: (picked: PickedIngredient) => void;
  onPickMore?: (picked: PickedIngredient) => void;
}) {
  // Verlies %, optioneel en opmerking staan ingeklapt tenzij ze gevuld zijn.
  const [expanded, setExpanded] = useState(
    Boolean(row.lossPercentage || row.isOptional || row.note)
  );
  const qty = parseFloat(row.quantity);
  const pricePerUnit =
    cost !== null && Number.isFinite(qty) && qty > 0 ? cost / qty : null;
  const unitName = units.find((u) => u.id === row.unitId)?.name ?? null;

  const isLinked = Boolean(row.refId);
  const isSearching = !isLinked && row.matchState === "zoekt";
  const label = row.refName ?? row.unmatchedName ?? "";

  // Een eenheid die uit de tekst komt maar niet bij dit ingrediënt past,
  // blijft zichtbaar in de keuzelijst zodat niets stilzwijgend verandert.
  const currentUnitMissing = currentUnit && !units.some((u) => u.id === currentUnit.id);

  const statusColor = isLinked
    ? "bg-success"
    : isSearching
    ? "bg-copper animate-pulse"
    : "bg-danger";
  const statusText = isLinked
    ? "Gekoppeld aan een ingrediënt"
    : isSearching
    ? "Wordt gezocht…"
    : row.matchState === "meerdere"
    ? "Meerdere mogelijkheden — kies het juiste ingrediënt"
    : "Niet herkend — kies een ingrediënt of maak een nieuw aan";

  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        !isLinked && !isSearching
          ? "border-danger/40 bg-danger/5"
          : isDuplicate
          ? "border-copper/50 bg-copper/5"
          : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusColor}`}
          title={statusText}
          aria-label={statusText}
        />
        <input
          type="number"
          step="any"
          placeholder="Hoeveel"
          aria-label="Hoeveelheid"
          value={row.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          className="h-8 w-20 rounded-md border border-border bg-surface px-2 text-sm"
        />
        <select
          aria-label="Eenheid"
          value={row.unitId ?? ""}
          onChange={(e) => onChange({ unitId: e.target.value || null })}
          className="h-8 w-28 rounded-md border border-border bg-surface px-1.5 text-sm"
        >
          <option value="">Eenheid…</option>
          {currentUnitMissing && currentUnit && (
            <option value={currentUnit.id}>{currentUnit.name} (past niet bij ingrediënt)</option>
          )}
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => onSearchOpenChange(true)}
          className="flex min-w-[10rem] flex-1 items-center gap-1.5 truncate rounded-md px-1 py-1 text-left text-sm hover:bg-surface"
          title={isLinked ? "Klik om een ander ingrediënt te kiezen" : statusText}
        >
          {isLinked ? (
            row.type === "ingrediënt" ? (
              <Package className="h-3.5 w-3.5 shrink-0 text-teal" />
            ) : (
              <SoupIcon className="h-3.5 w-3.5 shrink-0 text-copper" />
            )
          ) : (
            <TriangleAlert
              className={`h-3.5 w-3.5 shrink-0 ${isSearching ? "text-copper" : "text-danger"}`}
            />
          )}
          <span className={`truncate ${isLinked ? "text-foreground" : isSearching ? "text-copper" : "font-medium text-danger"}`}>
            {label || "Ingrediënt kiezen…"}
          </span>
          {!isLinked && !isSearching && (
            <span className="shrink-0 text-xs text-danger">— kiezen</span>
          )}
          {isSearching && <span className="shrink-0 text-xs text-copper">zoeken…</span>}
        </button>

        {canViewFinancial && (
          <div className="tabular flex w-28 shrink-0 items-center justify-end gap-1 text-sm font-medium">
            {priceDirection === "up" && (
              <TrendingUp className="h-3 w-3 shrink-0 text-danger" aria-label="Prijs recent gestegen" />
            )}
            {priceDirection === "down" && (
              <TrendingDown className="h-3 w-3 shrink-0 text-success" aria-label="Prijs recent gedaald" />
            )}
            <span className={isIncomplete ? "text-copper" : "text-foreground"}>
              {cost !== null ? `€ ${cost.toFixed(4)}` : isIncomplete ? "onvolledig" : "—"}
            </span>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onMoveUp} className="text-muted hover:text-foreground" title="Omhoog">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onMoveDown} className="text-muted hover:text-foreground" title="Omlaag">
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onDuplicate} className="text-muted hover:text-teal" title="Regel kopiëren">
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-muted hover:text-foreground"
            title="Verlies %, optioneel en opmerking"
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onRemove} className="text-muted hover:text-danger" title="Regel verwijderen">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Onder de regel: alleen wat helpt bij controleren. */}
      {(isLinked && row.type === "halfproduct") ||
      (isLinked && (purchasePrice != null || packagingDescription)) ||
      conversionNote ||
      isDuplicate ? (
        <div className="ml-4 mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
          {isLinked && row.type === "halfproduct" && (
            <Link
              href={`/halfproducten/${row.refId}/bewerken`}
              target="_blank"
              className="text-teal hover:underline"
            >
              Halfproduct openen →
            </Link>
          )}
          {isLinked && row.type === "ingrediënt" && (purchasePrice != null || packagingDescription) && (
            <span>
              {packagingDescription ?? "onbekende verpakking"}
              {canViewFinancial && purchasePrice != null && ` · € ${purchasePrice.toFixed(2)} inkoop`}
              {canViewFinancial && pricePerUnit !== null && ` · € ${pricePerUnit.toFixed(4)} / ${unitName ?? "eenh."}`}
            </span>
          )}
          {conversionNote && (
            <span
              className="text-teal"
              title="Deze omrekening is gebruikt om de kostprijs van deze regel te bepalen"
            >
              omgerekend met {conversionNote}
            </span>
          )}
          {isDuplicate && (
            <span className="flex items-center gap-1 text-copper">
              <TriangleAlert className="h-3 w-3" />
              staat al op een andere regel
            </span>
          )}
        </div>
      ) : null}

      {expanded && (
        <div className="ml-4 mt-1.5 flex flex-wrap items-center gap-2">
          {row.type === "ingrediënt" && (
            <input
              type="number"
              step="0.01"
              placeholder="Verlies %"
              aria-label="Verlies %"
              value={row.lossPercentage}
              onChange={(e) => onChange({ lossPercentage: e.target.value })}
              className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-sm"
            />
          )}
          <label className="flex h-8 items-center gap-1 text-sm text-muted">
            <input
              type="checkbox"
              checked={row.isOptional}
              onChange={(e) => onChange({ isOptional: e.target.checked })}
            />
            Optioneel
          </label>
          <input
            placeholder="Opmerking"
            aria-label="Opmerking"
            value={row.note}
            onChange={(e) => onChange({ note: e.target.value })}
            className="h-8 min-w-[12rem] flex-1 rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>
      )}

      {/* Het zoekvenster hoort bij deze regel en opent op de ingetypte naam. */}
      <IngredientSearch
        companyId={companyId}
        open={searchOpen}
        onOpenChange={onSearchOpenChange}
        initialQuery={row.unmatchedName ?? undefined}
        hideTrigger
        onPick={onPick}
        onPickMore={onPickMore}
      />
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


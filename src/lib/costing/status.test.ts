import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STATIC_UNITS_BY_KEY } from "@/lib/packaging";
import { halfproductLineCost, ingredientLineCost, recipeTotals } from "./index";
import {
  COMPLETE,
  costDisplay,
  describeIssue,
  formCostStatus,
  groupAttentionItems,
  toCostStatus,
  type AttentionItem,
  type CostStatus,
} from "./status";

const U = STATIC_UNITS_BY_KEY;
const u = (k: string) => U.get(k)!;
const info = (price: number | null) =>
  price === null ? null : { pricePerBaseUnit: price, defaultLossPct: null, avgUnitQuantity: null, avgUnitId: null };

/** Zoals het receptformulier: regelkosten via de bestaande functies, status erbovenop. */
function form(
  rows: {
    type: "ingrediënt" | "halfproduct";
    name: string | null;
    refId: string | null;
    qty: number;
    unit: string;
    price?: number | null;
    sub?: { yieldQuantity: number | null; totalCost: number; status: CostStatus };
  }[],
) {
  const halfproductStatus = new Map<string, CostStatus>();
  const lines = rows.map((r) => {
    let cost: number | null = null;
    if (r.refId && r.type === "ingrediënt") {
      const i = info(r.price ?? null);
      cost = i
        ? ingredientLineCost({ quantity: r.qty, unit: u(r.unit), baseUnit: u("g"), info: i, unitsById: U, lineLossPct: null })
        : null;
    }
    if (r.refId && r.type === "halfproduct" && r.sub) {
      halfproductStatus.set(r.refId, r.sub.status);
      cost = halfproductLineCost({
        quantity: r.qty, unit: u(r.unit), baseUnit: u("g"),
        yieldQuantity: r.sub.yieldQuantity, totalCost: r.sub.totalCost, unitsById: U,
      });
    }
    return {
      type: r.type,
      refId: r.refId,
      refName: r.name,
      unmatchedName: r.refId ? null : r.name,
      quantity: String(r.qty),
      unitName: r.unit,
      cost,
      hasPrice: r.type === "ingrediënt" ? r.price != null : undefined,
      hasYield: r.type === "halfproduct" ? !!r.sub?.yieldQuantity : undefined,
    };
  });
  const status = formCostStatus({ rows: lines, halfproductStatus });
  const sum = (t: string) => lines.filter((l) => l.type === t).reduce((s, l) => s + (l.cost ?? 0), 0);
  const { totalCost } = recipeTotals({
    ingredientCost: sum("ingrediënt"), halfproductCost: sum("halfproduct"),
    wastePct: 0, marginFreeCosts: 0, yieldQuantity: 0, isHalfproduct: false,
  });
  return { status, totalCost };
}

describe("Kostprijs onvolledig — receptformulier", () => {
  it("complete kostprijs: foodcost en marge zichtbaar", () => {
    const { status, totalCost } = form([
      { type: "ingrediënt", name: "Mozzarella", refId: "kaas", qty: 100, unit: "g", price: 0.02 },
      { type: "halfproduct", name: "Pizza saus", refId: "saus", qty: 150, unit: "g", sub: { yieldQuantity: 1000, totalCost: 4, status: COMPLETE } },
    ]);
    assert.equal(status.isComplete, true);
    assert.ok(Math.abs(totalCost - 2.6) < 1e-9);
    const d = costDisplay(totalCost, status, 10);
    assert.equal(d.label, "Kostprijs");
    assert.ok(Math.abs(d.foodcostPct! - 26) < 1e-9);
    assert.ok(Math.abs(d.margin! - 7.4) < 1e-9);
  });

  it("ontbrekende prijs: alleen 'Bekende kosten', geen foodcost/marge, regel benoemd", () => {
    const { status, totalCost } = form([
      { type: "ingrediënt", name: "Mozzarella", refId: "kaas", qty: 125, unit: "g", price: 0.02 },
      { type: "ingrediënt", name: "Basilicum", refId: "bas", qty: 5, unit: "g", price: null },
    ]);
    assert.equal(status.isComplete, false);
    assert.equal(status.issues.length, 1);
    assert.equal(status.issues[0].kind, "prijs");
    assert.equal(describeIssue(status.issues[0]), "Basilicum: geen inkoopprijs");
    const d = costDisplay(totalCost, status, 10);
    assert.equal(d.label, "Bekende kosten");
    assert.equal(d.amount, 2.5);
    assert.equal(d.foodcostPct, null);
    assert.equal(d.margin, null);
  });

  it("ontbrekende koppeling in een onderliggend halfproduct werkt door, met pad", () => {
    // Status zoals de database die voor "Pesto dressing" teruggeeft.
    const dressing = toCostStatus({
      is_complete: false,
      issues: [{ line_id: "l1", recipe_id: "pesto", recipe_name: "Pesto", kind: "koppeling", name: "Pijnboompitten",
        product_id: null, sub_recipe_id: null, unit_name: "gram", path: ["Pesto"] }],
    });
    const { status, totalCost } = form([
      { type: "halfproduct", name: "Pesto dressing", refId: "dressing", qty: 100, unit: "g", sub: { yieldQuantity: 1000, totalCost: 2, status: dressing } },
    ]);
    assert.equal(status.isComplete, false);
    assert.deepEqual(status.issues[0].path, ["Pesto dressing", "Pesto"]);
    assert.equal(describeIssue(status.issues[0]), "Pesto dressing › Pesto › Pijnboompitten: niet gekoppeld");
    assert.equal(costDisplay(totalCost, status, 12).foodcostPct, null);
  });

  it("ongekoppelde regel en niet-om-te-rekenen eenheid", () => {
    const { status } = form([
      { type: "ingrediënt", name: "Pizza saus", refId: null, qty: 30, unit: "g" },
      { type: "halfproduct", name: "Pesto", refId: "pesto", qty: 1, unit: "stuk", sub: { yieldQuantity: 500, totalCost: 3, status: COMPLETE } },
    ]);
    assert.deepEqual(status.issues.map((i) => i.kind), ["koppeling", "omrekening"]);
  });
});

describe("Opschonen — groeperen en voorrang", () => {
  const item = (o: Partial<AttentionItem>): AttentionItem => ({
    line_id: Math.random().toString(36), recipe_id: "r", recipe_name: "Recept", recipe_kind: "gerecht",
    kind: "koppeling", name: "x", product_id: null, sub_recipe_id: null, unit_name: null, active_sources: [], ...o,
  });

  it("terugkerende naam = één groep (hoofdletters/spaties maken niet uit); actief gaat voor", () => {
    const groups = groupAttentionItems([
      item({ name: "Knoflook", recipe_id: "a", recipe_name: "A" }),
      item({ name: "Knoflook", recipe_id: "b", recipe_name: "B" }),
      item({ name: "Knoflook", recipe_id: "c", recipe_name: "C" }),
      item({ name: "Pizza saus", recipe_id: "d", recipe_name: "Margherita", active_sources: ["Menukaart Zomer"] }),
      item({ name: "pizza  saus ", recipe_id: "e", recipe_name: "Calzone" }),
      item({ kind: "prijs", name: "Basilicum", product_id: "bas", recipe_id: "f", recipe_name: "Caprese", active_sources: ["Buffet Bruiloft"] }),
    ]);
    assert.deepEqual(groups.map((g) => g.name), ["Pizza saus", "Basilicum", "Knoflook"]);
    const saus = groups[0]; // beide actief; Pizza saus in meer recepten
    assert.equal(saus.recipeCount, 2);
    assert.equal(saus.activeCount, 1);
    assert.equal(saus.items[0].recipe_name, "Margherita"); // actief recept bovenaan
  });
});

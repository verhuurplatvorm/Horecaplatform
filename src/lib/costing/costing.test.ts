import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STATIC_UNITS_BY_KEY } from "@/lib/packaging";
import { approximateMeasure, foodcostAndMargin, halfproductLineCost, ingredientLineCost, recipeTotals } from "./index";

const U = STATIC_UNITS_BY_KEY;
const u = (k: string) => U.get(k)!;
const close = (a: number | null, b: number, tol = 1e-4) =>
  assert.ok(a !== null && Math.abs(a - b) < tol, `${a} ≈ ${b}`);

// Barra Gallega: 18 × 260 g voor € 30,81 → base stuk, € 1,7117/stuk, 260 g per stuk
const barra = { pricePerBaseUnit: 30.81 / 18, defaultLossPct: null, avgUnitQuantity: 260, avgUnitId: "g" };

describe("ingredientLineCost", () => {
  it("1 stuk Barra Gallega = € 1,7117", () => {
    close(ingredientLineCost({ quantity: 1, unit: u("stuk"), baseUnit: u("stuk"), info: barra, unitsById: U, lineLossPct: null }), 1.7117);
  });
  it("100 g Barra Gallega = € 0,6583", () => {
    close(ingredientLineCost({ quantity: 100, unit: u("g"), baseUnit: u("stuk"), info: barra, unitsById: U, lineLossPct: null }), 0.6583);
  });
  it("1 kg Barra Gallega = € 6,5833", () => {
    close(ingredientLineCost({ quantity: 1, unit: u("kg"), baseUnit: u("stuk"), info: barra, unitsById: U, lineLossPct: null }), 6.5833);
  });
  it("gram zonder brug op stuks-product kan niet (null)", () => {
    const info = { pricePerBaseUnit: 1, defaultLossPct: null, avgUnitQuantity: null, avgUnitId: null };
    assert.equal(ingredientLineCost({ quantity: 100, unit: u("g"), baseUnit: u("stuk"), info, unitsById: U, lineLossPct: null }), null);
  });
  it("verlies op de regel telt mee; standaardverlies vervalt bij netto", () => {
    const info = { pricePerBaseUnit: 0.01, defaultLossPct: 10, avgUnitQuantity: null, avgUnitId: null };
    close(ingredientLineCost({ quantity: 1000, unit: u("g"), baseUnit: u("g"), info, unitsById: U, lineLossPct: 20 }), 12);
    close(ingredientLineCost({ quantity: 1000, unit: u("g"), baseUnit: u("g"), info, unitsById: U, lineLossPct: null }), 11);
    const net = { ...info, avgUnitQuantity: 180, avgUnitId: "g", netUnitQuantity: 130 };
    close(ingredientLineCost({ quantity: 1000, unit: u("g"), baseUnit: u("g"), info: net, unitsById: U, lineLossPct: null }), 10);
  });
  it("bier 24 × 33 cl per stuk; 1 l = 3,03 stuks", () => {
    const bier = { pricePerBaseUnit: 24 / 24, defaultLossPct: null, avgUnitQuantity: 33, avgUnitId: "cl" };
    close(ingredientLineCost({ quantity: 1, unit: u("stuk"), baseUnit: u("stuk"), info: bier, unitsById: U, lineLossPct: null }), 1);
    close(ingredientLineCost({ quantity: 1, unit: u("l"), baseUnit: u("stuk"), info: bier, unitsById: U, lineLossPct: null }), 100 / 33 / 1, 1e-3);
  });
});

describe("halfproductLineCost", () => {
  it("aandeel van opbrengst × totale kostprijs", () => {
    close(halfproductLineCost({ quantity: 500, unit: u("g"), baseUnit: u("kg"), yieldQuantity: 2, totalCost: 10, unitsById: U }), 2.5);
  });
  it("zonder opbrengst → null", () => {
    assert.equal(halfproductLineCost({ quantity: 1, unit: u("g"), baseUnit: u("g"), yieldQuantity: 0, totalCost: 10, unitsById: U }), null);
  });
});

describe("recipeTotals / foodcost", () => {
  it("afval%, marge-vrije kosten en kostprijs per eenheid", () => {
    const t = recipeTotals({ ingredientCost: 8, halfproductCost: 2, wastePct: 10, marginFreeCosts: 1, yieldQuantity: 4, isHalfproduct: true });
    close(t.totalCost, 12);
    close(t.costPerBaseUnit, 3);
  });
  it("gerecht heeft geen kostprijs per eenheid", () => {
    assert.equal(recipeTotals({ ingredientCost: 1, halfproductCost: 0, wastePct: 0, marginFreeCosts: 0, yieldQuantity: 1, isHalfproduct: false }).costPerBaseUnit, null);
  });
  it("foodcost en marge", () => {
    const r = foodcostAndMargin(3, 10);
    close(r.foodcostPct, 30);
    close(r.margin, 7);
    assert.equal(foodcostAndMargin(3, 0).foodcostPct, null);
  });
});

describe("approximateMeasure (in de buurt)", () => {
  it("10 liter + 100 g ≈ 10100 ml", () => {
    const l = approximateMeasure(10, u("l"), u("ml"));
    const g = approximateMeasure(100, u("g"), u("ml"));
    close((l ?? 0) + (g ?? 0), 10100);
  });
  it("5 kg + 120 ml ≈ 5120 g", () => {
    const kg = approximateMeasure(5, u("kg"), u("g"));
    const ml = approximateMeasure(120, u("ml"), u("g"));
    close((kg ?? 0) + (ml ?? 0), 5120);
  });
  it("stuk is niet te benaderen", () => {
    assert.equal(approximateMeasure(2, u("stuk"), u("g")), null);
  });
});

describe("halfproduct in stuks (bol vanille ijs: 45 bollen uit een bak van € 20,75)", () => {
  it("2 bollen in een gerecht = 2/45 van de bak", () => {
    close(
      halfproductLineCost({ quantity: 2, unit: u("stuk"), baseUnit: u("stuk"), yieldQuantity: 45, totalCost: 20.75, unitsById: U }),
      (2 / 45) * 20.75
    );
  });
  it("1 bol kost € 0,4611", () => {
    close(
      halfproductLineCost({ quantity: 1, unit: u("stuk"), baseUnit: u("stuk"), yieldQuantity: 45, totalCost: 20.75, unitsById: U }),
      0.4611
    );
  });
  it("kostprijs per stuk volgt uit totaal / aantal", () => {
    const t = recipeTotals({ ingredientCost: 20.75, halfproductCost: 0, wastePct: 0, marginFreeCosts: 0, yieldQuantity: 45, isHalfproduct: true });
    close(t.costPerBaseUnit, 0.4611);
  });
});

describe("ml telt als gram", () => {
  it("stuk met inhoud-brug rekent om naar gram/kilogram", async () => {
    const { convertQuantity } = await import("@/lib/units/convert");
    const byId = new Map([u("stuk"), u("ml"), u("g"), u("kg")].map((x) => [x.id, x]));
    const bridge = { avgUnitQuantity: 10000, avgUnitId: u("ml").id, netUnitQuantity: null };
    // 0,2 stuk = 2000 ml = 2000 g = 2 kg
    assert.equal(convertQuantity(0.2, u("stuk"), u("kg"), bridge, byId), 2);
    // zonder stuk: 500 ml telt als 500 g
    assert.equal(convertQuantity(500, u("ml"), u("g"), null, byId), 500);
  });
});

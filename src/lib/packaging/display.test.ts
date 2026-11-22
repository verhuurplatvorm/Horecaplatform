import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatUnitPrice, measureDimension, pricesFromCount, unitPriceLines } from "./index";

const labels = (r: ReturnType<typeof unitPriceLines>) => r.extra.map((l) => l.label);
const close = (a: number | null | undefined, b: number, tol = 1e-4) =>
  assert.ok(a !== null && a !== undefined && Math.abs(a - b) < tol, `${a} ≈ ${b}`);

describe("Barra Gallega 18 × 260 g (€ 30,81 per verpakking)", () => {
  it("inkoopverpakking blijft 18 stuks; prijs per stuk en per kg, géén literprijs", () => {
    const p = pricesFromCount(30.81, 18, "stuk", { quantity: 260, unit: "g" });
    close(p.perBase, 1.7117);
    close(p.perPiece, 1.7117);
    close(p.perKg, 6.5833);
    close(p.perGram, 0.006583);
    assert.equal(p.perLiter, null);
  });
  it("lijstweergave: € 1,7117 / stuk, € 0,0066 / g, € 6,58 / kg", () => {
    const r = unitPriceLines({ pricePerBase: 30.81 / 18, baseUnit: "stuk", bridgeQuantity: 260, bridgeUnit: "g" });
    assert.equal(formatUnitPrice(r.primary!), "€ 1,7117 / stuk");
    assert.deepEqual(r.extra.map(formatUnitPrice), ["€ 0,0066 / g", "€ 6,58 / kg"]);
  });
});

describe("zelfde eenheidsregels voor andere verpakkingen", () => {
  it("stuks zonder (geldig) gewicht: alleen per stuk", () => {
    assert.deepEqual(labels(unitPriceLines({ pricePerBase: 0.34, baseUnit: "stuk" })), []);
    assert.deepEqual(labels(unitPriceLines({ pricePerBase: 0.34, baseUnit: "stuk", bridgeQuantity: 0, bridgeUnit: "g" })), []);
    assert.deepEqual(labels(unitPriceLines({ pricePerBase: 0.34, baseUnit: "stuk", bridgeQuantity: 2, bridgeUnit: "stuk" })), []);
  });
  it("bier 24 × 33 cl per stuk: per stuk en per liter, géén kiloprijs", () => {
    const r = unitPriceLines({ pricePerBase: 1, baseUnit: "stuk", bridgeQuantity: 33, bridgeUnit: "cl" });
    assert.deepEqual(labels(r), ["l"]);
    close(r.extra[0].value, 100 / 33, 1e-3);
  });
  it("gewicht (g): per kg, nooit per liter", () => {
    const r = unitPriceLines({ pricePerBase: 0.00625, baseUnit: "g" });
    assert.deepEqual(labels(r), ["kg"]);
    close(r.extra[0].value, 6.25);
    assert.equal(pricesFromCount(31.25, 5000, "g").perLiter, null);
  });
  it("inhoud (ml): per liter, nooit per kg", () => {
    const r = unitPriceLines({ pricePerBase: 0.00285, baseUnit: "ml" });
    assert.deepEqual(labels(r), ["l"]);
    assert.equal(pricesFromCount(14.25, 5000, "ml").perKg, null);
  });
  it("gewicht met bekend stukgewicht (avocado 180 g, netto 130 g): ook per stuk", () => {
    const r = unitPriceLines({ pricePerBase: 0.01, baseUnit: "g", bridgeQuantity: 180, bridgeUnit: "g", netQuantity: 130 });
    assert.deepEqual(labels(r), ["stuk", "kg"]);
    close(r.extra[0].value, 1.3); // kostprijs per stuk op netto bruikbaar gewicht
  });
  it("kilo als basiseenheid: per gram erbij, niet nog eens per kg", () => {
    assert.deepEqual(labels(unitPriceLines({ pricePerBase: 6.25, baseUnit: "kg" })), ["g"]);
  });
  it("geen prijs of onbekende eenheid: niets tonen", () => {
    assert.equal(unitPriceLines({ pricePerBase: null, baseUnit: "stuk" }).primary, null);
    assert.equal(unitPriceLines({ pricePerBase: 1, baseUnit: "doos" }).primary, null);
  });
  it("meetdimensie", () => {
    assert.equal(measureDimension("stuk", { quantity: 260, unit: "g" }), "gewicht");
    assert.equal(measureDimension("stuk", { quantity: 33, unit: "cl" }), "inhoud");
    assert.equal(measureDimension("stuk", null), "aantal");
    assert.equal(measureDimension("ml"), "inhoud");
  });
});

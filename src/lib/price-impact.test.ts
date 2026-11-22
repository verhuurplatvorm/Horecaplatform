import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregateImpact, describeCause, type ImpactRow } from "./price-impact";

// Zelfde scenario als de SQL-test: tomaat € 4 → € 6 per kg, daarna kaas € 20 → € 30 per kg.
const row = (o: Partial<ImpactRow>): ImpactRow => ({
  product_id: "tomaat", product_name: "Tomaat", recipe_id: "x", recipe_name: "x", recipe_kind: "gerecht",
  category: null, via: [], old_cost: 0, new_cost: 0, delta: 0, sales_price_excl: null, active_cards: [], ...o,
});
const rows: ImpactRow[] = [
  row({ recipe_id: "saus", recipe_name: "Pizza saus", recipe_kind: "halfproduct", old_cost: 4, new_cost: 6, delta: 2 }),
  row({ recipe_id: "marg", recipe_name: "Margherita", via: ["Pizza saus"], old_cost: 3.6, new_cost: 3.9, delta: 0.3, sales_price_excl: 10, active_cards: ["Dinerkaart Het Strand"] }),
  row({ product_id: "kaas", product_name: "Kaas", recipe_id: "marg", recipe_name: "Margherita", old_cost: 2.9, new_cost: 3.9, delta: 1, sales_price_excl: 10, active_cards: ["Dinerkaart Het Strand"] }),
  row({ recipe_id: "calz", recipe_name: "Calzone", via: ["Pizza saus"], old_cost: 0.4, new_cost: 0.6, delta: 0.2, sales_price_excl: 11.83 }),
  row({ recipe_id: "penne", recipe_name: "Penne arrabbiata", via: ["Arrabbiata", "Pizza saus"], old_cost: 0.5, new_cost: 0.7, delta: 0.2, active_cards: ["Dinerkaart Het Strand"] }),
];

describe("Prijsontwikkeling — gevolgen per gerecht", () => {
  it("één wijziging (tomaat) via een halfproduct in meerdere gerechten, actieve kaart eerst", () => {
    const list = aggregateImpact(rows, "tomaat").filter((r) => r.kind === "gerecht");
    assert.deepEqual(list.map((r) => r.name), ["Margherita", "Penne arrabbiata", "Calzone"]);
    const marg = list[0];
    assert.deepEqual([marg.oldCost, marg.newCost, marg.delta], [3.6, 3.9, 0.3]);
    assert.equal(describeCause(marg.causes[0]), "Pizza saus › Tomaat");
    assert.equal(describeCause(list[1].causes[0]), "Arrabbiata › Pizza saus › Tomaat");
    assert.ok(Math.abs(marg.oldFoodcostPct! - 36) < 1e-9 && Math.abs(marg.newFoodcostPct! - 39) < 1e-9);
  });

  it("alle wijzigingen samen: verschillen tellen op, nieuw = huidige kostprijs", () => {
    const marg = aggregateImpact(rows).find((r) => r.recipeId === "marg")!;
    assert.equal(marg.delta, 1.3);
    assert.equal(marg.newCost, 3.9);
    assert.equal(marg.oldCost, 2.6);
    assert.deepEqual(marg.causes.map((c) => c.productName), ["Kaas", "Tomaat"]);
  });

  it("halfproducten apart te tonen", () => {
    const hp = aggregateImpact(rows).filter((r) => r.kind === "halfproduct");
    assert.deepEqual(hp.map((r) => [r.name, r.oldCost, r.newCost]), [["Pizza saus", 4, 6]]);
  });
});

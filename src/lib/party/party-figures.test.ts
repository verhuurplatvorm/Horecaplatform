import { test } from "node:test";
import assert from "node:assert/strict";
import { partyLineFigures, formatPartyAmount } from "./party-calc";

// Cijfers zoals get_event_menu_party_plan ze teruggeeft (geverifieerd in SQL):
// 70 gasten × 100% × 60 g, schaal 1,2 kg.
const base = {
  container: "schaal", capacity: 1.2, capacity_unit: "kg", needed: 4.2,
};

test("volle schalen: 4 × 1,2 kg, 600 g over, kosten alleen met rechten", () => {
  const row = { ...base, containers: 4, full_containers: true, produced: 4.8,
    last_container: 1.2, difference: 0.6, total_cost: 164.8, overproduction_cost: 20.6 };
  const f = partyLineFigures(row, true);
  assert.equal(f.needed, "4,2 kg");
  assert.equal(f.produced, "4,8 kg");
  assert.match(f.distribution, /^4 .* van 1,2 kg$/);
  assert.equal(f.leftover, "600 g");
  assert.equal(f.productionCost, 164.8);
  assert.equal(f.leftoverCost, 20.6);
  const g = partyLineFigures(row, false);
  assert.equal(g.productionCost, null);
  assert.equal(g.leftoverCost, null);
});

test("laatste schaal aanpassen: 3 × 1,2 kg + 1 × 600 g, niets over", () => {
  const row = { ...base, containers: 4, full_containers: false, produced: 4.2,
    last_container: 0.6, difference: 0, total_cost: 144.2, overproduction_cost: 0 };
  const f = partyLineFigures(row, true);
  assert.equal(f.produced, "4,2 kg");
  assert.match(f.distribution, /^3 .* van 1,2 kg \+ 1 .* van 600 g$/);
  assert.equal(f.leftover, null);
  assert.equal(f.productionCost, 144.2);
});

test("eenheden", () => {
  assert.equal(formatPartyAmount(0.6, "kg"), "600 g");
  assert.equal(formatPartyAmount(1.5, "l"), "1,5 l");
  assert.equal(formatPartyAmount(1, "stuk"), "1 stuk");
});

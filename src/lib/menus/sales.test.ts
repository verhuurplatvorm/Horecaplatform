import { test } from "node:test";
import assert from "node:assert/strict";
import { foodcostPct, menuSales, tierAmount } from "./sales";

const kok = { name: "Kok bij de BBQ", kind: "staffel" as const, amount: 0, vat_rate: 21, is_selected: true,
  tiers: [{ tot: 40, bedrag: 150 }, { tot: 100, bedrag: 250 }, { tot: null, bedrag: 300 }] };

test("minimum personen: BBQ Beach t/m 25 personen = 937,50", () => {
  const s = menuSales({ personCount: 18, minPersons: 25, pricePerPerson: 37.5, vatRate: 9, sections: [], charges: [] });
  assert.equal(s.baseIncl, 937.5);
  assert.equal(s.minimumApplies, true);
  const t = menuSales({ personCount: 40, minPersons: 25, pricePerPerson: 37.5, vatRate: 9, sections: [], charges: [] });
  assert.equal(t.baseIncl, 1500);
});

test("staffel kok bij de BBQ", () => {
  assert.equal(tierAmount(kok.tiers, 40), 150);
  assert.equal(tierAmount(kok.tiers, 41), 250);
  assert.equal(tierAmount(kok.tiers, 100), 250);
  assert.equal(tierAmount(kok.tiers, 101), 300);
});

test("opties en toeslagen; foodcost alleen over eten", () => {
  const s = menuSales({
    personCount: 50, minPersons: 25, pricePerPerson: 45.5, vatRate: 9,
    sections: [
      { name: "Optie: Gamba's", option_price_pp: 5, is_selected: true },
      { name: "Optie: Dessertbuffet", option_price_pp: 12.5, is_selected: false },
      { name: "BBQ", option_price_pp: null, is_selected: true },
    ],
    charges: [kok, { name: "Drank 3 uur", kind: "per_persoon", amount: 28.75, vat_rate: 21, is_selected: true, tiers: [] }],
  });
  assert.equal(s.optionsIncl, 250);
  assert.equal(s.foodIncl, 2275 + 250);
  assert.equal(s.chargesIncl, 250 + 1437.5);
  assert.ok(Math.abs(s.foodExcl - 2525 / 1.09) < 1e-9);
  const fc = foodcostPct(700, s.foodExcl)!;
  assert.ok(Math.abs(fc - (700 / (2525 / 1.09)) * 100) < 1e-9);
});

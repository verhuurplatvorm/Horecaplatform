import { test } from "node:test";
import assert from "node:assert/strict";
import { amsterdamToday, parseWasteFilter, periodRange, previousRange, wasteHref, wasteTotals } from "./period";

test("vandaag in Amsterdam, ook net na middernacht", () => {
  // 22 nov 00:30 Amsterdam = 21 nov 23:30 UTC
  assert.equal(amsterdamToday(new Date("2026-11-21T23:30:00Z")), "2026-11-22");
  // zomertijd: 1 jul 00:30 Amsterdam = 30 jun 22:30 UTC
  assert.equal(amsterdamToday(new Date("2026-06-30T22:30:00Z")), "2026-07-01");
});

test("periodes (zondag 22 nov 2026)", () => {
  const t = "2026-11-22";
  assert.deepEqual(periodRange({ key: "vandaag" }, t), { from: t, to: t });
  assert.deepEqual(periodRange({ key: "week" }, t), { from: "2026-11-16", to: t });
  assert.deepEqual(periodRange({ key: "vorigeweek" }, t), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(periodRange({ key: "maand" }, t), { from: "2026-11-01", to: t });
  assert.deepEqual(periodRange({ key: "dagen", days: 30 }, t), { from: "2026-10-24", to: t });
  assert.deepEqual(previousRange({ from: "2026-10-24", to: t }), { from: "2026-09-24", to: "2026-10-23" });
});

test("dashboard-doorklik en terug geeft dezelfde filters", () => {
  const z = "b966223d-24fb-47a5-952e-055e26d0fd0a";
  const href = wasteHref({ companyIds: [z], period: { key: "dagen", days: 30 } });
  assert.equal(href, `/afval?bedrijf=${z}&dagen=30`);
  const f = parseWasteFilter(new URLSearchParams(href.split("?")[1]));
  assert.deepEqual(f, { companyIds: [z], period: { key: "dagen", days: 30 } });
  assert.deepEqual(parseWasteFilter(new URLSearchParams("bedrijf=onzin&periode=week")), {
    companyIds: null,
    period: { key: "week" },
  });
});

test("totalen", () => {
  const t = wasteTotals([
    { waste_value: 4.5, quantity: 2, unit_dimension: "gewicht", factor_to_base: 1000, unit_name: "kg" },
    { waste_value: 1, quantity: 500, unit_dimension: "inhoud", factor_to_base: 1, unit_name: "ml" },
    { waste_value: null, quantity: 3, unit_dimension: "aantal", factor_to_base: 1, unit_name: "stuk" },
  ]);
  assert.deepEqual(t, { value: 5.5, count: 3, kg: 2, liter: 0.5, pieces: 3 });
});

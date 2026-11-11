import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateHalfproducts,
  aggregateIngredients,
  chooseArticle,
  formatQuantity,
  packSizeBase,
  packsNeeded,
  possibleDuplicates,
  sharedWithoutOwnStation,
  suggestStation,
  type KitchenRow,
} from "./kitchen-lists";

function row(p: Partial<KitchenRow>): KitchenRow {
  return {
    dish_id: "d1",
    line_id: "l",
    recipe_id: "d1",
    path: ["d1"],
    depth: 0,
    kind: "product",
    product_id: null,
    sub_recipe_id: null,
    unmatched_name: null,
    line_quantity: 1,
    line_unit: "g",
    station_id: null,
    station_source: null,
    using_station_id: null,
    quantity_base: null,
    problem: null,
    ...p,
  };
}

// Tournedos (Roti) met kalfsjus (halfproduct, erft Roti) en groentegarnituur
// (halfproduct, eigen partie Entremetier). Boter zit in jus én garnituur.
const rows: KitchenRow[] = [
  row({ product_id: "tournedos", station_id: "roti", quantity_base: 1800 }),
  row({
    kind: "halfproduct",
    sub_recipe_id: "jus",
    station_id: "roti",
    using_station_id: "roti",
    quantity_base: 500,
  }),
  row({
    kind: "halfproduct",
    sub_recipe_id: "garn",
    station_id: "entre",
    using_station_id: "roti",
    station_source: "halfproduct",
    quantity_base: 1000,
  }),
  row({
    recipe_id: "jus",
    depth: 1,
    product_id: "kalfsbot",
    station_id: "roti",
    quantity_base: 2000,
  }),
  row({
    recipe_id: "jus",
    depth: 1,
    product_id: "boter",
    station_id: "roti",
    quantity_base: 50,
  }),
  row({
    recipe_id: "garn",
    depth: 1,
    product_id: "boter",
    station_id: "entre",
    quantity_base: 30,
  }),
  row({
    recipe_id: "garn",
    depth: 1,
    product_id: "wortel",
    station_id: "entre",
    quantity_base: 800,
  }),
  // tweede gerecht (Entremetier) gebruikt dezelfde jus zonder eigen partie
  row({
    dish_id: "d2",
    recipe_id: "d2",
    kind: "halfproduct",
    sub_recipe_id: "jus",
    station_id: "entre",
    using_station_id: "entre",
    station_source: "geerfd",
  }),
];

test("alle parties: boter één keer, hoeveelheden opgeteld, niets dubbel", () => {
  const all = aggregateIngredients(rows, new Set(), true);
  assert.equal(all.size, 4);
  assert.equal(all.get("boter")!.quantity, 80);
  assert.deepEqual([...all.get("boter")!.stations].sort(), ["entre", "roti"]);
  assert.deepEqual([...all.get("boter")!.halfproducts].sort(), ["garn", "jus"]);
});

test("alleen Roti: garnituur-ingrediënten vallen bij Entremetier", () => {
  const roti = aggregateIngredients(rows, new Set(["roti"]), true);
  assert.deepEqual([...roti.keys()].sort(), ["boter", "kalfsbot", "tournedos"]);
  assert.equal(roti.get("boter")!.quantity, 50);
  const entre = aggregateIngredients(rows, new Set(["entre"]), true);
  assert.deepEqual([...entre.keys()].sort(), ["boter", "wortel"]);
  // som van de parties = totaal (geen dubbele telling)
  assert.equal(
    roti.get("boter")!.quantity! + entre.get("boter")!.quantity!,
    80,
  );
});

test("halfproducten: Roti ziet de garnituur die Entremetier maakt", () => {
  const hp = aggregateHalfproducts(rows, new Set(["roti"]), false);
  assert.deepEqual([...hp.keys()].sort(), ["garn", "jus"]);
  assert.deepEqual([...hp.get("garn")!.stations], ["entre"]);
});

test("gedeeld halfproduct zonder eigen partie wordt gemeld", () => {
  const own = new Map<string, string | null>([
    ["jus", null],
    ["garn", "entre"],
  ]);
  assert.deepEqual(sharedWithoutOwnStation(rows, own), ["jus"]);
});

test("ontbrekende hoeveelheid wordt niet stil weggelaten", () => {
  const r = aggregateIngredients(
    [
      row({ product_id: "x", quantity_base: 10 }),
      row({
        product_id: "x",
        quantity_base: null,
        problem: "eenheid niet om te rekenen",
      }),
    ],
    new Set(),
    true,
  );
  assert.equal(r.get("x")!.quantity, 10);
  assert.equal(r.get("x")!.incomplete, true);
});

test("leverancier: vaste voorkeur gaat voor, anders meest recent", () => {
  const arts = [
    {
      supplier_id: "rovers",
      supplier_name: "Rovers",
      supplier_article_code: "1",
      packaging_description: "doos",
      purchase_price: 10,
      price_per_base_unit: 0.002,
      valid_from: "2026-08-01",
    },
    {
      supplier_id: "hanos",
      supplier_name: "Hanos",
      supplier_article_code: "2",
      packaging_description: "zak",
      purchase_price: 12,
      price_per_base_unit: 0.003,
      valid_from: "2026-10-01",
    },
  ];
  assert.equal(chooseArticle(arts, null).article!.supplier_id, "hanos");
  const pref = chooseArticle(arts, "rovers");
  assert.equal(pref.article!.supplier_id, "rovers");
  assert.equal(pref.preferred, true);
  assert.equal(pref.others, 1);
  assert.equal(packSizeBase(arts[0]), 5000);
  assert.equal(packsNeeded(12000, 5000), 3);
  assert.equal(packsNeeded(10000, 5000), 2);
  assert.equal(packsNeeded(null, 5000), null);
});

test("weergave hoeveelheden", () => {
  assert.equal(formatQuantity(3500, "g"), "3,5 kg");
  assert.equal(formatQuantity(250, "ml"), "250 ml");
  assert.equal(formatQuantity(3, "stuk"), "3 stuk");
});

test("mogelijk dubbele ingrediënten", () => {
  const d = possibleDuplicates([
    { id: "a", name: "Boter ongezouten" },
    { id: "b", name: "boter  Ongezouten 250 g" },
    { id: "c", name: "Room" },
  ]);
  assert.deepEqual(d, [["a", "b"]]);
});

test("partie-voorstel", () => {
  assert.equal(
    suggestStation("Carpaccio van rund", "Voorgerechten"),
    "Garde-manger",
  );
  assert.equal(suggestStation("Tiramisu", null), "Pâtisserie");
  assert.equal(suggestStation("Zeebaarsfilet", "Hoofdgerechten"), "Roti");
  assert.equal(
    suggestStation("Pompoenrisotto", "Hoofdgerechten"),
    "Entremetier",
  );
  assert.equal(suggestStation("Chocoladefondant", "Desserts"), "Pâtisserie");
  assert.equal(suggestStation("Iets onbekends", "Desserts"), "Pâtisserie");
  assert.equal(suggestStation("Margherita", "Pizza's"), null);
});

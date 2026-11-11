import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGrid,
  parseText,
  splitQuantity,
  unitKeyFor,
} from "./sheet-import";

test("sheet met kopregel", () => {
  const rows = parseGrid([
    ["Buffet 40 personen"],
    ["Onderdeel", "Gerecht", "Aantal", "Eenheid"],
    ["Koud", "Carpaccio", 1, "portie"],
    ["", "Stokbrood", 60, "gram"],
    ["Warm", "Kalfsjus", "50", "ml"],
  ]);
  assert.deepEqual(rows, [
    { section: "Koud", name: "Carpaccio", quantity: 1, unit: "stuk" },
    { section: "Koud", name: "Stokbrood", quantity: 60, unit: "g" },
    { section: "Warm", name: "Kalfsjus", quantity: 50, unit: "ml" },
  ]);
});

test("sheet zonder kopregel met kopjes als losse regels", () => {
  const rows = parseGrid([
    ["KOUD BUFFET"],
    ["Gerookte zalm", 80],
    ["Huzarensalade", 100],
    ["Warm buffet:"],
    ["Saté van kip", 2],
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].section, "Koud buffet");
  assert.equal(rows[0].quantity, 80);
  assert.equal(rows[2].section, "Warm buffet");
  assert.equal(rows[2].name, "Saté van kip");
});

test("hoeveelheid in de naam", () => {
  assert.deepEqual(splitQuantity("150 gr carpaccio"), {
    name: "carpaccio",
    quantity: 150,
    unit: "g",
  });
  assert.deepEqual(splitQuantity("2x broodje kroket"), {
    name: "broodje kroket",
    quantity: 2,
    unit: "stuk",
  });
  assert.deepEqual(splitQuantity("Rundercarpaccio 80 g"), {
    name: "Rundercarpaccio",
    quantity: 80,
    unit: "g",
  });
  assert.deepEqual(splitQuantity("Tomatensoep"), {
    name: "Tomatensoep",
    quantity: null,
    unit: null,
  });
});

test("geplakte tekst", () => {
  const rows = parseText(
    "Voorgerecht:\n- Carpaccio\n- Vitello tonnato\nDESSERT\nTiramisu",
  );
  assert.deepEqual(
    rows.map((r) => [r.section, r.name]),
    [
      ["Voorgerecht", "Carpaccio"],
      ["Voorgerecht", "Vitello tonnato"],
      ["Dessert", "Tiramisu"],
    ],
  );
});

test("eenheden", () => {
  assert.equal(unitKeyFor("Gram"), "g");
  assert.equal(unitKeyFor("ltr."), "l");
  assert.equal(unitKeyFor("p.p"), "stuk");
  assert.equal(unitKeyFor("bakje"), null);
});

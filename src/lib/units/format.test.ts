import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAmount, largerUnitHint } from "./format";

test("ml en gram worden vanaf 1000 omgezet", () => {
  assert.equal(formatAmount(876, "ml"), "876 ml");
  assert.equal(formatAmount(13400, "ml"), "13,4 l");
  assert.equal(formatAmount(13400, "milliliter"), "13,4 liter");
  assert.equal(formatAmount(1000, "milliliter"), "1 liter");
  assert.equal(formatAmount(2500, "gram"), "2,5 kilogram");
  assert.equal(formatAmount(999.5, "g"), "999,5 g");
  assert.equal(formatAmount(12, "stuk"), "12 stuk");
  assert.equal(formatAmount(null, "ml"), "—");
});

test("hint alleen als het anders wordt", () => {
  assert.equal(largerUnitHint("13400", "milliliter"), "13,4 liter");
  assert.equal(largerUnitHint(876, "milliliter"), null);
  assert.equal(largerUnitHint(5000, "stuk"), null);
});

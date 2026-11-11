import { test } from "node:test";
import assert from "node:assert/strict";
import { distributeGrams, weightFor } from "./distribute-grams";

const buffet = [
  { name: "Brood met smeersels", section: "Brood" },
  { name: "Vitello tonnato", section: "Buffet Het Strand - Koud" },
  { name: "Duo van zalm en tonijn", section: "Buffet Het Strand - Koud" },
  { name: "Caesar salade", section: "Buffet Het Strand - Koud" },
  { name: "Zeewolffilet", section: "Buffet Het Strand - Warm" },
  { name: "Diamanthaas Stroganoff", section: "Buffet Het Strand - Warm" },
  { name: "Stoofperen rood", section: "Buffet Het Strand - Warm" },
  {
    name: "Frites met kruiden en Zaanse mayonaise",
    section: "Buffet Het Strand - Warm",
  },
  { name: "Groente curry", section: "Vega" },
  { name: "Chocoshot", section: "Dessertbuffet" },
  { name: "IJs vanille", section: "Dessertbuffet" },
  { name: "Slagroom", section: "Dessertbuffet" },
];

test("totaal komt precies op 700 g p.p., vega doet niet mee", () => {
  const g = distributeGrams(buffet, 700);
  assert.equal(
    g.reduce<number>((s, x) => s + (x ?? 0), 0),
    700,
  );
  assert.equal(g[8], null);
  for (const x of g) if (x != null) assert.equal(x % 5, 0);
});

test("vlees/vis het meest, slagroom het minst", () => {
  const g = distributeGrams(buffet, 700) as number[];
  assert.ok(g[4] > g[1]); // zeewolf > vitello
  assert.ok(g[5] > g[6]); // stroganoff > stoofpeer
  assert.ok(g[11] < g[10]); // slagroom < ijs
});

test("herkenning", () => {
  assert.equal(weightFor("Hertensukade"), 110);
  assert.equal(weightFor("Frites met kruiden"), 90);
  assert.equal(weightFor("Karamelsaus"), 20);
  assert.equal(weightFor("Diverse bavaroise taarten"), 40);
  assert.equal(weightFor("Frites met kruiden en Zaanse mayonaise"), 90);
  assert.equal(weightFor("Gerookte ribeye met truffelmayonaise"), 40);
  assert.equal(weightFor("Schuimbol met karamelsaus"), 40);
  assert.equal(weightFor("Kalfsjus"), 20);
  assert.equal(weightFor("Stoofperen rood"), 60);
});

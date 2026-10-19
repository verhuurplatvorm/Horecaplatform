import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { looksNonFood } from "./non-food";

describe("looksNonFood", () => {
  it("herkent servies, gerei en verbruiksartikelen", () => {
    for (const n of [
      "Dessertbord nautic 22x20cm",
      "Oesterschaal 44x27x7,8cm",
      "Aluminiumfolie in box 150x50 cm",
      "Handdoek midi rol 2-lgs.",
      "Heineken witpils vilt 4x100st",
      "Stoepbord duplo 55x85cm zwart",
      "Snijplank blauw 600x400x15 *select*",
      "Lepeltje hout (fsc) 110mm",
      "Toiletpapier tissue wit 2ply 12x4 rol",
    ]) {
      assert.equal(looksNonFood(n), true, n);
    }
  });
  it("laat eten en drinken met rust", () => {
    for (const n of [
      "Komkommer",
      "Schaaldieren mix",
      "Croquetas espinasas/queso 48x30",
      "Zeewolf portie zonder vel",
      "Tomatenpuree 6x1 ltr",
      "Bloem zak 25 kg",
      "Mayonaise emmer 10 ltr",
      "Roggebrood gesneden 1x5 plk",
      "Penne rigate 5 kg",
    ]) {
      assert.equal(looksNonFood(n), false, n);
    }
  });
  it("lege naam is geen non-food", () => {
    assert.equal(looksNonFood(null), false);
    assert.equal(looksNonFood(""), false);
  });
});

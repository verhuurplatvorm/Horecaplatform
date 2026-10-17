import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideAutoRow } from "./auto-apply";

describe("decideAutoRow", () => {
  it("normale kleine prijswijziging wordt toegepast", () => {
    assert.equal(decideAutoRow({ newPrice: 10.5, packagingUnitCount: 12, existingPrice: 10 }).decision, "toepassen");
  });
  it("prijssprong boven 50% blijft voor controle", () => {
    const r = decideAutoRow({ newPrice: 20, packagingUnitCount: 12, existingPrice: 10 });
    assert.equal(r.decision, "controle");
    assert.match(r.reason ?? "", /100%/);
  });
  it("nieuwe prijs zonder verpakkingsaantal blijft voor controle", () => {
    assert.equal(decideAutoRow({ newPrice: 5, packagingUnitCount: null, existingPrice: null }).decision, "controle");
  });
  it("nieuwe prijs met aantal wordt toegepast", () => {
    assert.equal(decideAutoRow({ newPrice: 5, packagingUnitCount: 6, existingPrice: null }).decision, "toepassen");
  });
  it("prijs ontbreekt of is 0 blijft voor controle", () => {
    assert.equal(decideAutoRow({ newPrice: null, packagingUnitCount: 6, existingPrice: 5 }).decision, "controle");
    assert.equal(decideAutoRow({ newPrice: 0, packagingUnitCount: 6, existingPrice: 5 }).decision, "controle");
  });
});

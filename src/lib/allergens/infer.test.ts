import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferAllergens } from "./infer";

describe("inferAllergens", () => {
  it("herkent melk, ei en gluten", () => {
    assert.deepEqual(inferAllergens("Halfvolle melk pak 1ltr").certain, ["melk"]);
    assert.ok(inferAllergens("Kwarteleieren (vers)").certain.includes("eieren"));
    assert.ok(inferAllergens("Tarwe bloem 5kg").certain.includes("gluten"));
  });
  it("glutenvrij en plantaardig heffen het allergeen op", () => {
    assert.ok(!inferAllergens("Tartelette glutenvrij 8,5cm").certain.includes("gluten"));
    assert.ok(!inferAllergens("Tartelette glutenvrij 8,5cm").assumed.includes("gluten"));
    assert.ok(!inferAllergens("Plant based kokos roomijs 2.5 liter.").certain.includes("melk"));
  });
  it("pindakaas bevat pinda, geen melk", () => {
    const g = inferAllergens("Pindakaas");
    assert.ok(g.certain.includes("pinda"));
    assert.ok(!g.certain.includes("melk"));
  });
  it("wijn en azijn geven sulfiet", () => {
    assert.ok(inferAllergens("Witte wijnazijn 1x5ltr").certain.includes("sulfiet"));
    assert.ok(inferAllergens("Rias baixas - albarino").certain.includes("sulfiet"));
  });
  it("eetbare bloem is geen gluten", () => {
    assert.ok(!inferAllergens("Eetbare bloem viooltjes").certain.includes("gluten"));
  });
  it("taart is een aanname, niet zeker", () => {
    const g = inferAllergens("Mango bavarois taart 12 punten.");
    assert.ok(g.assumed.includes("gluten"));
    assert.ok(!g.certain.includes("gluten"));
  });
  it("vers product zonder bewerking: geen allergenen verwacht", () => {
    assert.equal(inferAllergens("Krulpeterselie").status, "geen_verwacht");
    assert.equal(inferAllergens("Paprika punt rood").status, "geen_verwacht");
  });
  it("onbekend blijft onbekend", () => {
    assert.equal(inferAllergens("Caramel royaal 12 stuks").status === "onbekend", false); // caramel = aanname melk
    assert.equal(inferAllergens("BORRELMAATJES 12x6x30gr").status, "onbekend");
  });
});

describe("inferAllergens (extra)", () => {
  it("koffiemelk is melk, kokosmelk niet", () => {
    assert.ok(inferAllergens("Koffiemelk cups").certain.includes("melk"));
    assert.ok(!inferAllergens("Kokosmelk 400ml").certain.includes("melk"));
  });
  it("sorbet is geen melk", () => {
    assert.ok(!inferAllergens("Sorbetijs cassis (Gelato bellissimo)").certain.includes("melk"));
  });
  it("dessert in stuks is niet 'geen verwacht'", () => {
    assert.equal(inferAllergens("Bloedsinaasappel met framboos 20 stuks").status, "onbekend");
  });
});

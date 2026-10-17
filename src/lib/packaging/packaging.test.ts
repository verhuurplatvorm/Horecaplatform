import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  convertCountToNewBase,
  costForUsage,
  countInBaseUnit,
  diagnosePackaging,
  parsePackaging,
  pricesFromCount,
  sizePerPieceFromName,
  suggestCountForDescription,
  type KeyBridge,
} from "./index";

const close = (actual: number | null, expected: number, digits = 4) => {
  assert.notEqual(actual, null, "waarde is null");
  assert.ok(Math.abs((actual as number) - expected) < Math.pow(10, -digits), `${actual} ≠ ${expected}`);
};

const BARRA_BRIDGE: KeyBridge = { quantity: 260, unit: "g" };

describe("parsePackaging — herkenning van verpakkingsvormen", () => {
  const cases: [string, number | null, number | null, string, number][] = [
    // tekst, aantal stuks, inhoud per stuk, eenheid, totaal
    ["18x260gr", 18, 260, "g", 4680],
    ["45x110gr", 45, 110, "g", 4950],
    ["6x1ltr", 6, 1, "l", 6],
    ["24x330ml", 24, 330, "ml", 7920],
    ["2x2,5kg", 2, 2.5, "kg", 5],
    ["1x5kg", 1, 5, "kg", 5],
    ["100 stuks", 100, null, "stuk", 100],
    ["10kg", null, null, "kg", 10],
    ["12x6x30gr", 72, 30, "g", 2160],
    ["1 × 1000 Gram", 1, 1000, "g", 1000],
    ["24 × 33 cl = 792 cl", 24, 33, "cl", 792],
    ["12 × 6 × 30 g = 2160 g", 72, 30, "g", 2160],
  ];
  for (const [text, packs, perPack, unit, total] of cases) {
    it(text, () => {
      const spec = parsePackaging(text);
      assert.ok(spec, "niet herkend");
      assert.equal(spec.packs, packs);
      assert.equal(spec.perPack, perPack);
      assert.equal(spec.unit, unit);
      close(spec.total, total);
    });
  }

  it("onbekende of lege tekst geeft null", () => {
    assert.equal(parsePackaging(""), null);
    assert.equal(parsePackaging(null), null);
    assert.equal(parsePackaging("naar smaak"), null);
  });

  it("een losse maat in de naam is geen vermenigvuldiging", () => {
    const spec = parsePackaging("H50 KAASPLAKJES GOUDA OUD 1kg 2x25plaks");
    assert.ok(spec);
    assert.equal(spec.unit, "kg");
    assert.equal(spec.total, 1);
  });
});

describe("countInBaseUnit — hoeveel zit er in de basiseenheid", () => {
  it("18 × 260 g met basiseenheid stuk = 18 stuks, NIET 4680", () => {
    const r = countInBaseUnit(parsePackaging("18x260gr")!, "stuk");
    assert.equal(r.count, 18);
    assert.deepEqual(r.impliedBridge, { quantity: 260, unit: "g" });
  });
  it("18 × 260 g met basiseenheid stuk én brug 260 g = 18", () => {
    assert.equal(countInBaseUnit(parsePackaging("18x260gr")!, "stuk", BARRA_BRIDGE).count, 18);
  });
  it("brug die niet bij de omschrijving past wordt niet stilletjes gebruikt", () => {
    const r = countInBaseUnit(parsePackaging("18x260gr")!, "stuk", { quantity: 300, unit: "g" });
    assert.equal(r.count, null);
  });
  it("18 × 260 g met basiseenheid gram = 4680 g", () => {
    assert.equal(countInBaseUnit(parsePackaging("18x260gr")!, "g").count, 4680);
  });
  it("6x1ltr: ml / l / stuk", () => {
    const spec = parsePackaging("6x1ltr")!;
    assert.equal(countInBaseUnit(spec, "ml").count, 6000);
    assert.equal(countInBaseUnit(spec, "l").count, 6);
    assert.equal(countInBaseUnit(spec, "stuk").count, 6);
  });
  it("24x330ml in ml en stuk", () => {
    const spec = parsePackaging("24x330ml")!;
    assert.equal(countInBaseUnit(spec, "ml").count, 7920);
    assert.equal(countInBaseUnit(spec, "stuk").count, 24);
  });
  it("2x2,5kg: 5000 g / 5 kg / 2 stuks", () => {
    const spec = parsePackaging("2x2,5kg")!;
    assert.equal(countInBaseUnit(spec, "g").count, 5000);
    assert.equal(countInBaseUnit(spec, "kg").count, 5);
    assert.equal(countInBaseUnit(spec, "stuk").count, 2);
  });
  it("1x5kg als stuk = 1 verpakking", () => {
    assert.equal(countInBaseUnit(parsePackaging("1x5kg")!, "stuk").count, 1);
  });
  it("100 stuks: 100 stuks, gewicht onbekend", () => {
    const spec = parsePackaging("100 stuks")!;
    assert.equal(countInBaseUnit(spec, "stuk").count, 100);
    assert.equal(countInBaseUnit(spec, "g").count, null);
    assert.equal(countInBaseUnit(spec, "g", { quantity: 5, unit: "g" }).count, 500);
  });
  it("10kg als stuk: aantal onbekend zonder gewicht per stuk", () => {
    const spec = parsePackaging("10kg")!;
    assert.equal(countInBaseUnit(spec, "stuk").count, null);
    assert.equal(countInBaseUnit(spec, "g").count, 10000);
    assert.equal(countInBaseUnit(spec, "stuk", { quantity: 500, unit: "g" }).count, 20);
  });
  it("gewicht en inhoud worden niet door elkaar gehaald", () => {
    assert.equal(countInBaseUnit(parsePackaging("6x1ltr")!, "g").count, null);
  });
  it("suggestCountForDescription voor invoerschermen", () => {
    assert.equal(suggestCountForDescription("18 × 260 Gram", "stuk")?.count, 18);
    assert.equal(suggestCountForDescription("18 × 260 Gram", "g")?.count, 4680);
    assert.equal(suggestCountForDescription("onzin", "g"), null);
  });
});

describe("Barra Gallega 18 × 260 g — € 30,81", () => {
  const price = 30.81;
  const prices = pricesFromCount(price, 18, "stuk", BARRA_BRIDGE);

  it("prijs per stuk € 1,7117 en per kg € 6,5833", () => {
    close(prices.perPiece, 1.7117);
    close(prices.perKg, 6.5833);
  });
  it("1 stuk kost € 1,7117", () => {
    close(costForUsage(prices.perBase!, "stuk", 1, "stuk", BARRA_BRIDGE), 1.7117);
  });
  it("260 g kost ook € 1,7117", () => {
    close(costForUsage(prices.perBase!, "stuk", 260, "g", BARRA_BRIDGE), 1.7117);
  });
  it("100 g kost € 0,6583", () => {
    close(costForUsage(prices.perBase!, "stuk", 100, "g", BARRA_BRIDGE), 0.6583);
  });
  it("0,1 kg kost € 0,6583", () => {
    close(costForUsage(prices.perBase!, "stuk", 0.1, "kg", BARRA_BRIDGE), 0.6583);
  });
  it("de oude fout (4680 'stuks') gaf € 0,0066 per stuk", () => {
    close(pricesFromCount(price, 4680, "stuk", BARRA_BRIDGE).perPiece, 0.0066);
  });
  it("een latere factuurprijs herberekent stuk- en kiloprijs", () => {
    const nieuw = pricesFromCount(33.48, 18, "stuk", BARRA_BRIDGE);
    close(nieuw.perPiece, 33.48 / 18);
    close(nieuw.perKg, 33.48 / 4.68);
  });
});

describe("producten zonder bekend gewicht en alleen-per-stuk", () => {
  it("alleen per stuk verkocht: stukprijs bekend, kiloprijs niet", () => {
    const p = pricesFromCount(8.25, 24, "stuk");
    close(p.perPiece, 8.25 / 24);
    assert.equal(p.perKg, null);
    assert.equal(p.perLiter, null);
    assert.equal(costForUsage(p.perBase!, "stuk", 100, "g"), null);
    close(costForUsage(p.perBase!, "stuk", 3, "stuk"), (8.25 / 24) * 3);
  });
  it("gewichtsproduct: prijs per kg en per 100 g", () => {
    const p = pricesFromCount(31.25, 5000, "g");
    close(p.perKg, 6.25);
    close(costForUsage(p.perBase!, "g", 100, "g"), 0.625);
    assert.equal(costForUsage(p.perBase!, "g", 1, "stuk"), null);
  });
  it("inhoud: prijs per liter en per cl", () => {
    const p = pricesFromCount(14.25, 5000, "ml");
    close(p.perLiter, 2.85);
    close(costForUsage(p.perBase!, "ml", 5, "cl"), 0.1425);
  });
  it("ongeldige invoer geeft overal null, nooit 0", () => {
    const p = pricesFromCount(10, 0, "g");
    assert.equal(p.perBase, null);
    assert.equal(p.perKg, null);
  });
});

describe("basiseenheid wijzigen rekent het verpakkingsaantal mee", () => {
  it("4680 g → stuk met 260 g per stuk = 18", () => {
    assert.equal(convertCountToNewBase(4680, "g", "stuk", BARRA_BRIDGE), 18);
  });
  it("zonder gewicht per stuk niet omrekenbaar (geen stille fout)", () => {
    assert.equal(convertCountToNewBase(4680, "g", "stuk"), null);
  });
  it("g → kg", () => {
    assert.equal(convertCountToNewBase(1000, "g", "kg"), 1);
  });
});

describe("diagnosePackaging — scan van bestaande regels", () => {
  it("Barra Gallega: aantal stuks stond als totaalgewicht → oranje, voorstel 18", () => {
    const d = diagnosePackaging({
      name: "106.barra gallega 18x260gr",
      baseUnit: "stuk",
      bridge: BARRA_BRIDGE,
      description: "18 × 260 Gram",
      count: 4680,
      price: 30.81,
    });
    assert.equal(d.status, "oranje");
    assert.equal(d.proposal?.count, 18);
    close(d.proposal!.prices.perPiece, 1.7117);
    close(d.proposal!.prices.perKg, 6.5833);
    close(d.current.perPiece, 0.0066);
  });

  it("Rode kool gesneden 1 kg: basiseenheid kg maar aantal 1000 → oranje, € 2,35 per kg", () => {
    const d = diagnosePackaging({
      name: "Rode kool gesneden 1kg",
      baseUnit: "kg",
      bridge: { quantity: 1, unit: "kg" },
      description: "1 × 1000 Gram",
      count: 1000,
      price: 2.35,
    });
    assert.equal(d.status, "oranje");
    assert.equal(d.proposal?.count, 1);
    close(d.proposal!.prices.perKg, 2.35);
  });

  it("Holtkamp 18 × 85 g (stuk, 85 g per stuk, aantal 18) is groen", () => {
    const d = diagnosePackaging({
      name: "Holtkamp rund draadjesvlees croquet18x85",
      baseUnit: "stuk",
      bridge: { quantity: 85, unit: "g" },
      description: "18 × 85 Gram",
      count: 18,
      price: 19.12,
    });
    assert.equal(d.status, "groen");
    close(d.current.perPiece, 19.12 / 18);
  });

  it("gewone gewichtsverpakking 12 × 500 g is groen", () => {
    const d = diagnosePackaging({
      name: "AVOCADO BLOKJES 12x500gr #81564#",
      baseUnit: "g",
      description: "12 × 500 g = 6000 g",
      count: 6000,
      price: 51.75,
    });
    assert.equal(d.status, "groen");
    close(d.current.perKg, 8.625);
  });

  it("alleen-per-stuk product (24 st) is groen", () => {
    const d = diagnosePackaging({
      name: "SLAGROOMPATRONEN 1x24st #50287#",
      baseUnit: "stuk",
      description: "1 × 24 stuk = 24 stuk",
      count: 24,
      price: 8.25,
    });
    assert.equal(d.status, "groen");
  });

  it("Chaudfontaine 25 cl, 24 stuks, maar 250 ml opgeslagen → oranje, voorstel 6000 ml", () => {
    const d = diagnosePackaging({
      name: "Chaudfontaine still 25cl",
      baseUnit: "ml",
      description: "1 × 24 Stuks",
      count: 250,
      price: 9.06,
    });
    assert.equal(d.status, "oranje");
    assert.equal(d.proposal?.count, 6000);
    close(d.proposal!.prices.perLiter, 1.51);
  });

  it("Rode bieten carpaccio 80 gr, 10 stuks, 80 g opgeslagen → oranje, 800 g", () => {
    const d = diagnosePackaging({
      name: "Rode bieten carpaccio 80gr",
      baseUnit: "g",
      description: "1 × 10 Stuks",
      count: 80,
      price: 13.5,
    });
    assert.equal(d.status, "oranje");
    assert.equal(d.proposal?.count, 800);
  });

  it("losse maat in de naam (Rucola 125gr, 1 stuk) is groen", () => {
    const d = diagnosePackaging({ name: "Rucola 125gr", baseUnit: "g", description: "1 × 1 Stuks", count: 125, price: 1.4 });
    assert.equal(d.status, "groen");
  });

  it("2x190g met omschrijving '2 × 1 Stuks' en 380 g is groen", () => {
    const d = diagnosePackaging({ name: "Pur pain bio baguette 2x190g", baseUnit: "g", description: "2 × 1 Stuks", count: 380, price: 4.08 });
    assert.equal(d.status, "groen");
  });

  it("glas in stuks maar basiseenheid ml → rood (non-food, handmatig)", () => {
    const d = diagnosePackaging({ name: "Brand weizen glas 30cl", baseUnit: "ml", description: "6 × 1 Stuks", count: 300, price: 13.49 });
    assert.equal(d.status, "rood");
  });

  it("prijs per kilo opgeslagen terwijl de naam een doos noemt → rood met alternatief", () => {
    const d = diagnosePackaging({ name: "Filet cordon bleu 10 x 180gr", baseUnit: "g", description: "1 × 1000 Gram", count: 1000, price: 10.3 });
    assert.equal(d.status, "rood");
    assert.ok(d.alternative?.includes("5,72") || d.alternative?.includes("5.72"), d.alternative ?? "");
  });

  it("naam en verpakking spreken elkaar tegen → rood", () => {
    const d = diagnosePackaging({ name: "De magistraat scheepstimmerman fles 12x33cl", baseUnit: "ml", description: "12 × 300 Ml", count: 3600, price: 23.89 });
    assert.equal(d.status, "rood");
  });

  it("Kaneel roomijs '2,5 ltr' met verpakking 1 l → rood", () => {
    const d = diagnosePackaging({ name: "Kaneel roomijs 2,5 ltr.", baseUnit: "ml", description: "1 × 1 l = 1 l", count: 1000, price: 3.15 });
    assert.equal(d.status, "rood");
  });

  it("naam met kg-typfout (2x4500kg) maar consistente velden → groen met notitie", () => {
    const d = diagnosePackaging({ name: "Aviko super crunch fresh 2x4500kg", baseUnit: "g", description: "2 × 4500 Gram", count: 9000, price: 21.2 });
    assert.equal(d.status, "groen");
    assert.ok(d.notes.length > 0);
  });

  it("drievoudige notatie 8x3x17,5cl komt overeen met 24 × 175 ml → groen", () => {
    const d = diagnosePackaging({ name: "Crodino flesjes 8x3x17,5cl #77886#", baseUnit: "ml", description: "24 × 175 Ml", count: 4200, price: 45.44 });
    assert.equal(d.status, "groen");
  });

  it("duizendtal-notatie in de naam (24.000x330 ml) verstoort niets → groen", () => {
    const d = diagnosePackaging({ name: "Desperados original (24.000x330 ml)", baseUnit: "ml", description: "24 × 330 Ml", count: 7920, price: 41.38 });
    assert.equal(d.status, "groen");
  });

  it("afrondingsverschil van 0,5% (24 × 199 ml) is groen", () => {
    const d = diagnosePackaging({ name: "Fev.tr indian tonic 24x200ml", baseUnit: "ml", description: "24 × 199 Ml", count: 4776, price: 28.86 });
    assert.equal(d.status, "groen");
  });

  it("Mayonaise 10 l als 1 stuk met brug 10.000 ml is groen", () => {
    const d = diagnosePackaging({ name: "Mayonaise levo", baseUnit: "ml", bridge: { quantity: 10000, unit: "ml" }, description: "1 × 1 Stuks", count: 10000, price: 22.5 });
    assert.equal(d.status, "groen");
  });

  it("gewicht per stuk onbekend: kloppend aantal blijft groen, met notitie", () => {
    const d = diagnosePackaging({ name: "Burger 10x180gr", baseUnit: "stuk", description: "10 × 180 g = 1800 g", count: 10, price: 25 });
    assert.equal(d.status, "groen");
    assert.ok(d.notes.some((n) => n.includes("Gewicht per stuk")));
  });

  it("totaalgewicht als stuks zonder gewicht per stuk wordt ook herkend (oranje)", () => {
    const d = diagnosePackaging({ name: "Burger 10x180gr", baseUnit: "stuk", description: "10 × 180 g = 1800 g", count: 1800, price: 25 });
    assert.equal(d.status, "oranje");
    assert.equal(d.proposal?.count, 10);
  });

  it("verpakking zonder omschrijving en zonder maat in naam → rood", () => {
    const d = diagnosePackaging({ name: "CASINO WIT GESNEDEN DV", baseUnit: "stuk", description: null, count: 24, price: 1.75 });
    assert.equal(d.status, "rood");
  });

  it("prijs 0 is geen verpakkingsfout maar 'geen prijs'", () => {
    const d = diagnosePackaging({ name: "Gehakt rund", baseUnit: "g", description: "1 × 1000 Gram", count: 1000, price: 0 });
    assert.equal(d.status, "geen_prijs");
  });

  it("onwaarschijnlijk lage kiloprijs wordt gemeld", () => {
    const d = diagnosePackaging({ name: "Product", baseUnit: "g", description: "1 × 1000 Gram", count: 1000, price: 0.1 });
    assert.equal(d.status, "rood");
  });
});

import { contentFromName, importPackagingFromText, toSmallestUnit } from "./index";
import { linesToRows } from "../invoice-import/lines-to-rows";

describe("import-hulpfuncties (Excel / leverancier / factuur)", () => {
  it("toSmallestUnit rekent naar g / ml / stuk", () => {
    assert.deepEqual(toSmallestUnit("kg"), { baseKey: "g", factor: 1000 });
    assert.deepEqual(toSmallestUnit("l"), { baseKey: "ml", factor: 1000 });
    assert.deepEqual(toSmallestUnit("cl"), { baseKey: "ml", factor: 10 });
    assert.deepEqual(toSmallestUnit("stuk"), { baseKey: "stuk", factor: 1 });
  });

  it("importPackagingFromText geeft totaal in kleinste eenheid", () => {
    assert.equal(importPackagingFromText("18x260gr")?.count, 4680);
    assert.equal(importPackagingFromText("18x260gr")?.unitKey, "g");
    assert.equal(importPackagingFromText("6x1ltr")?.count, 6000);
    assert.equal(importPackagingFromText("6x1ltr")?.unitKey, "ml");
    assert.equal(importPackagingFromText("2x2,5kg")?.count, 5000);
    assert.equal(importPackagingFromText("100 stuks")?.count, 100);
    assert.equal(importPackagingFromText("100 stuks")?.unitKey, "stuk");
    assert.equal(importPackagingFromText("10kg")?.count, 10000);
  });

  it("contentFromName: laatste maat in de naam wint", () => {
    assert.deepEqual(contentFromName("Emmer mayonaise 10 ltr"), {
      baseKey: "ml",
      quantityInBase: 10000,
      matchedText: "10 ltr",
    });
    assert.equal(contentFromName("Cola krat 24x33cl")?.quantityInBase, 7920);
    assert.equal(contentFromName("Bloem zak 25 kg")?.baseKey, "g");
    assert.equal(contentFromName("Gewoon een naam"), null);
  });

  it("factuurregel '18x260gr' levert 4680 g met sleutel g (omrekenen naar stuk gebeurt via de brug)", () => {
    const [row] = linesToRows([
      {
        lineNumber: 1,
        description: "106.barra gallega 18x260gr",
        unitPrice: 30.81,
        quantity: 1,
        unit: null,
      } as never,
    ]);
    assert.equal(row.packagingUnitCount, 4680);
    assert.equal(row.packagingUnitKey, "g");
  });

  it("factuurregel per kilo: verpakking is 1 kg, gewichten in de omschrijving zijn geen verpakking", () => {
    const [row] = linesToRows([
      { lineNumber: 1, description: "Entrecote 200 gr", unitPrice: 24.5, quantity: 3.4, unit: "kg" } as never,
    ]);
    assert.equal(row.packagingUnitCount, 1000);
    assert.equal(row.packagingUnitKey, "g");
  });

  it("het aantal besteld wordt nooit als verpakkingsgrootte gelezen", () => {
    const [row] = linesToRows([
      { lineNumber: 1, description: "Citroenen", unitPrice: 1.25, quantity: 40, unit: "stuk" } as never,
    ]);
    assert.equal(row.packagingUnitCount, 1);
    assert.equal(row.packagingUnitKey, "stuk");
  });

  it("latere factuurprijs: zelfde verpakking, nieuwe prijs → stukprijs en kiloprijs worden opnieuw berekend", () => {
    const oud = pricesFromCount(30.81, 18, "stuk", BARRA_BRIDGE);
    const nieuw = pricesFromCount(32.4, 18, "stuk", BARRA_BRIDGE);
    assert.ok(nieuw.perPiece! > oud.perPiece!);
    close(nieuw.perPiece, 32.4 / 18);
    close(nieuw.perKg, 32.4 / 4.68);
  });
});

describe("sizePerPieceFromName", () => {
  it("losse maat is de maat per stuk", () => {
    const r = sizePerPieceFromName("Crème panna 35% evolineo 1 litre");
    assert.equal(r?.baseKey, "ml");
    assert.equal(r?.perPiece, 1000);
    assert.equal(r?.packsInName, null);
    assert.equal(r?.ambiguous, false);
  });
  it("6x1 ltr: 1000 ml per stuk, 6 in de naam", () => {
    const r = sizePerPieceFromName("Tomatenpuree 28/30 6x1 ltr");
    assert.equal(r?.perPiece, 1000);
    assert.equal(r?.packsInName, 6);
  });
  it("gewicht en komma", () => {
    const r = sizePerPieceFromName("Boter ongezouten 2,5 kg");
    assert.equal(r?.baseKey, "g");
    assert.equal(r?.perPiece, 2500);
  });
  it("twee verschillende maten is onzeker", () => {
    assert.equal(sizePerPieceFromName("Saus 500 gr / 2 kg")?.ambiguous, true);
  });
  it("geen maat in de naam", () => {
    assert.equal(sizePerPieceFromName("Citroen 10st"), null);
  });
});

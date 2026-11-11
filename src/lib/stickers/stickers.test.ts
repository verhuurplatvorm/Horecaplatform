import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysISO,
  addMonthsISO,
  expiryCheck,
  formatDateNL,
  guessFreezerCategory,
  standardTerm,
} from "./stickers";

test("vers: productiedatum + 3 kalenderdagen", () => {
  const t = standardTerm({ type: "vers" });
  assert.deepEqual([t.term, t.unit], [3, "dagen"]);
  assert.equal(addDaysISO("2026-11-11", 3), "2026-11-14");
  assert.equal(addDaysISO("2026-12-30", 3), "2027-01-02");
  assert.equal(addDaysISO("2028-02-27", 3), "2028-03-01"); // schrikkeljaar
  assert.equal(addDaysISO("2027-02-27", 3), "2027-03-02");
});

test("diepvries: kalendermaanden met maandultimo en schrikkeljaar (zoals PostgreSQL)", () => {
  assert.equal(addMonthsISO("2026-11-11", 3), "2027-02-11");
  assert.equal(addMonthsISO("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsISO("2027-11-30", 3), "2028-02-29");
  assert.equal(addMonthsISO("2027-08-31", 6), "2028-02-29");
  assert.equal(addMonthsISO("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsISO("2026-11-11", 12), "2027-11-11");
  assert.equal(addMonthsISO("2026-10-31", 1), "2026-11-30");
  assert.equal(addMonthsISO("2026-12-15", 1), "2027-01-15");
});

test("datumweergave", () => {
  assert.equal(formatDateNL("2027-02-11"), "11-02-2027");
  assert.equal(formatDateNL(null), "—");
});

test("productspecifieke termijn gaat voor", () => {
  // halfproduct gekoeld 2 dagen → te gebruiken tot = +3
  assert.equal(
    standardTerm({
      type: "vers",
      isRecipe: true,
      recipeRule: "gekoeld_2d",
      recipeDays: 2,
    }).term,
    3,
  );
  // alleen dag van bereiding → +1 (kortere termijn is leidend)
  assert.equal(
    standardTerm({
      type: "vers",
      isRecipe: true,
      recipeRule: "zelfde_dag",
      recipeDays: 0,
    }).term,
    1,
  );
  // ingrediënt met eigen verse termijn
  assert.equal(standardTerm({ type: "vers", productFreshDays: 2 }).term, 2);
  // diepvries: product 2 mnd wint van categorie 3 mnd
  const d = standardTerm({
    type: "diepvries",
    productFreezerMonths: 2,
    categoryMonths: 3,
    categoryApproved: true,
  });
  assert.deepEqual([d.term, d.source], [2, "product"]);
});

test("niet-goedgekeurde categorie wordt niet automatisch gebruikt", () => {
  const t = standardTerm({
    type: "diepvries",
    categoryMonths: 3,
    categoryApproved: false,
  });
  assert.equal(t.term, null);
  assert.equal(t.source, "handmatig");
  const ok = standardTerm({
    type: "diepvries",
    categoryMonths: 3,
    categoryApproved: true,
  });
  assert.equal(ok.term, 3);
});

test("langere termijn vraagt goedkeuring, kortere niet", () => {
  const std = standardTerm({
    type: "diepvries",
    categoryMonths: 3,
    categoryApproved: true,
  });
  const base = {
    type: "diepvries" as const,
    productionDate: "2026-11-11",
    standard: std,
  };
  assert.deepEqual(expiryCheck({ ...base, expiryDate: "2027-02-11" }), {
    error: null,
    needsReason: false,
    needsApproval: false,
    changed: false,
  });
  const shorter = expiryCheck({ ...base, expiryDate: "2027-01-11" });
  assert.equal(shorter.needsApproval, false);
  assert.equal(shorter.changed, true);
  const longer = expiryCheck({ ...base, expiryDate: "2027-03-11" });
  assert.equal(longer.needsApproval, true);
  assert.equal(longer.needsReason, true);
});

test("bestaande THT/TGT wordt niet onterecht verlengd", () => {
  const std = standardTerm({
    type: "diepvries",
    categoryMonths: 3,
    categoryApproved: true,
  });
  // Handmatig ingevoerde THT van leverancier: verlengen vraagt goedkeuring.
  const manual = expiryCheck({
    type: "diepvries",
    productionDate: "2026-11-11",
    expiryDate: "2027-02-11",
    standard: std,
    originalExpiry: "2026-11-20",
    originalKind: "THT",
  });
  assert.equal(manual.needsApproval, true);
  // Eigen batch, ingevroren vóór TGT: volgens procedure.
  const batch = expiryCheck({
    type: "diepvries",
    productionDate: "2026-11-11",
    expiryDate: "2027-02-11",
    standard: std,
    originalExpiry: "2026-11-14",
    originalKind: "TGT",
    originalFromBatch: true,
  });
  assert.equal(batch.needsApproval, false);
  // Na de TGT invriezen mag nooit.
  const late = expiryCheck({
    type: "diepvries",
    productionDate: "2026-11-14",
    expiryDate: "2027-02-14",
    standard: std,
    originalExpiry: "2026-11-14",
    originalKind: "TGT",
    originalFromBatch: true,
  });
  assert.ok(late.error);
  // Vers-sticker mag de oorspronkelijke datum niet stilzwijgend overschrijden.
  const vers = expiryCheck({
    type: "vers",
    productionDate: "2026-11-11",
    expiryDate: "2026-11-14",
    standard: standardTerm({ type: "vers" }),
    originalExpiry: "2026-11-13",
    originalKind: "TGT",
  });
  assert.equal(vers.needsApproval, true);
});

test("houdbaarheid vóór productiedatum is een fout", () => {
  const r = expiryCheck({
    type: "vers",
    productionDate: "2026-11-11",
    expiryDate: "2026-11-10",
    standard: standardTerm({ type: "vers" }),
  });
  assert.ok(r.error);
});

test("productgroep herkennen", () => {
  assert.equal(
    guessFreezerCategory("Kalfsjus", { isPrepared: true }),
    "soepen_sauzen",
  );
  assert.equal(
    guessFreezerCategory("Tomatensoep", { isPrepared: true }),
    "soepen_sauzen",
  );
  assert.equal(guessFreezerCategory("Rundergehakt"), "gehakt");
  assert.equal(guessFreezerCategory("Zalmfilet"), "vette_vis");
  assert.equal(guessFreezerCategory("Kabeljauw"), "magere_vis");
  assert.equal(guessFreezerCategory("Kipfilet"), "gevogelte");
  assert.equal(guessFreezerCategory("Runderbiefstuk"), "rund");
  assert.equal(guessFreezerCategory("Broodjes"), "brood");
  assert.equal(guessFreezerCategory("Champignons"), null);
  assert.equal(guessFreezerCategory("Gegaarde kipdijen"), "gebraden_vlees");
});

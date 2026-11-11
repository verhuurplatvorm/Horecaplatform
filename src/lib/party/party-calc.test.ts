import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planParty,
  formatDistribution,
  personsPerContainer,
} from "./party-calc";

test("70 gasten × 60 g, schaal 1200 g, volle schalen", () => {
  const p = planParty({ guests: 70, portion: 60, capacity: 1200 })!;
  assert.equal(p.needed, 4200);
  assert.equal(p.containers, 4);
  assert.equal(p.produced, 4800);
  assert.equal(p.difference, 600);
  assert.equal(p.recipeFactor, 4);
  assert.equal(formatDistribution(p.distribution, "g"), "4 × 1.200 g");
});

test("laatste schaal aanpassen", () => {
  const p = planParty({
    guests: 70,
    portion: 60,
    capacity: 1200,
    fullContainers: false,
  })!;
  assert.equal(p.containers, 4);
  assert.equal(p.produced, 4200);
  assert.equal(p.difference, 0);
  assert.equal(p.recipeFactor, 3.5);
  assert.equal(
    formatDistribution(p.distribution, "g"),
    "3 × 1.200 g + 1 × 600 g",
  );
});

test("deelnamefactor 70% van 100 gasten", () => {
  const p = planParty({
    guests: 100,
    portion: 60,
    capacity: 1200,
    participationPct: 70,
  })!;
  assert.equal(p.needed, 4200);
  assert.equal(p.containers, 4);
});

test("precies vol geeft geen extra schaal", () => {
  const p = planParty({ guests: 40, portion: 60, capacity: 1200 })!;
  assert.equal(p.containers, 2);
  assert.equal(p.difference, 0);
});

test("0 gasten = 0 schalen; ongeldige capaciteit = null", () => {
  assert.equal(
    planParty({ guests: 0, portion: 60, capacity: 1200 })!.containers,
    0,
  );
  assert.equal(planParty({ guests: 10, portion: 60, capacity: 0 }), null);
  assert.equal(personsPerContainer(1200, 60), 20);
});

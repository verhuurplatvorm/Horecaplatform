import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PriceComparisonRow } from "@/lib/types/database";
import { computeTotals, groupDeviations, referenceLabel, statusOf } from "./price-comparison";
import {
  checkDrafts,
  parseContractSheet,
  periodsOverlap,
  toDrafts,
  type ExistingContract,
} from "./contract-import";

const S = "sup-rovers";
const C = "comp-strand";

function row(o: Partial<PriceComparisonRow>): PriceComparisonRow {
  return {
    row_id: Math.random().toString(36).slice(2),
    batch_id: "b",
    invoice_number: "F",
    invoice_date: "2026-09-15",
    supplier_id: S,
    supplier_name: "Rovers",
    company_id: C,
    product_id: "olie",
    product_name: "Olijfolie",
    article_number: "123",
    description: "Olijfolie",
    packaging: "6 x 1 L",
    quantity: 1,
    invoice_price: 11,
    ref_price: 10,
    ref_source: "prijslijst",
    ref_date: "2026-09-01",
    ref_after_invoice: false,
    compare_basis: "verpakking",
    diff_per_unit: 1,
    diff_pct: 10,
    impact: 1,
    priority: 3,
    reasons: [],
    needs_check: false,
    review_status: null,
    review_note: null,
    article_key: "123",
    ...o,
  };
}

// Zelfde artikel op twee facturen; contract (€ 10,50) gaat halverwege in.
// Bedragen zoals price_comparison ze teruggeeft (zie de SQL-test).
const f1 = row({ batch_id: "F-1", invoice_number: "F-1", invoice_date: "2026-09-15", quantity: 2,
  ref_price: 10, ref_source: "prijslijst", ref_date: "2026-09-01", diff_per_unit: 1, impact: 2 });
const f2 = row({ batch_id: "F-2", invoice_number: "F-2", invoice_date: "2026-10-15", quantity: 3, article_number: "0123",
  ref_price: 10.5, ref_source: "contract", ref_date: "2026-10-01", diff_per_unit: 0.5, impact: 1.5, priority: 1 });

describe("Prijsvergelijking — bundelen", () => {
  it("zelfde artikel op twee facturen = één groep met 2 regels en € 3,50 verschil", () => {
    const [g, ...rest] = groupDeviations([f1, f2]);
    assert.equal(rest.length, 0);
    assert.equal(g.lineCount, 2);
    assert.equal(g.invoiceCount, 2);
    assert.equal(g.totalDiff, 3.5);
    assert.equal(g.overcharged, 3.5);
    assert.equal(g.topPriority, 1);
    assert.deepEqual(g.rows.map((r) => r.invoice_number), ["F-1", "F-2"]);
    assert.equal(g.firstDate, "2026-09-15");
    assert.equal(g.lastDate, "2026-10-15");
  });

  it("andere verpakking of ander bedrijf = aparte groep; beoordeelde regels vallen eruit", () => {
    const groups = groupDeviations([
      f1,
      f2,
      row({ batch_id: "F-3", packaging: "1 L" }),
      row({ batch_id: "F-4", company_id: "comp-zomers" }),
      row({ batch_id: "F-5", review_status: "geaccepteerd" }),
    ]);
    assert.equal(groups.length, 3);
    assert.equal(groups[0].lineCount, 2); // terugkerend eerst
    assert.equal(statusOf(row({ review_status: "geaccepteerd" })), "geaccepteerd"); // beoordeling per regel blijft
  });

  it("referentie zichtbaar: contract met ingangsdatum, prijslijst met datum", () => {
    assert.equal(referenceLabel(f2), "Contract, geldig vanaf 1 okt 26");
    assert.equal(referenceLabel(f1), "Prijslijst van 1 sep 26");
  });
});

describe("Prijsvergelijking — zonder referentieprijs", () => {
  const none = row({ ref_source: "geen", ref_price: null, ref_date: null, diff_per_unit: null, diff_pct: null,
    impact: null, priority: 4, reasons: ["Geen contract- of prijslijstprijs"] });

  it("telt in 'Zonder referentieprijs' en niet in 'Mogelijk te veel betaald'", () => {
    const t = computeTotals([f1, f2, none]);
    assert.equal(statusOf(none), "zonder_referentie");
    assert.equal(t.noReference, 1);
    assert.equal(t.overcharged, 3.5);
    assert.equal(t.toCheck, 0);
    assert.equal(groupDeviations([none]).length, 0);
  });
});

describe("Contractprijzen — Excel-import", () => {
  const suppliers = [{ id: S, name: "Rovers" }, { id: "sup-hanos", name: "Hanos" }];
  const companies = [{ id: C, name: "Het Strand" }, { id: "comp-zomers", name: "Zomers" }];
  const catalog = [{ supplierId: S, articleNumber: "000123", productId: "olie", productName: "Olijfolie", packaging: "6 x 1 L" }];
  const existing: ExistingContract[] = [{
    id: "ct-1", supplier_id: S, company_id: C, product_id: "olie", article_number: "123",
    packaging_description: "6x1L", price: 10.2, valid_from: "2026-01-01", valid_to: null,
  }];

  const sheet = [
    { Leverancier: "Rovers", Bedrijf: "Het Strand", Artikelnummer: "123", Verpakking: "6 x 1 L", "Prijs excl. btw": "10,50", Ingangsdatum: 46296 },
    { Leverancier: "Rovrs", Bedrijf: "Alle", Artikelnummer: "555", Verpakking: "1 kg", "Prijs excl. btw": 4, Ingangsdatum: "01-10-2026" },
    { Leverancier: "Hanos", Bedrijf: "Strandpaviljoen X", Artikelnummer: "777", Verpakking: "", "Prijs excl. btw": "abc", Ingangsdatum: "2026-12-01", Einddatum: "2026-11-01" },
  ];

  it("kolommen en Excel-datum herkend", () => {
    const { rows, missingColumns } = parseContractSheet(sheet);
    assert.deepEqual(missingColumns, []);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].validFrom, "2026-10-01"); // Excel-serienummer
    assert.equal(rows[1].validFrom, "2026-10-01"); // dd-mm-jjjj
    assert.equal(rows[0].line, 2);
  });

  it("matches, ontbrekende matches en overlap met een bestaand contract", () => {
    const drafts = toDrafts(parseContractSheet(sheet).rows, suppliers, companies);
    const [a, b, c] = checkDrafts(drafts, { catalog, existing });

    assert.equal(a.productId, "olie"); // 123 ↔ 000123
    assert.equal(a.priceValue, 10.5);
    assert.deepEqual(a.overlapsExisting, ["ct-1"]);
    assert.ok(a.issues.some((i) => i.text.startsWith("Overlapt met 1 bestaande")));
    assert.equal(a.canSave, true); // overlap = waarschuwing

    assert.equal(b.supplierId, null);
    assert.ok(b.issues.some((i) => i.text === 'Leverancier "Rovrs" niet gevonden'));
    assert.equal(b.canSave, false);

    assert.equal(c.companyId, null);
    const texts = c.issues.map((i) => i.text);
    assert.ok(texts.includes('Bedrijf "Strandpaviljoen X" niet gevonden'));
    assert.ok(texts.includes('Prijs "abc" is ongeldig'));
    assert.ok(texts.includes("Einddatum ligt vóór de ingangsdatum"));
    assert.ok(texts.some((t) => t.startsWith("Artikelnummer niet gevonden")));
  });

  it("overlap binnen het bestand; aansluitende periodes overlappen niet", () => {
    const base = { supplierText: "Rovers", supplierId: S, companyText: "", companyId: "", articleNumber: "9",
      description: "", packaging: "doos", price: "1", validTo: "", note: "" };
    const res = checkDrafts(
      [
        { ...base, line: 2, validFrom: "2026-09-01", validTo: "2026-09-30" },
        { ...base, line: 3, validFrom: "2026-10-01" },
        { ...base, line: 4, validFrom: "2026-10-15" },
      ],
      { catalog: [], existing: [] },
    );
    assert.deepEqual(res.map((r) => r.overlapsLines), [[], [4], [3]]);
    assert.equal(periodsOverlap({ from: "2026-09-01", to: "2026-09-30" }, { from: "2026-10-01", to: null }), false);
  });
});

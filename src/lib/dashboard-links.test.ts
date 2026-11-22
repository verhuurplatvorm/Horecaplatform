import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dashboardHref, describeScope, parseDashboardScope, scopeCompanyIds } from "./dashboard-links";
import { countUnmatchedNames, filterAlertsBySupplier, priceAlertCount } from "./dashboard-data";

const HS = "00000000-0000-0000-0000-0000000000a1";
const ZO = "00000000-0000-0000-0000-0000000000a2";
const names = new Map([[HS, "Het Strand"], [ZO, "Zomers"]]);

describe("Dashboard → doorklik: filters gaan mee en komen ongewijzigd aan", () => {
  for (const [label, companyIds] of [
    ["Het Strand", [HS]],
    ["Zomers", [ZO]],
    ["Alle bedrijven", null],
  ] as const) {
    it(label, () => {
      const scope = { companyIds: companyIds ? [...companyIds] : null, onlyCurrent: true, days: 90, supplierName: "Rovers", category: "Vis" };
      const href = dashboardHref("/recepturen", scope, { filter: "margeprobleem" });
      const url = new URL(href, "https://x");
      assert.equal(url.pathname, "/recepturen");
      assert.equal(url.searchParams.get("filter"), "margeprobleem");
      assert.deepEqual(parseDashboardScope(url.searchParams), scope);
      assert.equal(url.searchParams.has("bedrijf"), companyIds !== null);
    });
  }

  it("server-searchParams (object) werken hetzelfde", () => {
    assert.deepEqual(parseDashboardScope({ bedrijf: HS, kaart: "actueel" }), {
      companyIds: [HS],
      onlyCurrent: true,
      days: undefined,
      supplierName: null,
      category: null,
    });
  });

  it("alleen geldige bedrijfs-id's uit de URL", () => {
    assert.deepEqual(parseDashboardScope({ bedrijf: `${HS},x');drop table--` }).companyIds, [HS]);
    assert.equal(parseDashboardScope({ bedrijf: "onzin" }).companyIds, null);
  });

  it("groepsweergave = alle bedrijven; omschrijving voor de filterbalk", () => {
    assert.equal(scopeCompanyIds({ mode: "group" }, [HS, ZO]), null);
    assert.deepEqual(scopeCompanyIds({ mode: "companies" }, [ZO]), [ZO]);
    assert.equal(
      describeScope({ companyIds: [HS], onlyCurrent: true, days: 30 }, (id) => names.get(id)),
      "Het Strand · actuele kaart · laatste 30 dagen",
    );
    assert.equal(describeScope({ companyIds: null, onlyCurrent: false }, () => undefined, false), "Alle bedrijven");
  });
});

describe("Dashboard — tellers uit dezelfde rijen", () => {
  it("niet-gekoppelde namen: zelfde normalisatie als de database", () => {
    assert.equal(countUnmatchedNames([{ name: "Pizza saus" }, { name: " pizza  saus " }, { name: "Croutons" }]), 2);
  });

  it("prijsalarmen: leverancierfilter geldt voor tegel én lijst", () => {
    const data = {
      alerts: [
        { price_row_id: "1", product_id: "p", product_name: "Vis", supplier_name: "Rovers", company_id: null, old_price: 10, new_price: 12, difference_eur: 2, difference_pct: 20, changed_on: "2026-11-20" },
        { price_row_id: "2", product_id: "p", product_name: "Kaas", supplier_name: "Hanos", company_id: null, old_price: 10, new_price: 15, difference_eur: 5, difference_pct: 50, changed_on: "2026-11-20" },
      ],
      agreed: [
        { row_id: "a", batch_id: "b", invoice_number: "F1", invoice_date: "2026-11-19", supplier_name: "Rovers", product_id: "p", product_name: "Vis", description: null, invoice_price: 11, ref_price: 10, ref_source: "contract" as const, diff_pct: 10, impact: 1, reasons: [] },
      ],
    };
    assert.equal(priceAlertCount(filterAlertsBySupplier(data, null)), 3);
    const rovers = filterAlertsBySupplier(data, "Rovers");
    assert.equal(priceAlertCount(rovers), 2);
    assert.deepEqual(filterAlertsBySupplier(data, null).alerts.map((a) => a.product_name), ["Kaas", "Vis"]);
  });
});

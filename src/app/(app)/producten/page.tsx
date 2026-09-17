"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Download, Plus, Search, TriangleAlert, Trash2, Upload } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";
import { usePermissions } from "@/components/permissions/permissions-context";
import { ProductViewTabs } from "@/components/products/product-view-tabs";
import { ConfigurableTable } from "@/components/ui/configurable-table";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

interface ProductRow {
  id: string;
  name: string;
  customName: string | null;
  base_unit: string;
  base_unit_id: string | null;
  avg_unit_quantity: number | null;
  avg_unit_name: string | null;
  article_number: string | null;
  ean_code: string | null;
  is_active: boolean;
  priceRowId: string | null;
  pricePerBaseUnit: number | null;
  purchasePrice: number | null;
  packagingUnitCount: number | null;
  packagingDescription: string | null;
  supplierName: string | null;
  validFrom: string | null;
  productNumber: number | null;
  brand: string | null;
  productGroup: string | null;
  note: string | null;
  supplierArticleCode: string | null;
  createdAt: string;
  updatedAt: string;
  flaggedForReview: boolean;
  previousPurchasePrice: number | null;
}

interface UsageInfo {
  gerechten: number;
  halfproducten: number;
  facturenPrijzen: number;
  producties: number;
}

export default function ProductenPage() {
  const router = useRouter();
  const { can } = usePermissions();
  // Prijsalarm: drempel per groep, ingesteld in de database (0061).
  const [alertThreshold, setAlertThreshold] = useState(10);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("groups")
      .select("price_alert_threshold_pct")
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.price_alert_threshold_pct != null) {
          setAlertThreshold(Number(data.price_alert_threshold_pct));
        }
      });
  }, []);

  /** Exporteert wat er nu zichtbaar is (inclusief actieve zoekterm). */
  function exportCsv() {
    const header = [
      "ID","Naam","Leveranciersartikelnr.","Merk","Leverancier","Categorie",
      "Prijs per verpakking","Verpakking","Inhoud","Eenheid","Prijs per basiseenheid",
      "Prijswijziging %","Laatste prijswijziging","Beschikbaar","EAN","Notitie",
    ];
    const lines = filteredRows.map((r) => {
      const d = priceDelta(r);
      return [
        r.productNumber ?? "", r.customName?.trim() || r.name, r.supplierArticleCode ?? "",
        r.brand ?? "", r.supplierName ?? "", r.productGroup ?? "",
        r.purchasePrice?.toFixed(2) ?? "", r.packagingDescription ?? "",
        r.packagingUnitCount ?? "", r.base_unit, r.pricePerBaseUnit?.toFixed(4) ?? "",
        d ? d.pct.toFixed(2) : "",
        r.validFrom ? new Date(r.validFrom).toLocaleDateString("nl-NL") : "",
        r.is_active ? "Ja" : "Nee", r.ean_code ?? "", r.note ?? "",
      ];
    });
    const csv = [header, ...lines]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "ingredienten.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Prijsverschil t.o.v. de vorige actieve prijs, of null als er geen vorige is. */
  function priceDelta(r: ProductRow) {
    if (r.purchasePrice === null || r.previousPurchasePrice === null) return null;
    if (r.previousPurchasePrice === 0) return null;
    return {
      old: r.previousPurchasePrice,
      next: r.purchasePrice,
      euro: r.purchasePrice - r.previousPurchasePrice,
      pct: ((r.purchasePrice - r.previousPurchasePrice) / r.previousPurchasePrice) * 100,
    };
  }

  const canViewFinancial = can("producten").canViewFinancial;
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingRow, setDeletingRow] = useState<ProductRow | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [units, setUnits] = useState<
    { id: string; key: string; name: string; dimension: string }[]
  >([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("units")
      .select("id, key, name, dimension")
      .order("sort_order")
      .then(({ data, error: unitsError }) => {
        if (unitsError) {
          console.error("Kan eenheden niet ophalen:", unitsError.message);
        }
        setUnits(data ?? []);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();

      // Haalt ALLE ingrediënten op in batches van 1000 i.p.v. een harde
      // limiet van 200 — bij grotere catalogi (zoals Horesca Horecavo
      // met 400+ artikelen) werd de lijst eerder stilzwijgend afgekapt
      // zonder enige melding.
      const PAGE_SIZE = 1000;
      const allProducts: {
        id: string;
        name: string;
        custom_name: string | null;
        base_unit: string;
        base_unit_id: string | null;
        avg_unit_quantity: number | null;
        avg_unit_id: string | null;
        article_number: string | null;
        ean_code: string | null;
        is_active: boolean;
        manual_price_per_base_unit: number | null;
        product_number: number | null;
        brand: string | null;
        product_group: string | null;
        description: string | null;
        created_at: string;
        updated_at: string;
      }[] = [];
      let from = 0;
      let fetchError: { message: string } | null = null;

      while (true) {
        const { data, error: pageError } = await supabase
          .from("products")
          .select(
            "id, name, custom_name, base_unit, base_unit_id, avg_unit_quantity, avg_unit_id, article_number, ean_code, is_active, manual_price_per_base_unit, product_number, brand, product_group, description, created_at, updated_at"
          )
          .order("name")
          .range(from, from + PAGE_SIZE - 1);

        if (pageError) {
          fetchError = pageError;
          break;
        }
        if (!data || data.length === 0) break;
        allProducts.push(...data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      const products = fetchError ? null : allProducts;

      if (cancelled) return;
      if (fetchError || !products) {
        setError(true);
        setLoading(false);
        return;
      }

      const productIds = products.map((p) => p.id);

      // In batches ophalen — met 1600+ ingrediënten wordt één enkele
      // .in()-zoekopdracht met alle product-ID's tientallen kilobytes
      // groot, wat de zoekopdracht stil laat mislukken (geen leverancier,
      // prijs of verpakking meer zichtbaar voor ELK product).
      const PRICE_BATCH_SIZE = 200;
      const currentPrices: {
        id: string;
        product_id: string;
        purchase_price: number;
        packaging_unit_count: number | null;
        packaging_description: string | null;
        valid_from: string;
        supplier_article_code: string | null;
        flagged_for_review: boolean;
        suppliers: { name: string } | null;
      }[] = [];
      for (let i = 0; i < productIds.length; i += PRICE_BATCH_SIZE) {
        const batchIds = productIds.slice(i, i + PRICE_BATCH_SIZE);
        const { data, error: priceError } = await supabase
          .from("supplier_products")
          .select(
            "id, product_id, purchase_price, packaging_unit_count, packaging_description, valid_from, supplier_article_code, flagged_for_review, suppliers(name)"
          )
          .in("product_id", batchIds)
          .is("valid_to", null)
          .order("valid_from", { ascending: false });
        if (priceError) {
          console.error("Kan leveranciersprijzen niet ophalen voor batch:", priceError.message);
          continue;
        }
        // @ts-expect-error -- suppliers komt als geneste relatie terug, niet in het handmatige Database-type
        currentPrices.push(...(data ?? []));
      }

      const priceByProduct = new Map<
        string,
        {
          priceRowId: string;
          pricePerBaseUnit: number;
          purchasePrice: number;
          packagingUnitCount: number | null;
          packagingDescription: string | null;
          supplierName: string;
          validFrom: string;
          supplierArticleCode: string | null;
          flaggedForReview: boolean;
        }
      >();
      for (const row of currentPrices ?? []) {
        if (priceByProduct.has(row.product_id)) continue;
        const pricePerBaseUnit =
          row.packaging_unit_count && row.packaging_unit_count > 0
            ? row.purchase_price / row.packaging_unit_count
            : row.purchase_price;
        const supplierName: string = row.suppliers?.name ?? "onbekende leverancier";
        priceByProduct.set(row.product_id, {
          priceRowId: row.id,
          pricePerBaseUnit,
          purchasePrice: row.purchase_price,
          packagingUnitCount: row.packaging_unit_count,
          packagingDescription: row.packaging_description,
          supplierName,
          validFrom: row.valid_from,
          supplierArticleCode: row.supplier_article_code,
          flaggedForReview: row.flagged_for_review,
        });
      }

      // Vorige prijs per ingrediënt, voor de prijsverandering-kolommen.
      const prevPriceByProduct = new Map<string, number>();
      for (let i = 0; i < productIds.length; i += PRICE_BATCH_SIZE) {
        const { data } = await supabase
          .from("price_change_history")
          .select("product_id, old_purchase_price, valid_from")
          .in("product_id", productIds.slice(i, i + PRICE_BATCH_SIZE))
          .not("old_purchase_price", "is", null)
          .order("valid_from", { ascending: false });
        for (const h of data ?? []) {
          if (!prevPriceByProduct.has(h.product_id) && h.old_purchase_price != null) {
            prevPriceByProduct.set(h.product_id, h.old_purchase_price);
          }
        }
      }

      if (!cancelled) {
        setRows(
          products.map((p) => {
            const price = priceByProduct.get(p.id);
            // Geen actieve leveranciersprijs, maar wél een eigen kostprijs
            // op het ingrediënt (bv. kraanwater à €0) → toon die als bron
            // "Eigen prijs". Een leveranciersprijs gaat altijd voor.
            const usesManualPrice =
              !price && p.manual_price_per_base_unit != null;
            return {
              id: p.id,
              name: p.name,
              customName: p.custom_name,
              base_unit: p.base_unit,
              base_unit_id: p.base_unit_id,
              avg_unit_quantity: p.avg_unit_quantity,
              avg_unit_name: p.avg_unit_id
                ? units.find((u) => u.id === p.avg_unit_id)?.name ?? null
                : null,
              article_number: p.article_number,
              ean_code: p.ean_code,
              is_active: p.is_active,
              priceRowId: price?.priceRowId ?? null,
              pricePerBaseUnit: usesManualPrice
                ? p.manual_price_per_base_unit
                : price?.pricePerBaseUnit ?? null,
              purchasePrice: price?.purchasePrice ?? null,
              packagingUnitCount: price?.packagingUnitCount ?? null,
              packagingDescription: price?.packagingDescription ?? null,
              supplierName: usesManualPrice
                ? "Eigen prijs"
                : price?.supplierName ?? null,
              validFrom: price?.validFrom ?? null,
              productNumber: p.product_number,
              brand: p.brand,
              productGroup: p.product_group,
              note: p.description,
              supplierArticleCode: price?.supplierArticleCode ?? p.article_number,
              createdAt: p.created_at,
              updatedAt: p.updated_at,
              flaggedForReview: price?.flaggedForReview ?? false,
              previousPurchasePrice: prevPriceByProduct.get(p.id) ?? null,
            };
          })
        );
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function reload() {
    setReloadToken((t) => t + 1);
  }

  async function updatePriceField(
    priceRowId: string | null,
    patch: { purchase_price?: number; packaging_unit_count?: number; packaging_description?: string | null }
  ) {
    if (!priceRowId) return;
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("supplier_products")
      .update(patch)
      .eq("id", priceRowId);
    if (updateError) {
      window.alert("Opslaan mislukt: " + updateError.message);
      return;
    }
    // Meteen lokaal bijwerken i.p.v. de hele lijst opnieuw op te halen —
    // rekent ook de prijs per basiseenheid opnieuw uit als dat nodig is.
    setRows((prev) =>
      prev.map((r) => {
        if (r.priceRowId !== priceRowId) return r;
        const purchasePrice = patch.purchase_price !== undefined ? patch.purchase_price : r.purchasePrice;
        const packagingUnitCount =
          patch.packaging_unit_count !== undefined ? patch.packaging_unit_count : r.packagingUnitCount;
        const pricePerBaseUnit =
          purchasePrice !== null && packagingUnitCount && packagingUnitCount > 0
            ? purchasePrice / packagingUnitCount
            : purchasePrice;
        return {
          ...r,
          purchasePrice,
          packagingUnitCount,
          packagingDescription:
            patch.packaging_description !== undefined ? patch.packaging_description : r.packagingDescription,
          pricePerBaseUnit,
        };
      })
    );
  }

  async function updateBaseUnit(productId: string, newUnitId: string) {
    const unit = units.find((u) => u.id === newUnitId);
    if (!unit) return;
    const row = rows.find((r) => r.id === productId);
    // Waarschuw bij het wisselen van dimensie (bv. stuk → ml): bestaande
    // hoeveelheden in recepten en de verpakkingseenheid worden NIET
    // automatisch omgerekend — die moeten daarna handmatig kloppend
    // gemaakt worden. Binnen dezelfde dimensie (g → kg) geldt hetzelfde,
    // dus we waarschuwen altijd.
    const ok = window.confirm(
      `Eenheid van "${row?.name ?? "dit ingrediënt"}" wijzigen naar ${unit.name}?\n\n` +
        `Let op: hoeveelheden in recepten en de verpakkingseenheid worden ` +
        `niet automatisch omgerekend. Controleer daarna de verpakkingseenheid ` +
        `(inhoud) en de recepten waarin dit ingrediënt zit.`
    );
    if (!ok) return;
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("products")
      .update({ base_unit_id: newUnitId })
      .eq("id", productId);
    if (updateError) {
      window.alert("Opslaan mislukt: " + updateError.message);
      return;
    }
    // base_unit (tekst) wordt in de database gesynchroniseerd door de
    // trigger trg_products_sync_base_unit_text; lokaal doen we hetzelfde.
    setRows((prev) =>
      prev.map((r) =>
        r.id === productId
          ? { ...r, base_unit: unit.key, base_unit_id: newUnitId }
          : r
      )
    );
  }

  async function handleDeleteProduct() {
    if (!deletingRow) return;
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("products")
      .delete()
      .eq("id", deletingRow.id);
    if (deleteError) {
      window.alert(
        "Verwijderen mislukt: " +
          deleteError.message +
          " — mogelijk is dit ingrediënt nog gekoppeld aan een recept of halfproduct."
      );
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== deletingRow.id));
    setDeletingRow(null);
  }

  const q = query.trim().toLowerCase();
  const filteredRows = q
    ? rows.filter((r) =>
        [r.name, r.customName, r.supplierName, r.article_number, r.ean_code]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(q))
      )
    : rows;

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      const allVisible = filteredRows.every((r) => prev.has(r.id));
      const next = new Set(prev);
      if (allVisible) {
        for (const r of filteredRows) next.delete(r.id);
      } else {
        for (const r of filteredRows) next.add(r.id);
      }
      return next;
    });
  }

  return (
    <>
      <Topbar title="Centrale ingrediëntendatabase" />
      <main className="p-6 space-y-4">
        <ProductViewTabs />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek op leverancier, ingrediënt of artikelnummer…"
              className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
            />
          </div>
          <Button variant="secondary" onClick={exportCsv}>
            <Download className="h-4 w-4" />
            Exporteren
          </Button>
          <Link href="/producten/importeren">
            <Button variant="secondary">
              <Upload className="h-4 w-4" />
              Importeren (Excel)
            </Button>
          </Link>
          <Link href="/producten/nieuw">
            <Button>
              <Plus className="h-4 w-4" />
              Nieuw ingrediënt
            </Button>
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {!loading && (
              <span className="text-xs text-muted">
                {query.trim()
                  ? `${filteredRows.length} van ${rows.length} ingrediënten`
                  : `${rows.length} ingrediënten totaal`}
              </span>
            )}
          </div>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
              <span className="text-sm text-foreground">{selectedIds.size} geselecteerd</span>
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                Geselecteerde ingrediënten verwijderen
              </Button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-muted hover:text-foreground"
              >
                Selectie wissen
              </button>
            </div>
          )}
        </div>

        <ConfigurableTable<ProductRow>
          storageKey="ingredienten"
          rows={filteredRows}
          selectedIds={selectedIds}
          onToggleSelect={(id) =>
            setSelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onToggleSelectAll={(ids) =>
            setSelectedIds((prev) =>
              ids.every((i) => prev.has(i)) ? new Set() : new Set(ids)
            )
          }
          onRowClick={(row) => router.push(`/producten/${row.id}/bewerken`)}
          emptyLabel={
            loading ? "Ingrediënten laden…" : "Geen ingrediënten gevonden."
          }
          rowClassName={(row) => (!row.is_active ? "opacity-50" : undefined)}
          columns={[
            {
              key: "flag",
              label: "!",
              width: 40,
              noFilter: true,
              value: (r) => (r.flaggedForReview ? "1" : "0"),
              render: (r) =>
                r.flaggedForReview ? (
                  <TriangleAlert
                    className="h-4 w-4 text-copper"
                    aria-label="Niet herkend — controleer dit ingrediënt"
                  />
                ) : null,
            },
            { key: "nr", label: "ID", width: 60, align: "right", value: (r) => r.productNumber },
            {
              key: "naam",
              label: "Naam",
              width: 230,
              sticky: true,
              value: (r) => r.customName?.trim() || r.name,
            },
            {
              key: "artnr",
              label: "Leveranciersartikelnr.",
              width: 130,
              value: (r) => r.supplierArticleCode,
            },
            { key: "merk", label: "Merk", width: 110, value: (r) => r.brand },
            { key: "lev", label: "Leverancier", width: 140, value: (r) => r.supplierName },
            { key: "cat", label: "Categorie", width: 130, value: (r) => r.productGroup },
            {
              key: "prijsverp",
              label: "Prijs per verpakking",
              width: 110,
              align: "right",
              value: (r) => r.purchasePrice,
              render: (r) =>
                r.purchasePrice !== null ? `€ ${r.purchasePrice.toFixed(2)}` : "—",
            },
            {
              key: "verp",
              label: "Verpakking",
              width: 130,
              value: (r) => r.packagingDescription,
            },
            {
              key: "inhoud",
              label: "Inhoud verpakking",
              width: 100,
              align: "right",
              value: (r) => r.packagingUnitCount,
            },
            { key: "eenheid", label: "Eenheid", width: 90, value: (r) => r.base_unit },
            {
              key: "prijsbasis",
              label: "Prijs per basiseenheid",
              width: 120,
              align: "right",
              value: (r) => r.pricePerBaseUnit,
              render: (r) =>
                r.pricePerBaseUnit !== null
                  ? `€ ${r.pricePerBaseUnit.toFixed(4)} / ${r.base_unit}`
                  : "—",
            },
            {
              key: "deltapct",
              label: "Prijswijziging %",
              width: 130,
              align: "right",
              value: (r) => priceDelta(r)?.pct ?? null,
              render: (r) => {
                const d = priceDelta(r);
                if (!d) return "—";
                const alarm = Math.abs(d.pct) >= alertThreshold;
                return (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      d.pct > 0 ? "text-danger" : "text-success",
                      alarm && "font-semibold"
                    )}
                    title={
                      alarm
                        ? `Boven de prijsalarm-drempel van ${alertThreshold}%`
                        : undefined
                    }
                  >
                    {alarm && <TriangleAlert className="h-3 w-3" />}
                    {d.pct > 0 ? "+" : ""}
                    {d.pct.toFixed(2)}%
                  </span>
                );
              },
            },
            {
              key: "deltaeur",
              label: "Prijswijziging €",
              width: 150,
              align: "right",
              value: (r) => priceDelta(r)?.euro ?? null,
              render: (r) => {
                const d = priceDelta(r);
                if (!d) return "—";
                return (
                  <span className="whitespace-nowrap text-xs">
                    <span className="text-muted line-through">
                      € {d.old.toFixed(2)}
                    </span>{" "}
                    → € {d.next.toFixed(2)}
                  </span>
                );
              },
            },
            {
              key: "laatste",
              label: "Laatste prijswijziging",
              width: 120,
              value: (r) => r.validFrom,
              render: (r) =>
                r.validFrom ? new Date(r.validFrom).toLocaleDateString("nl-NL") : "—",
            },
            {
              key: "gemaakt",
              label: "Aangemaakt op",
              width: 110,
              hiddenByDefault: true,
              value: (r) => r.createdAt,
              render: (r) => new Date(r.createdAt).toLocaleDateString("nl-NL"),
            },
            {
              key: "gewijzigd",
              label: "Gewijzigd op",
              width: 110,
              hiddenByDefault: true,
              value: (r) => r.updatedAt,
              render: (r) => new Date(r.updatedAt).toLocaleDateString("nl-NL"),
            },
            {
              key: "historie",
              label: "Prijshistorie",
              width: 90,
              noFilter: true,
              value: () => "",
              render: (r) => (
                <Link
                  href={`/producten/${r.id}/bewerken#prijzen`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-teal hover:underline"
                >
                  bekijk
                </Link>
              ),
            },
            {
              key: "actief",
              label: "Beschikbaar",
              width: 90,
              value: (r) => (r.is_active ? "Ja" : "Nee"),
            },
            {
              key: "status",
              label: "Status",
              width: 110,
              value: (r) =>
                r.flaggedForReview
                  ? "Te controleren"
                  : r.pricePerBaseUnit === null
                    ? "Geen prijs"
                    : "In orde",
            },
            {
              key: "notitie",
              label: "Notitie",
              width: 160,
              hiddenByDefault: true,
              value: (r) => r.note,
            },
            { key: "ean", label: "EAN-code", width: 130, value: (r) => r.ean_code },
          ]}
        />
      </main>

      {confirming && (
        <BulkDeleteModal
          selectedIds={[...selectedIds]}
          rowsById={new Map(rows.map((r) => [r.id, r]))}
          onClose={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false);
            setSelectedIds(new Set());
            reload();
          }}
        />
      )}
      {deletingRow && (
        <Modal title="Ingrediënt verwijderen" onClose={() => setDeletingRow(null)}>
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              Weet je zeker dat je &quot;{deletingRow.name}&quot; wilt verwijderen? Dit kan niet
              ongedaan gemaakt worden. Is dit ingrediënt nog gekoppeld aan een recept of
              halfproduct, dan wordt het verwijderen geblokkeerd.
            </p>
            <div className="flex gap-2">
              <Button variant="danger" onClick={handleDeleteProduct}>
                Definitief verwijderen
              </Button>
              <Button variant="secondary" onClick={() => setDeletingRow(null)}>
                Annuleren
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function BulkDeleteModal({
  selectedIds,
  rowsById,
  onClose,
  onDone,
}: {
  selectedIds: string[];
  rowsById: Map<string, ProductRow>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [checking, setChecking] = useState(true);
  const [usageById, setUsageById] = useState<Map<string, UsageInfo>>(new Map());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();

      const [{ data: ingredients }, { data: supplierPrices }, { data: importRows }, { data: movements }] =
        await Promise.all([
          supabase
            .from("recipe_ingredients")
            .select("product_id, recipes(recipe_kind)")
            .in("product_id", selectedIds),
          supabase.from("supplier_products").select("product_id").in("product_id", selectedIds),
          supabase
            .from("price_import_rows")
            .select("matched_product_id")
            .in("matched_product_id", selectedIds),
          supabase.from("stock_movements").select("product_id").in("product_id", selectedIds),
        ]);

      if (cancelled) return;

      const usage = new Map<string, UsageInfo>();
      for (const id of selectedIds) {
        usage.set(id, { gerechten: 0, halfproducten: 0, facturenPrijzen: 0, producties: 0 });
      }
      for (const row of ingredients ?? []) {
        if (!row.product_id) continue;
        const u = usage.get(row.product_id);
        if (!u) continue;
        // @ts-expect-error -- geneste relatie, niet in het handmatige Database-type
        if (row.recipes?.recipe_kind === "halfproduct") u.halfproducten++;
        else u.gerechten++;
      }
      for (const row of supplierPrices ?? []) {
        if (!row.product_id) continue;
        const u = usage.get(row.product_id);
        if (u) u.facturenPrijzen++;
      }
      for (const row of importRows ?? []) {
        if (!row.matched_product_id) continue;
        const u = usage.get(row.matched_product_id);
        if (u) u.facturenPrijzen++;
      }
      for (const row of movements ?? []) {
        if (!row.product_id) continue;
        const u = usage.get(row.product_id);
        if (u) u.producties++;
      }

      if (!cancelled) {
        setUsageById(usage);
        setChecking(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [selectedIds]);

  const blocked = selectedIds.filter((id) => {
    const u = usageById.get(id);
    return u && (u.gerechten > 0 || u.halfproducten > 0);
  });
  const deletable = selectedIds.filter((id) => !blocked.includes(id));
  const deletableWithHistory = deletable.filter((id) => {
    const u = usageById.get(id);
    return u && (u.facturenPrijzen > 0 || u.producties > 0);
  });

  async function handleConfirmDelete() {
    setDeleting(true);
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("products").delete().in("id", deletable);
    setDeleting(false);
    if (deleteError) {
      setError("Verwijderen mislukt: " + deleteError.message);
      return;
    }
    onDone();
  }

  return (
    <Modal title="Geselecteerde ingrediënten verwijderen" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          {selectedIds.length} product(en) geselecteerd om te verwijderen.
        </p>

        {checking ? (
          <p className="text-sm text-muted">Bezig met controleren op koppelingen…</p>
        ) : (
          <>
            {blocked.length > 0 && (
              <div className="rounded-md border border-danger/40 bg-danger/10 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-danger">
                  <TriangleAlert className="h-4 w-4" />
                  {blocked.length} product(en) worden NIET verwijderd
                </p>
                <p className="mt-1 text-xs text-danger">
                  Deze zijn gekoppeld aan een receptuur of halfproduct — verwijderen zou bestaande
                  kostprijsberekeningen beschadigen. Zet ze desgewenst op &quot;inactief&quot; in
                  plaats van te verwijderen.
                </p>
                <ul className="mt-2 space-y-1 text-xs text-danger">
                  {blocked.map((id) => {
                    const u = usageById.get(id);
                    return (
                      <li key={id}>
                        &quot;{rowsById.get(id)?.name}&quot; — gebruikt in {u?.gerechten ?? 0}{" "}
                        recept(en), {u?.halfproducten ?? 0} halfproduct(en)
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {deletableWithHistory.length > 0 && (
              <div className="rounded-md border border-copper/40 bg-copper/10 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-copper">
                  <TriangleAlert className="h-4 w-4" />
                  {deletableWithHistory.length} product(en) hebben leveranciersprijzen en/of
                  productiegeschiedenis
                </p>
                <p className="mt-1 text-xs text-copper">
                  Deze worden wél verwijderd (geen harde koppeling), maar hun prijshistorie en
                  voorraadmutaties verdwijnen daarmee ook definitief.
                </p>
                <ul className="mt-2 space-y-1 text-xs text-copper">
                  {deletableWithHistory.map((id) => {
                    const u = usageById.get(id);
                    return (
                      <li key={id}>
                        &quot;{rowsById.get(id)?.name}&quot; — {u?.facturenPrijzen ?? 0}{" "}
                        factuur-/prijsregel(s), {u?.producties ?? 0} voorraadmutatie(s)
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {deletable.length > 0 && deletableWithHistory.length < deletable.length && (
              <p className="text-sm text-muted">
                {deletable.length - deletableWithHistory.length} product(en) hebben geen enkele
                koppeling en worden zonder gevolgen verwijderd.
              </p>
            )}
          </>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <Button
            variant="danger"
            onClick={handleConfirmDelete}
            disabled={checking || deleting || deletable.length === 0}
          >
            {deleting
              ? "Bezig…"
              : `${deletable.length} product(en) definitief verwijderen`}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Annuleren
          </Button>
        </div>
      </div>
    </Modal>
  );
}



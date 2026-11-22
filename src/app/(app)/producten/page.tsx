"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus, Search, TriangleAlert, Trash2, Upload } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";
import { PackagingEditModal, type PackagingEditResult, type PackagingEditTarget } from "@/components/products/packaging-edit-modal";
import { withReturnTo } from "@/lib/use-return-navigation";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import { ProductViewTabs } from "@/components/products/product-view-tabs";
import { FavoriteStar } from "@/components/products/favorite-star";
import { ConfigurableTable } from "@/components/ui/configurable-table";
import { cn } from "@/lib/utils";
import { formatUnitPrice, unitPriceLines } from "@/lib/packaging";
import { useRouter } from "next/navigation";

interface ProductRow {
  id: string;
  name: string;
  customName: string | null;
  base_unit: string;
  base_unit_id: string | null;
  avg_unit_quantity: number | null;
  avg_unit_name: string | null;
  avgUnitKey: string | null;
  netUnitQuantity: number | null;
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
  isFavorite: boolean;
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

  /** Exporteert het volledige resultaat van de huidige zoekopdracht en filters (alle pagina's). */
  async function exportCsv() {
    const all: ProductRow[] = [];
    for (let offset = 0; offset < Math.max(totalCount, 1); offset += 500) {
      const { rows: chunk } = await fetchRows(offset, 500);
      all.push(...chunk);
      if (chunk.length < 500) break;
    }
    const header = [
      "ID","Naam","Leveranciersartikelnr.","Merk","Leverancier","Categorie",
      "Prijs per verpakking","Verpakking","Inhoud","Eenheid","Prijs per basiseenheid",
      "Prijswijziging %","Laatste prijswijziging","Beschikbaar","EAN","Notitie",
    ];
    const lines = all.map((r) => {
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

  /**
   * Prijs per basiseenheid plus de passende extra prijzen (per stuk, per
   * kg/g bij gewicht, per liter bij inhoud) — één centrale regel
   * (unitPriceLines). Brood 18 × 260 g: per stuk en per kg, nooit per liter.
   */
  function unitPrices(r: ProductRow) {
    return unitPriceLines({
      pricePerBase: r.pricePerBaseUnit,
      baseUnit: r.base_unit,
      bridgeQuantity: r.avg_unit_quantity,
      bridgeUnit: r.avgUnitKey,
      netQuantity: r.netUnitQuantity,
    });
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
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [packagingTarget, setPackagingTarget] = useState<PackagingEditTarget | null>(null);
  const [deletingRow, setDeletingRow] = useState<ProductRow | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Alles wat de lijst bepaalt gaat naar de database: zoeken, kolomfilters,
  // sorteren, leverancier, favorieten, actuele ingrediënten en de pagina.
  const PAGE_SIZE = 100;
  const [columnQuery, setColumnQuery] = useState<{
    filters: Record<string, string>;
    sortKey: string | null;
    sortDesc: boolean;
  }>({ filters: {}, sortKey: null, sortDesc: false });
  const [supplierFilter, setSupplierFilter] = useState<string>("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [onlyCurrent, setOnlyCurrent] = useState(false);
  const [supplierNames, setSupplierNames] = useState<string[]>([]);

  useEffect(() => {
    createClient()
      .from("suppliers")
      .select("name")
      .order("name")
      .then(({ data }) => setSupplierNames((data ?? []).map((x) => x.name as string)));
  }, []);

  const onQueryChange = useCallback(
    (q: { filters: Record<string, string>; sortKey: string | null; sortDesc: boolean }) =>
      setColumnQuery((prev) => (JSON.stringify(prev) === JSON.stringify(q) ? prev : q)),
    []
  );

  // Paginanummer hoort bij één combinatie van zoeken, filters en sortering:
  // verandert daar iets aan, dan begint de lijst vanzelf weer op pagina 1.
  const listKey = JSON.stringify([query.trim(), columnQuery, supplierFilter, onlyFavorites, onlyCurrent]);
  const [pageState, setPageState] = useState({ key: listKey, page: 0 });
  const page = pageState.key === listKey ? pageState.page : 0;
  const setPage = (next: number | ((p: number) => number)) =>
    setPageState({ key: listKey, page: typeof next === "function" ? next(page) : next });

  /** Ster in de lijst bijwerken zonder opnieuw te laden. */
  function markFavorite(id: string, value: boolean) {
    setRows((prev) => prev.map((x) => (x.id === id ? { ...x, isFavorite: value } : x)));
  }

  /** Eén pagina van de volledige, gefilterde en gesorteerde lijst. */
  const fetchRows = useCallback(
    async (offset: number, limit: number): Promise<{ rows: ProductRow[]; total: number; failed: boolean }> => {
      const { data, error: rpcError } = await createClient().rpc("search_products_page", {
        p_company_id: referenceCompanyId,
        p_search: query.trim() || null,
        p_filters: columnQuery.filters,
        p_sort_key: columnQuery.sortKey,
        p_sort_desc: columnQuery.sortDesc,
        p_limit: limit,
        p_offset: offset,
        p_only_favorites: onlyFavorites,
        p_only_current: onlyCurrent,
        p_supplier: supplierFilter || null,
      });
      if (rpcError) return { rows: [], total: 0, failed: true };
      const list = data ?? [];
      const num = (v: number | string | null) => (v === null ? null : Number(v));
      const mapped: ProductRow[] = list.map((p) => ({
        id: p.id,
        name: p.name,
        customName: p.custom_name,
        base_unit: p.base_unit,
        base_unit_id: p.base_unit_id,
        avg_unit_quantity: num(p.avg_unit_quantity),
        avg_unit_name: null,
        avgUnitKey: p.avg_unit_key,
        netUnitQuantity: num(p.net_unit_quantity),
        article_number: p.article_number,
        ean_code: p.ean_code,
        is_active: p.is_active,
        priceRowId: p.price_row_id,
        // De database kiest al tussen leveranciersprijs en eigen prijs.
        pricePerBaseUnit: num(p.price_per_base_unit),
        purchasePrice: num(p.purchase_price),
        packagingUnitCount: num(p.packaging_unit_count),
        packagingDescription: p.packaging_description,
        supplierName: p.supplier_name,
        validFrom: p.valid_from,
        productNumber: p.product_number,
        brand: p.brand,
        productGroup: p.product_group,
        note: p.description,
        supplierArticleCode: p.supplier_article_code ?? p.article_number,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        flaggedForReview: p.flagged_for_review,
        previousPurchasePrice: num(p.previous_purchase_price),
        isFavorite: p.is_favorite,
      }));
      return { rows: mapped, total: list.length > 0 ? Number(list[0].total_count) : 0, failed: false };
    },
    [referenceCompanyId, query, columnQuery, onlyFavorites, onlyCurrent, supplierFilter]
  );

  // Ophalen met een korte vertraging (typen in zoekveld of kolomfilter);
  // alleen het antwoord op de laatste aanvraag telt.
  const requestRef = useRef(0);
  useEffect(() => {
    const myRequest = ++requestRef.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await fetchRows(page * PAGE_SIZE, PAGE_SIZE);
      if (myRequest !== requestRef.current) return;
      if (res.failed) {
        setError(true);
      } else {
        setError(false);
        setRows(res.rows);
        // Lege pagina voorbij het einde (bv. na verwijderen): terug naar pagina 1.
        if (res.rows.length === 0 && page > 0) setPage(0);
        else setTotalCount(res.total);
      }
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [fetchRows, page, reloadToken]);

  function reload() {
    setReloadToken((t) => t + 1);
  }

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const firstShown = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastShown = Math.min(totalCount, page * PAGE_SIZE + rows.length);

  /** Klikbare cel: opent het verpakking-venster (verpakking, inhoud, eenheid en prijs per eenheid). */
  function packagingCell(r: ProductRow, content: React.ReactNode) {
    if (!r.priceRowId || r.purchasePrice === null) return content;
    return (
      <button
        type="button"
        title="Verpakking, inhoud en eenheid aanpassen"
        className="w-full cursor-pointer text-inherit hover:text-teal"
        style={{ textAlign: "inherit" }}
        onClick={(e) => {
          e.stopPropagation();
          setPackagingTarget({
            productId: r.id,
            productName: r.name,
            priceRowId: r.priceRowId!,
            purchasePrice: r.purchasePrice!,
            baseUnitKey: r.base_unit,
            packagingDescription: r.packagingDescription,
          });
        }}
      >
        {content}
      </button>
    );
  }

  function handlePackagingSaved(productId: string, priceRowId: string, result: PackagingEditResult) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== productId) return r;
        const isTarget = r.priceRowId === priceRowId;
        const count = isTarget ? result.packagingUnitCount : r.packagingUnitCount;
        return {
          ...r,
          base_unit: result.baseUnitKey,
          avg_unit_quantity: result.avgUnitQuantity ?? r.avg_unit_quantity,
          packagingUnitCount: count,
          packagingDescription: isTarget ? result.packagingDescription : r.packagingDescription,
          pricePerBaseUnit:
            isTarget && r.purchasePrice !== null && count ? r.purchasePrice / count : r.pricePerBaseUnit,
        };
      })
    );
    setPackagingTarget(null);
    reload();
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


  return (
    <>
      <Topbar title="Centrale ingrediëntendatabase" />
      <main className="p-6 space-y-4">
        <ProductViewTabs />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-64 max-w-md flex-[1_1_20rem]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              placeholder="Zoek op leverancier, ingrediënt of artikelnummer…"
              className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
            />
          </div>
          <Button variant="secondary" onClick={exportCsv}>
            <Download className="h-4 w-4" />
            Exporteren
          </Button>
          <Link href="/producten/maten-koppelen">
            <Button variant="secondary">Maten koppelen</Button>
          </Link>
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
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select
            value={supplierFilter}
            onChange={(e) => {
              setSupplierFilter(e.target.value);
            }}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
            title="Leverancier van de actuele prijs"
          >
            <option value="">Alle leveranciers</option>
            <option value="Eigen prijs">Eigen prijs</option>
            {supplierNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-muted">
            <input
              type="checkbox"
              checked={onlyFavorites}
              onChange={(e) => {
                setOnlyFavorites(e.target.checked);
              }}
            />
            Alleen favorieten
          </label>
          <label
            className="flex items-center gap-1.5 text-muted"
            title="Ingrediënten in de actuele halfproducten en de gerechten op actieve menukaarten"
          >
            <input
              type="checkbox"
              checked={onlyCurrent}
              onChange={(e) => {
                setOnlyCurrent(e.target.checked);
              }}
            />
            Alleen actuele ingrediënten
          </label>
          <span className="ml-auto text-sm" aria-live="polite">
            {error ? (
              <span className="text-danger">Zoeken mislukt — probeer het opnieuw.</span>
            ) : loading && totalCount === 0 ? (
              <span className="text-muted">Zoeken…</span>
            ) : (
              <>
                <strong>{totalCount.toLocaleString("nl-NL")}</strong>{" "}
                <span className="text-muted">
                  {totalCount === 1 ? "resultaat" : "resultaten"}
                  {totalCount > 0 && ` · ${firstShown}–${lastShown}`}
                  {loading && " · bijwerken…"}
                </span>
              </>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div />
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
          rows={rows}
          server={{ onQueryChange, totalCount, unsortable: ["fav", "flag", "historie"] }}
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
          onRowClick={(row) => router.push(withReturnTo(`/producten/${row.id}/bewerken`))}
          emptyLabel={
            loading ? "Ingrediënten laden…" : "Geen ingrediënten gevonden met deze zoekopdracht en filters."
          }
          rowClassName={(row) => (!row.is_active ? "opacity-50" : undefined)}
          columns={[
            {
              key: "fav",
              label: "★",
              width: 40,
              noFilter: true,
              value: (r) => (r.isFavorite ? "1" : "0"),
              render: (r) => (
                <FavoriteStar
                  key={`${r.id}:${r.isFavorite}`}
                  productId={r.id}
                  initial={r.isFavorite}
                  onChange={(v) => markFavorite(r.id, v)}
                />
              ),
            },
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
              render: (r) => packagingCell(r, r.packagingDescription ?? "invullen"),
            },
            {
              key: "inhoud",
              label: "Inhoud verpakking",
              width: 100,
              align: "right",
              value: (r) => r.packagingUnitCount,
              render: (r) => packagingCell(r, r.packagingUnitCount ?? "—"),
            },
            {
              key: "eenheid",
              label: "Eenheid",
              width: 90,
              value: (r) => r.base_unit,
              render: (r) => packagingCell(r, r.base_unit),
            },
            {
              key: "prijsbasis",
              label: "Prijs per basiseenheid",
              width: 120,
              align: "right",
              value: (r) => r.pricePerBaseUnit,
              render: (r) =>
                packagingCell(
                  r,
                  (() => {
                    const prices = unitPrices(r);
                    if (!prices.primary) return "—";
                    return (
                      <span>
                        {formatUnitPrice(prices.primary)}
                        {prices.extra.map((line) => (
                          <span key={line.label} className="block text-xs text-muted">
                            {formatUnitPrice(line)}
                          </span>
                        ))}
                      </span>
                    );
                  })()
                ),
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

        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-3 text-sm">
            <Button variant="secondary" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> Vorige
            </Button>
            <span className="text-muted">
              Pagina {page + 1} van {pageCount}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page + 1 >= pageCount || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Volgende <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
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
      {packagingTarget && (
        <PackagingEditModal
          target={packagingTarget}
          onClose={() => setPackagingTarget(null)}
          onSaved={(result) =>
            handlePackagingSaved(packagingTarget.productId, packagingTarget.priceRowId, result)
          }
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



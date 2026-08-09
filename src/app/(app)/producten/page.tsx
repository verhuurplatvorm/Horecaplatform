"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Search, TriangleAlert, Trash2, Upload } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";
import { ProductViewTabs } from "@/components/products/product-view-tabs";

interface ProductRow {
  id: string;
  name: string;
  customName: string | null;
  base_unit: string;
  base_unit_id: string | null;
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
}

interface UsageInfo {
  gerechten: number;
  halfproducten: number;
  facturenPrijzen: number;
  producties: number;
}

export default function ProductenPage() {
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

      // Haalt ALLE producten op in batches van 1000 i.p.v. een harde
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
        article_number: string | null;
        ean_code: string | null;
        is_active: boolean;
        manual_price_per_base_unit: number | null;
      }[] = [];
      let from = 0;
      let fetchError: { message: string } | null = null;

      while (true) {
        const { data, error: pageError } = await supabase
          .from("products")
          .select(
            "id, name, custom_name, base_unit, base_unit_id, article_number, ean_code, is_active, manual_price_per_base_unit"
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

      // In batches ophalen — met 1600+ producten wordt één enkele
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
        suppliers: { name: string } | null;
      }[] = [];
      for (let i = 0; i < productIds.length; i += PRICE_BATCH_SIZE) {
        const batchIds = productIds.slice(i, i + PRICE_BATCH_SIZE);
        const { data, error: priceError } = await supabase
          .from("supplier_products")
          .select(
            "id, product_id, purchase_price, packaging_unit_count, packaging_description, valid_from, suppliers(name)"
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
        });
      }

      if (!cancelled) {
        setRows(
          products.map((p) => {
            const price = priceByProduct.get(p.id);
            // Geen actieve leveranciersprijs, maar wél een eigen kostprijs
            // op het product (bv. kraanwater à €0) → toon die als bron
            // "Eigen prijs". Een leveranciersprijs gaat altijd voor.
            const usesManualPrice =
              !price && p.manual_price_per_base_unit != null;
            return {
              id: p.id,
              name: p.name,
              customName: p.custom_name,
              base_unit: p.base_unit,
              base_unit_id: p.base_unit_id,
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
      `Eenheid van "${row?.name ?? "dit product"}" wijzigen naar ${unit.name}?\n\n` +
        `Let op: hoeveelheden in recepten en de verpakkingseenheid worden ` +
        `niet automatisch omgerekend. Controleer daarna de verpakkingseenheid ` +
        `(inhoud) en de recepten waarin dit product zit.`
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
          " — mogelijk is dit product nog gekoppeld aan een recept of halfproduct."
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

  const allVisibleSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selectedIds.has(r.id));

  return (
    <>
      <Topbar title="Centrale productdatabase" />
      <main className="p-6 space-y-4">
        <ProductViewTabs />
        <div className="flex items-center justify-between gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek op leverancier, ingrediënt of artikelnummer…"
              className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
            />
          </div>
          <Link href="/producten/importeren">
            <Button variant="secondary">
              <Upload className="h-4 w-4" />
              Importeren (Excel)
            </Button>
          </Link>
          <Link href="/producten/nieuw">
            <Button>
              <Plus className="h-4 w-4" />
              Nieuw product
            </Button>
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {!loading && (
              <span className="text-xs text-muted">
                {query.trim()
                  ? `${filteredRows.length} van ${rows.length} producten`
                  : `${rows.length} producten totaal`}
              </span>
            )}
          </div>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
              <span className="text-sm text-foreground">{selectedIds.size} geselecteerd</span>
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                Geselecteerde producten verwijderen
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

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="w-10 px-5 py-3 font-medium">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      aria-label="Alles selecteren"
                    />
                  </th>
                  <th className="px-5 py-3 font-medium">Artikel</th>
                  <th className="px-5 py-3 font-medium">Leverancier</th>
                  <th className="px-5 py-3 font-medium">Eenheid</th>
                  <th className="px-5 py-3 font-medium">Verpakkingseenheid</th>
                  <th className="px-5 py-3 font-medium">Aankoopprijs</th>
                  <th className="px-5 py-3 font-medium">Actuele inkoopprijs</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-background">
                    <td className="px-5 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleOne(p.id)}
                        aria-label={`Selecteer ${p.name}`}
                      />
                    </td>
                    <td className="px-5 py-3 font-medium">
                      <Link
                        href={`/producten/${p.id}/bewerken`}
                        className="hover:text-teal hover:underline"
                      >
                        {p.name}
                      </Link>
                      {p.customName && p.customName !== p.name && (
                        <p className="text-xs text-muted">Eigen naam: {p.customName}</p>
                      )}
                      {p.article_number && (
                        <p className="text-xs text-muted">Art.nr. {p.article_number}</p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted">{p.supplierName ?? "—"}</td>
                    <td className="px-5 py-3">
                      <UnitEditCell
                        units={units}
                        currentUnitId={p.base_unit_id}
                        currentLabel={p.base_unit}
                        onSave={(unitId) => updateBaseUnit(p.id, unitId)}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <InlineEditCell
                        value={p.packagingUnitCount !== null ? String(p.packagingUnitCount) : null}
                        placeholder="—"
                        suffix={` ${p.base_unit}`}
                        hint={p.packagingDescription ?? undefined}
                        type="number"
                        disabled={!p.priceRowId}
                        onSave={(value) => {
                          const num = Number(value);
                          if (!value || !Number.isFinite(num) || num <= 0) return;
                          updatePriceField(p.priceRowId, { packaging_unit_count: num });
                        }}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <InlineEditCell
                        value={p.purchasePrice !== null ? p.purchasePrice.toFixed(2) : null}
                        placeholder="—"
                        prefix="€ "
                        type="number"
                        disabled={!p.priceRowId}
                        onSave={(value) => {
                          const num = Number(value);
                          if (!value || !Number.isFinite(num) || num <= 0) return;
                          updatePriceField(p.priceRowId, { purchase_price: num });
                        }}
                      />
                    </td>
                    <td className="px-5 py-3 tabular">
                      {p.pricePerBaseUnit !== null ? (
                        <div>
                          <div className="text-foreground">
                            € {p.pricePerBaseUnit.toFixed(4)} / {p.base_unit}
                          </div>
                          {p.validFrom && (
                            <div className="text-xs text-muted">
                              sinds {new Date(p.validFrom).toLocaleDateString("nl-NL")}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted">Geen prijs bekend</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          p.is_active
                            ? "rounded-full bg-success/10 px-2 py-0.5 text-xs text-success"
                            : "rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted"
                        }
                      >
                        {p.is_active ? "Actief" : "Inactief"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => setDeletingRow(p)}
                        title="Product verwijderen"
                        className="text-muted hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredRows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={9} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan producten niet laden — controleer de Supabase-koppeling."
                        : q
                        ? "Geen producten gevonden voor deze zoekopdracht."
                        : "Nog geen producten in de centrale database. Voeg het eerste artikel toe."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
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
        <Modal title="Product verwijderen" onClose={() => setDeletingRow(null)}>
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              Weet je zeker dat je &quot;{deletingRow.name}&quot; wilt verwijderen? Dit kan niet
              ongedaan gemaakt worden. Is dit product nog gekoppeld aan een recept of
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
    <Modal title="Geselecteerde producten verwijderen" onClose={onClose}>
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

function UnitEditCell({
  units,
  currentUnitId,
  currentLabel,
  onSave,
}: {
  units: { id: string; key: string; name: string; dimension: string }[];
  currentUnitId: string | null;
  currentLabel: string;
  onSave: (unitId: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          if (units.length === 0) {
            window.alert(
              "De eenhedenlijst kon niet geladen worden — herlaad de pagina en probeer opnieuw."
            );
            return;
          }
          setEditing(true);
        }}
        className="rounded px-1 py-0.5 text-left text-muted hover:bg-background hover:underline"
        title="Klik om de eenheid te wijzigen"
      >
        {currentLabel}
      </button>
    );
  }

  const byDimension: Record<string, typeof units> = {};
  for (const u of units) {
    (byDimension[u.dimension] ??= []).push(u);
  }

  return (
    <select
      autoFocus
      value={currentUnitId ?? ""}
      onChange={async (e) => {
        if (e.target.value && e.target.value !== currentUnitId) {
          await onSave(e.target.value);
        }
        setEditing(false);
      }}
      onBlur={() => {
        // Kleine vertraging: op sommige browsers vuurt blur nét vóór
        // change, waardoor de keuze anders verloren zou gaan.
        setTimeout(() => setEditing(false), 200);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setEditing(false);
      }}
      className="h-8 rounded-md border border-teal bg-surface px-2 text-sm"
    >
      <option value="">Kies…</option>
      {Object.entries(byDimension).map(([dimension, list]) => (
        <optgroup key={dimension} label={dimension}>
          {list.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function InlineEditCell({
  value,
  placeholder,
  prefix,
  suffix,
  hint,
  type = "text",
  disabled,
  onSave,
}: {
  value: string | null;
  placeholder: string;
  prefix?: string;
  suffix?: string;
  hint?: string;
  type?: "text" | "number";
  disabled?: boolean;
  onSave: (value: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  if (disabled) {
    return <span className="text-muted">{value ?? placeholder}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value ?? "");
          setEditing(true);
        }}
        className="rounded px-1 py-0.5 text-left hover:bg-background hover:underline"
        title="Klik om te bewerken"
      >
        {value !== null && value !== "" ? (
          <>
            {prefix}
            {value}
            {suffix}
          </>
        ) : (
          <span className="text-muted">{placeholder}</span>
        )}
        {hint && <span className="ml-1 text-xs text-muted">({hint})</span>}
      </button>
    );
  }

  async function commit() {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setEditing(false);
  }

  return (
    <input
      autoFocus
      type={type}
      step={type === "number" ? "any" : undefined}
      value={draft}
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") setEditing(false);
      }}
      className="h-8 w-28 rounded-md border border-teal bg-surface px-2 text-sm"
    />
  );
}

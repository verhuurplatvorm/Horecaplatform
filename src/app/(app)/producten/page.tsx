"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Search, TriangleAlert, Trash2 } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";

interface ProductRow {
  id: string;
  name: string;
  base_unit: string;
  article_number: string | null;
  ean_code: string | null;
  is_active: boolean;
  pricePerBaseUnit: number | null;
  purchasePrice: number | null;
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
  const [confirming, setConfirming] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data: products, error: fetchError } = await supabase
        .from("products")
        .select("id, name, base_unit, article_number, ean_code, is_active")
        .order("name")
        .limit(200);

      if (cancelled) return;
      if (fetchError || !products) {
        setError(true);
        setLoading(false);
        return;
      }

      const productIds = products.map((p) => p.id);
      const { data: currentPrices } = productIds.length
        ? await supabase
            .from("supplier_products")
            .select(
              "product_id, purchase_price, packaging_unit_count, packaging_description, valid_from, suppliers(name)"
            )
            .in("product_id", productIds)
            .is("valid_to", null)
            .order("valid_from", { ascending: false })
        : { data: [] };

      const priceByProduct = new Map<
        string,
        {
          pricePerBaseUnit: number;
          purchasePrice: number;
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
        // @ts-expect-error -- suppliers komt als geneste relatie terug, niet in het handmatige Database-type
        const supplierName: string = row.suppliers?.name ?? "onbekende leverancier";
        priceByProduct.set(row.product_id, {
          pricePerBaseUnit,
          purchasePrice: row.purchase_price,
          packagingDescription: row.packaging_description,
          supplierName,
          validFrom: row.valid_from,
        });
      }

      if (!cancelled) {
        setRows(
          products.map((p) => {
            const price = priceByProduct.get(p.id);
            return {
              id: p.id,
              name: p.name,
              base_unit: p.base_unit,
              article_number: p.article_number,
              ean_code: p.ean_code,
              is_active: p.is_active,
              pricePerBaseUnit: price?.pricePerBaseUnit ?? null,
              purchasePrice: price?.purchasePrice ?? null,
              packagingDescription: price?.packagingDescription ?? null,
              supplierName: price?.supplierName ?? null,
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

  const q = query.trim().toLowerCase();
  const filteredRows = q
    ? rows.filter((r) =>
        [r.name, r.supplierName, r.article_number, r.ean_code]
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
          <Link href="/producten/nieuw">
            <Button>
              <Plus className="h-4 w-4" />
              Nieuw product
            </Button>
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <Link href="/producten/opschonen">
            <Button variant="secondary" size="sm">
              <TriangleAlert className="h-3.5 w-3.5" />
              Producten opschonen
            </Button>
          </Link>
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
                      {p.article_number && (
                        <p className="text-xs text-muted">Art.nr. {p.article_number}</p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted">{p.supplierName ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">{p.base_unit}</td>
                    <td className="px-5 py-3 text-muted">{p.packagingDescription ?? "—"}</td>
                    <td className="px-5 py-3 tabular">
                      {p.purchasePrice !== null ? `€ ${p.purchasePrice.toFixed(2)}` : "—"}
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
                  </tr>
                ))}
                {filteredRows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} className="px-5 py-6 text-center text-muted">
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

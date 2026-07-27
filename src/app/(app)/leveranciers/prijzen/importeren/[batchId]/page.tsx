"use client";

import { use, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Plus, Search, Trash2, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ProductForm } from "@/components/products/product-form";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { parsePackagingText, UNIT_TO_BASE_FACTOR } from "@/lib/price-import/packaging-parser";
import type {
  PriceImportBatch,
  PriceImportRow,
  Product,
} from "@/lib/types/database";

export default function ImportReviewPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = use(params);
  const [batch, setBatch] = useState<PriceImportBatch | null>(null);
  const [rows, setRows] = useState<PriceImportRow[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [existing, setExisting] = useState<
    Map<string, { price: number; packagingCount: number }>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [creatingForRow, setCreatingForRow] = useState<PriceImportRow | null>(
    null
  );
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const [{ data: batchData }, { data: rowsData }] = await Promise.all([
        supabase
          .from("price_import_batches")
          .select("*")
          .eq("id", batchId)
          .single(),
        supabase
          .from("price_import_rows")
          .select("*")
          .eq("batch_id", batchId)
          .order("row_number"),
      ]);
      if (cancelled) return;

      const batchRow = (batchData as PriceImportBatch) ?? null;
      setBatch(batchRow);
      const rowList = (rowsData as PriceImportRow[]) ?? [];
      setRows(rowList);

      const productIds = [
        ...new Set(
          [
            ...rowList.map((r) => r.matched_product_id),
            ...rowList.flatMap((r) => r.suggested_product_ids),
          ].filter(Boolean)
        ),
      ] as string[];

      if (productIds.length > 0) {
        const { data: productData } = await supabase
          .from("products")
          .select("*")
          .in("id", productIds);
        if (cancelled) return;
        setProducts(
          new Map(((productData as Product[]) ?? []).map((p) => [p.id, p]))
        );

        if (batchRow) {
          let existingQuery = supabase
            .from("supplier_products")
            .select("product_id, purchase_price, packaging_unit_count")
            .eq("supplier_id", batchRow.supplier_id)
            .is("valid_to", null)
            .in("product_id", productIds);
          existingQuery = batchRow.company_id
            ? existingQuery.eq("company_id", batchRow.company_id)
            : existingQuery.is("company_id", null);
          const { data: existingData } = await existingQuery;
          if (!cancelled) {
            setExisting(
              new Map(
                (existingData ?? []).map((e) => [
                  e.product_id,
                  { price: e.purchase_price, packagingCount: e.packaging_unit_count },
                ])
              )
            );
          }
        }
      } else {
        setProducts(new Map());
        setExisting(new Map());
      }
      setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [batchId, reloadToken]);

  function reload() {
    setReloadToken((t) => t + 1);
  }

  async function handleManualMatch(rowId: string, productId: string) {
    await fetch(`/api/price-imports/${batchId}/rows/${rowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
    reload();
  }

  async function handlePackagingChange(rowId: string, packagingUnitCount: number) {
    await fetch(`/api/price-imports/${batchId}/rows/${rowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packagingUnitCount }),
    });
    reload();
  }

  async function handleApply() {
    setApplying(true);
    setApplyResult(null);
    const res = await fetch(`/api/price-imports/${batchId}/apply`, {
      method: "POST",
    });
    const body = await res.json();
    setApplying(false);
    setApplyResult(
      body.failed > 0
        ? `${body.applied} prijzen doorgevoerd, ${body.failed} mislukt.`
        : `${body.applied} prijzen succesvol doorgevoerd.`
    );
    reload();
  }

  async function handleRollback() {
    if (
      !window.confirm(
        "Deze import ongedaan maken? De nieuw doorgevoerde prijzen worden verwijderd en de vorige prijzen worden hersteld."
      )
    ) {
      return;
    }
    setRollingBack(true);
    const supabase = createClient();
    await supabase.rpc("rollback_price_import_batch", { p_batch_id: batchId });
    setRollingBack(false);
    setApplyResult(null);
    reload();
  }

  async function handleBulkCreate() {
    const unmatched = rows.filter((r) => !r.matched_product_id && r.description);
    if (unmatched.length === 0) return;
    if (
      !window.confirm(
        `${unmatched.length} nieuwe producten aanmaken op basis van deze regels? Controleer daarna zelf steekproefsgewijs of de herkenning klopt.`
      )
    ) {
      return;
    }

    setBulkCreating(true);
    setBulkResult(null);
    const supabase = createClient();
    const groupId = await getCurrentGroupId(supabase);
    if (!groupId) {
      setBulkResult("Kan groep van gebruiker niet bepalen. Log opnieuw in.");
      setBulkCreating(false);
      return;
    }

    const { data: units } = await supabase.from("units").select("id, key");
    const unitIdByKey = new Map((units ?? []).map((u) => [u.key, u.id]));

    // Voorkom dubbele producten binnen dezelfde import: dezelfde
    // (genormaliseerde) naam hergebruikt hetzelfde nieuw aangemaakte product.
    const createdByName = new Map<string, string>();
    let created = 0;
    let linked = 0;
    let skipped = 0;

    for (const row of unmatched) {
      const key = (row.description ?? "").trim().toLowerCase();
      let productId = createdByName.get(key);

      if (!productId) {
        const parsedPackaging = row.packaging_description
          ? parsePackagingText(row.packaging_description)
          : null;
        const baseUnitKey = parsedPackaging
          ? UNIT_TO_BASE_FACTOR[parsedPackaging.unit]?.baseUnitKey ?? "stuk"
          : "stuk";
        const baseUnitId = unitIdByKey.get(baseUnitKey) ?? unitIdByKey.get("stuk");
        if (!baseUnitId) {
          skipped++;
          continue;
        }

        const { data: newProduct, error: productError } = await supabase
          .from("products")
          .insert({
            group_id: groupId,
            name: row.description as string,
            article_number: row.article_number,
            ean_code: row.ean_code,
            brand: row.brand,
            base_unit_id: baseUnitId,
            kind: "inkoopartikel" as const,
          })
          .select("id")
          .single();

        if (productError || !newProduct) {
          skipped++;
          continue;
        }
        productId = newProduct.id;
        created++;

        if (row.packaging_description && row.packaging_unit_count) {
          await supabase.from("product_packagings").insert({
            product_id: productId,
            name: row.packaging_description,
            quantity_in_base_unit: row.packaging_unit_count,
            is_default: true,
          });
        }
        createdByName.set(key, productId);
      }

      const { error: patchError } = await supabase
        .from("price_import_rows")
        .update({
          matched_product_id: productId,
          match_method: "handmatig" as const,
          status: "gematcht" as const,
        })
        .eq("id", row.id);
      if (!patchError) linked++;
    }

    setBulkCreating(false);
    setBulkResult(
      `${created} nieuwe producten aangemaakt, ${linked} regels gekoppeld` +
        (skipped > 0 ? `, ${skipped} overgeslagen (geen naam/eenheid herkend).` : ".")
    );
    reload();
  }

  async function handleDeleteRow(rowId: string) {
    if (
      !window.confirm(
        "Deze regel verwijderen uit de import? Wordt niet als product of prijs verwerkt."
      )
    ) {
      return;
    }
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("price_import_rows")
      .delete()
      .eq("id", rowId);
    if (!deleteError) {
      setRows((prev) => prev.filter((r) => r.id !== rowId));
    }
  }

  if (loading) {
    return (
      <>
        <Topbar title="Prijslijst controleren" />
        <main className="p-6 text-sm text-muted">Laden…</main>
      </>
    );
  }

  if (!batch) {
    return (
      <>
        <Topbar title="Prijslijst controleren" />
        <main className="p-6 text-sm text-muted">Import niet gevonden.</main>
      </>
    );
  }

  const unmatchedCount = rows.filter((r) => !r.matched_product_id).length;
  const applyableCount = rows.filter(
    (r) =>
      r.matched_product_id &&
      r.packaging_unit_count &&
      r.status !== "toegepast"
  ).length;
  const missingPackagingCount = rows.filter(
    (r) => r.matched_product_id && !r.packaging_unit_count
  ).length;

  const displayRows = onlyChanges
    ? rows.filter((r) => {
        if (!r.matched_product_id) return true; // niet-gematcht altijd tonen
        const prev = existing.get(r.matched_product_id);
        if (!prev) return true; // nieuw artikel voor deze leverancier
        return prev.price !== r.purchase_price;
      })
    : rows;

  return (
    <>
      <Topbar title="Prijslijst controleren" />
      <main className="p-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>
              {batch.original_filename ?? "Import"} — {rows.length} regels
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm text-muted">
              {rows.length - unmatchedCount} automatisch gematcht,{" "}
              {unmatchedCount} nog te koppelen. Status:{" "}
              <span className="font-medium text-foreground">
                {batch.status.replace(/_/g, " ")}
              </span>
            </p>
            <div className="flex gap-2">
              {batch.status === "toegepast" && (
                <Button
                  variant="secondary"
                  onClick={handleRollback}
                  disabled={rollingBack}
                >
                  {rollingBack ? "Bezig…" : "Import ongedaan maken"}
                </Button>
              )}
              {unmatchedCount > 0 && (
                <Button
                  variant="secondary"
                  onClick={handleBulkCreate}
                  disabled={bulkCreating}
                >
                  {bulkCreating
                    ? "Bezig…"
                    : `${unmatchedCount} niet-gekoppelde regels als nieuwe producten aanmaken`}
                </Button>
              )}
              <Button
                onClick={handleApply}
                disabled={applying || applyableCount === 0}
              >
                {applying
                  ? "Bezig…"
                  : `${applyableCount} prijzen doorvoeren`}
              </Button>
            </div>
          </CardContent>
          {applyResult && (
            <CardContent className="pt-0 text-sm text-success">
              {applyResult}
            </CardContent>
          )}
          {bulkResult && (
            <CardContent className="pt-0 text-sm text-success">
              {bulkResult}
            </CardContent>
          )}
          {missingPackagingCount > 0 && (
            <CardContent className="flex items-center gap-1 pt-0 text-sm text-copper">
              <TriangleAlert className="h-4 w-4" />
              {missingPackagingCount} regel(s) hebben een gekoppeld product maar
              missen een verpakkingshoeveelheid — vul deze in voordat je ze
              doorvoert, anders wordt de prijs verkeerd geïnterpreteerd.
            </CardContent>
          )}
          <CardContent className="pt-0">
            <label className="flex items-center gap-1.5 text-sm text-muted">
              <input
                type="checkbox"
                checked={onlyChanges}
                onChange={(e) => setOnlyChanges(e.target.checked)}
              />
              Toon alleen wijzigingen ({displayRows.length} van {rows.length})
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Regel</th>
                  <th className="px-5 py-3 font-medium">Bron: omschrijving</th>
                  <th className="px-5 py-3 font-medium">Merk</th>
                  <th className="px-5 py-3 font-medium">EAN / artikelnr.</th>
                  <th className="px-5 py-3 font-medium">Prijs</th>
                  <th className="px-5 py-3 font-medium">Verpakking</th>
                  <th className="px-5 py-3 font-medium">Aantal</th>
                  <th className="px-5 py-3 font-medium">Inhoud per stuk</th>
                  <th className="px-5 py-3 font-medium">Gekoppeld product</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => (
                  <RowLine
                    key={row.id}
                    row={row}
                    product={
                      row.matched_product_id
                        ? products.get(row.matched_product_id)
                        : undefined
                    }
                    suggestedProducts={row.suggested_product_ids
                      .map((id) => products.get(id))
                      .filter(Boolean) as Product[]}
                    existingPrice={
                      row.matched_product_id
                        ? existing.get(row.matched_product_id)
                        : undefined
                    }
                    onManualMatch={(productId) =>
                      handleManualMatch(row.id, productId)
                    }
                    onPackagingChange={(count) =>
                      handlePackagingChange(row.id, count)
                    }
                    onStartCreate={() => setCreatingForRow(row)}
                    onDelete={() => handleDeleteRow(row.id)}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {creatingForRow && (
          <Modal
            title="Nieuw product aanmaken"
            onClose={() => setCreatingForRow(null)}
          >
            <ProductForm
              mode="dialog"
              prefillName={creatingForRow.description ?? ""}
              prefillEanCode={creatingForRow.ean_code ?? ""}
              prefillArticleNumber={creatingForRow.article_number ?? ""}
              prefillPackagingName={creatingForRow.packaging_description ?? ""}
              prefillBrand={creatingForRow.brand ?? ""}
              onSaved={(newProduct) => {
                const rowId = creatingForRow.id;
                setCreatingForRow(null);
                handleManualMatch(rowId, newProduct.id);
              }}
              onCancel={() => setCreatingForRow(null)}
            />
          </Modal>
        )}
      </main>
    </>
  );
}

function RowLine({
  row,
  product,
  suggestedProducts,
  existingPrice,
  onManualMatch,
  onPackagingChange,
  onStartCreate,
  onDelete,
}: {
  row: PriceImportRow;
  product?: Product;
  suggestedProducts: Product[];
  existingPrice?: { price: number; packagingCount: number };
  onManualMatch: (productId: string) => void;
  onPackagingChange: (count: number) => void;
  onStartCreate: () => void;
  onDelete: () => void;
}) {
  const [searching, setSearching] = useState(false);
  const [packagingInput, setPackagingInput] = useState(
    row.packaging_unit_count?.toString() ?? ""
  );

  const priceDiff =
    existingPrice && row.purchase_price !== null
      ? row.purchase_price - existingPrice.price
      : null;
  const packagingChanged =
    existingPrice &&
    row.packaging_unit_count !== null &&
    existingPrice.packagingCount !== row.packaging_unit_count;
  const packagingBreakdown = row.packaging_description
    ? parsePackagingText(row.packaging_description)
    : null;

  return (
    <tr className="border-t border-border">
      <td className="px-5 py-3 text-muted tabular">{row.row_number}</td>
      <td className="px-5 py-3">{row.description ?? "—"}</td>
      <td className="px-5 py-3 text-muted">{row.brand ?? "—"}</td>
      <td className="px-5 py-3 text-muted">
        {row.ean_code ?? row.article_number ?? "—"}
      </td>
      <td className="px-5 py-3 tabular">
        {row.purchase_price !== null ? `€ ${row.purchase_price.toFixed(2)}` : "—"}
        {priceDiff !== null && priceDiff !== 0 && (
          <p
            className={`text-xs ${priceDiff > 0 ? "text-danger" : "text-success"}`}
          >
            {priceDiff > 0 ? "+" : ""}
            {priceDiff.toFixed(2)} t.o.v. € {existingPrice!.price.toFixed(2)}
          </p>
        )}
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center gap-1">
          <input
            type="number"
            step="any"
            value={packagingInput}
            onChange={(e) => setPackagingInput(e.target.value)}
            onBlur={() => {
              const n = Number(packagingInput);
              if (Number.isFinite(n) && n > 0 && n !== row.packaging_unit_count) {
                onPackagingChange(n);
              }
            }}
            placeholder="in basiseenheid"
            className="h-8 w-28 rounded-md border border-border bg-surface px-2 text-xs"
          />
        </div>
        {row.packaging_description && (
          <p className="mt-0.5 text-xs text-muted">{row.packaging_description}</p>
        )}
        {!row.packaging_unit_count && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-copper">
            <TriangleAlert className="h-3 w-3" />
            Verplicht vóór toepassen
          </p>
        )}
        {packagingChanged && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-copper">
            <TriangleAlert className="h-3 w-3" />
            Verpakking gewijzigd (was {existingPrice!.packagingCount}) — controleer
            de prijs per basiseenheid.
          </p>
        )}
      </td>
      <td className="px-5 py-3 tabular text-muted">
        {packagingBreakdown ? packagingBreakdown.count : "—"}
      </td>
      <td className="px-5 py-3 tabular text-muted">
        {packagingBreakdown
          ? `${packagingBreakdown.unitQuantity} ${packagingBreakdown.unit}`
          : "—"}
      </td>
      <td className="px-5 py-3">
        {row.matched_product_id ? (
          <span className="text-foreground">
            {product?.name ?? row.matched_product_id}
          </span>
        ) : searching ? (
          <ProductPicker onPick={onManualMatch} />
        ) : (
          <div className="flex flex-col items-start gap-1">
            {suggestedProducts.length > 0 && (
              <div className="space-y-0.5">
                {suggestedProducts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onManualMatch(p.id)}
                    className="block text-xs text-teal hover:underline"
                  >
                    → {p.name}?
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={onStartCreate}
              className="flex items-center gap-1 text-xs text-teal hover:underline"
            >
              <Plus className="h-3.5 w-3.5" />
              Nieuw product aanmaken
            </button>
            <button
              onClick={() => setSearching(true)}
              className="flex items-center gap-1 text-xs text-muted hover:underline"
            >
              <Search className="h-3.5 w-3.5" />
              Bestaand product koppelen
            </button>
          </div>
        )}
      </td>
      <td className="px-5 py-3">
        {row.status === "toegepast" ? (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Toegepast
          </span>
        ) : row.matched_product_id ? (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Gekoppeld{row.match_method === "handmatig" ? " (handmatig)" : ""}
          </span>
        ) : (
          <ConfidenceBadge confidence={row.match_confidence} />
        )}
      </td>
      <td className="px-5 py-3">
        {row.status !== "toegepast" && (
          <button
            onClick={onDelete}
            title="Regel verwijderen uit de import"
            className="text-muted hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </td>
    </tr>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  if (confidence === "mogelijk_dubbel") {
    return (
      <span className="flex items-center gap-1 text-xs text-copper">
        <TriangleAlert className="h-3.5 w-3.5" />
        Mogelijk dubbel
      </span>
    );
  }
  if (confidence === "waarschijnlijk") {
    return (
      <span className="flex items-center gap-1 text-xs text-copper">
        <CircleAlert className="h-3.5 w-3.5" />
        Waarschijnlijk gekoppeld — controleer
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-muted">
      <CircleAlert className="h-3.5 w-3.5" />
      Nieuw artikel
    </span>
  );
}

function ProductPicker({ onPick }: { onPick: (productId: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) return;

    let cancelled = false;
    const supabase = createClient();
    const timeout = setTimeout(async () => {
      const { data } = await supabase
        .from("products")
        .select("*")
        .ilike("name", `%${query}%`)
        .limit(8);
      if (!cancelled) setResults((data as Product[]) ?? []);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  const visibleResults = query.trim().length < 2 ? [] : results;

  return (
    <div className="relative w-56">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Zoek product op naam…"
        className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs"
      />
      {visibleResults.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-lg">
          {visibleResults.map((p) => (
            <button
              key={p.id}
              onClick={() => onPick(p.id)}
              className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-background"
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

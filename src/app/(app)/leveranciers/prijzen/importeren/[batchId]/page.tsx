"use client";

import { use, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Plus, Search } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ProductForm } from "@/components/products/product-form";
import { createClient } from "@/lib/supabase/client";
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
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);
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

      setBatch((batchData as PriceImportBatch) ?? null);
      const rowList = (rowsData as PriceImportRow[]) ?? [];
      setRows(rowList);

      const productIds = [
        ...new Set(rowList.map((r) => r.matched_product_id).filter(Boolean)),
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
      } else {
        setProducts(new Map());
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
    (r) => r.matched_product_id && r.status !== "toegepast"
  ).length;

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
            <Button
              onClick={handleApply}
              disabled={applying || applyableCount === 0}
            >
              {applying
                ? "Bezig…"
                : `${applyableCount} prijzen doorvoeren`}
            </Button>
          </CardContent>
          {applyResult && (
            <CardContent className="pt-0 text-sm text-success">
              {applyResult}
            </CardContent>
          )}
        </Card>

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Regel</th>
                  <th className="px-5 py-3 font-medium">Bron: omschrijving</th>
                  <th className="px-5 py-3 font-medium">EAN / artikelnr.</th>
                  <th className="px-5 py-3 font-medium">Prijs</th>
                  <th className="px-5 py-3 font-medium">Gekoppeld product</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <RowLine
                    key={row.id}
                    row={row}
                    product={
                      row.matched_product_id
                        ? products.get(row.matched_product_id)
                        : undefined
                    }
                    onManualMatch={(productId) =>
                      handleManualMatch(row.id, productId)
                    }
                    onStartCreate={() => setCreatingForRow(row)}
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
  onManualMatch,
  onStartCreate,
}: {
  row: PriceImportRow;
  product?: Product;
  onManualMatch: (productId: string) => void;
  onStartCreate: () => void;
}) {
  const [searching, setSearching] = useState(false);

  return (
    <tr className="border-t border-border">
      <td className="px-5 py-3 text-muted tabular">{row.row_number}</td>
      <td className="px-5 py-3">{row.description ?? "—"}</td>
      <td className="px-5 py-3 text-muted">
        {row.ean_code ?? row.article_number ?? "—"}
      </td>
      <td className="px-5 py-3 tabular">
        {row.purchase_price !== null ? `€ ${row.purchase_price.toFixed(2)}` : "—"}
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
            Gematcht{row.match_method === "handmatig" ? " (handmatig)" : ""}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-copper">
            <CircleAlert className="h-3.5 w-3.5" />
            Niet gematcht
          </span>
        )}
      </td>
    </tr>
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

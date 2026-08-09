"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Plus, Search, Trash2, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ProductForm } from "@/components/products/product-form";
import { cn } from "@/lib/utils";
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
  const router = useRouter();
  const [batch, setBatch] = useState<PriceImportBatch | null>(null);
  const [rows, setRows] = useState<PriceImportRow[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [existing, setExisting] = useState<
    Map<string, { price: number; packagingCount: number }>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [applyReport, setApplyReport] = useState<{
    priceChanges: {
      productName: string;
      oldPrice: number | null;
      newPrice: number | null;
      validFrom: string | null;
    }[];
    newProducts: string[];
    unchanged: string[];
  } | null>(null);
  const [view, setView] = useState<"all" | "changes" | "missing">("changes");
  const [autoFocusedMissing, setAutoFocusedMissing] = useState(false);
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
      if (!autoFocusedMissing) {
        const hasMissing = rowList.some((r) => r.matched_product_id && !r.packaging_unit_count);
        if (hasMissing) setView("missing");
        setAutoFocusedMissing(true);
      }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, reloadToken]);

  function reload() {
    setReloadToken((t) => t + 1);
  }

  async function handleManualMatch(rowId: string, productId: string) {
    const res = await fetch(`/api/price-imports/${batchId}/rows/${rowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      window.alert(body?.error ?? "Koppelen mislukt.");
      return;
    }
    reload();
  }

  async function handlePackagingChange(rowId: string, packagingUnitCount: number) {
    const res = await fetch(`/api/price-imports/${batchId}/rows/${rowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packagingUnitCount }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      window.alert(body?.error ?? "Bijwerken van de verpakkingshoeveelheid mislukt.");
      return;
    }
    reload();
  }

  async function handleApply() {
    setApplying(true);
    setApplyResult(null);
    setApplyReport(null);
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
    setApplyReport({
      priceChanges: body.priceChanges ?? [],
      newProducts: body.newProducts ?? [],
      unchanged: body.unchanged ?? [],
    });
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

  async function handleDeleteBatch() {
    if (
      !window.confirm(
        `Deze factuur/import definitief verwijderen? Alle regels verdwijnen mee. Al doorgevoerde prijzen op producten blijven gewoon staan — alleen de importgeschiedenis zelf verdwijnt. Dit kan niet ongedaan worden gemaakt.`
      )
    ) {
      return;
    }
    setDeletingBatch(true);
    const supabase = createClient();
    const { error, data } = await supabase
      .from("price_import_batches")
      .delete()
      .eq("id", batchId)
      .select("id");
    setDeletingBatch(false);

    if (error) {
      window.alert("Verwijderen mislukt: " + error.message);
      return;
    }
    if (!data || data.length === 0) {
      window.alert(
        "Verwijderen is niet gelukt — je hebt hier mogelijk geen rechten voor (groepsbrede facturen kunnen alleen door een groepsbeheerder verwijderd worden)."
      );
      return;
    }
    router.push(batch?.source_kind === "factuur" ? "/leveranciers/facturen" : "/leveranciers");
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
    const { error: deleteError, data } = await supabase
      .from("price_import_rows")
      .delete()
      .eq("id", rowId)
      .select("id");
    if (deleteError) {
      window.alert("Verwijderen mislukt: " + deleteError.message);
      return;
    }
    if (!data || data.length === 0) {
      window.alert(
        "Verwijderen is niet gelukt — je hebt hier mogelijk geen rechten voor (groepsbrede facturen kunnen alleen door een groepsbeheerder bewerkt worden)."
      );
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== rowId));
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
  const missingPackagingCount = rows.filter(
    (r) => r.matched_product_id && !r.packaging_unit_count
  ).length;
  const applyableCount = rows.filter(
    (r) =>
      r.matched_product_id &&
      r.packaging_unit_count &&
      r.status !== "toegepast" &&
      // "ongewijzigd" = prijs is identiek aan de al actieve prijs; die
      // regels slaat het doorvoeren bewust over en horen dus ook niet in
      // de knoptekst meegeteld te worden.
      r.status !== "ongewijzigd"
  ).length;

  const displayRows =
    view === "missing"
      ? rows.filter((r) => r.matched_product_id && !r.packaging_unit_count)
      : view === "changes"
      ? rows.filter((r) => {
          if (!r.matched_product_id) return true; // niet-gematcht altijd tonen
          const prev = existing.get(r.matched_product_id);
          if (!prev) return true; // nieuw artikel voor deze leverancier
          return prev.price !== r.purchase_price;
        })
      : rows;

  return (
    <>
      <Topbar title={batch.source_kind === "factuur" ? "Factuur controleren" : "Prijslijst controleren"} />
      <main className="p-6 space-y-4">
        {batch.source_kind === "factuur" && (
          <Card>
            <CardContent className="grid grid-cols-2 gap-2 py-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Factuurnummer</p>
                <p className="font-medium">{batch.invoice_number ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Factuurdatum</p>
                <p className="font-medium">
                  {batch.invoice_date ? new Date(batch.invoice_date).toLocaleDateString("nl-NL") : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Vervaldatum</p>
                <p className="font-medium">
                  {batch.due_date ? new Date(batch.due_date).toLocaleDateString("nl-NL") : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Totaal incl. btw</p>
                <p className="font-medium">
                  {batch.total_incl_vat !== null ? `€ ${batch.total_incl_vat.toFixed(2)}` : "—"}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {batch.source_kind === "factuur" && batch.supplier_id && (
          <SupplierInvoiceNotes supplierId={batch.supplier_id} />
        )}
        <Card>
          <CardHeader>
            <CardTitle>
              {batch.original_filename ?? "Import"} — {rows.length} regels
            </CardTitle>
          </CardHeader>
          {batch.error_message && (
            <CardContent className="flex items-start gap-2 pt-0 text-sm text-copper">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{batch.error_message}</span>
            </CardContent>
          )}
          <CardContent className="flex items-center justify-between pb-0">
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
                disabled={applying || applyableCount === 0 || missingPackagingCount > 0}
                title={
                  missingPackagingCount > 0
                    ? "Vul eerst alle ontbrekende verpakkingshoeveelheden in"
                    : undefined
                }
              >
                {applying
                  ? "Bezig…"
                  : `${applyableCount} prijzen doorvoeren`}
              </Button>
              <Button variant="danger" onClick={handleDeleteBatch} disabled={deletingBatch}>
                <Trash2 className="h-4 w-4" />
                {deletingBatch ? "Bezig…" : "Factuur verwijderen"}
              </Button>
            </div>
          </CardContent>
          <CardContent className="pt-0">
            <p className="text-xs text-muted">
              Dit scherm gaat uitsluitend om de inkoopprijs per basiseenheid (stuk,
              kilo, liter) — bestel- of voorraadhoeveelheden worden niet
              geïmporteerd of bewaard.
            </p>
          </CardContent>
          {applyResult && (
            <CardContent className="pt-0 text-sm text-success">
              {applyResult}
            </CardContent>
          )}
          {applyReport && (
            <CardContent className="pt-0 text-sm">
              {applyReport.priceChanges.filter((c) => c.oldPrice !== null).length > 0 && (
                <div className="mb-4">
                  <p className="mb-2 font-medium text-foreground">
                    Gewijzigde prijzen (
                    {applyReport.priceChanges.filter((c) => c.oldPrice !== null).length})
                  </p>
                  <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="sticky top-0 bg-surface text-left text-muted">
                          <th className="px-3 py-2 font-medium">Product</th>
                          <th className="px-3 py-2 font-medium">Oude prijs</th>
                          <th className="px-3 py-2 font-medium">Nieuwe prijs</th>
                          <th className="px-3 py-2 font-medium">Ingangsdatum</th>
                        </tr>
                      </thead>
                      <tbody>
                        {applyReport.priceChanges
                          .filter((c) => c.oldPrice !== null)
                          .map((c, i) => (
                            <tr key={i} className="border-t border-border">
                              <td className="px-3 py-1.5">{c.productName}</td>
                              <td className="px-3 py-1.5 tabular text-muted">
                                {c.oldPrice !== null ? `€ ${c.oldPrice.toFixed(2)}` : "—"}
                              </td>
                              <td
                                className={
                                  "px-3 py-1.5 tabular " +
                                  (c.oldPrice !== null &&
                                  c.newPrice !== null &&
                                  c.newPrice > c.oldPrice
                                    ? "text-danger"
                                    : "text-success")
                                }
                              >
                                {c.newPrice !== null ? `€ ${c.newPrice.toFixed(2)}` : "—"}
                              </td>
                              <td className="px-3 py-1.5 text-muted">
                                {c.validFrom
                                  ? new Date(c.validFrom).toLocaleDateString("nl-NL")
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {applyReport.priceChanges.filter((c) => c.oldPrice === null).length > 0 && (
                <div className="mb-4">
                  <p className="mb-1 font-medium text-foreground">
                    Eerste prijs vastgelegd (
                    {applyReport.priceChanges.filter((c) => c.oldPrice === null).length})
                  </p>
                  <p className="text-xs text-muted">
                    Voor deze producten was er nog geen prijs van deze leverancier — geen
                    wijziging, maar een eerste vastlegging.
                  </p>
                </div>
              )}
              {applyReport.newProducts.length > 0 && (
                <div className="mb-4">
                  <p className="mb-1 font-medium text-copper">
                    Nieuw aangemaakte producten ({applyReport.newProducts.length})
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded-md border border-border px-3 py-2 text-xs">
                    {applyReport.newProducts.map((name, i) => (
                      <p key={i}>{name}</p>
                    ))}
                  </div>
                </div>
              )}
              {applyReport.unchanged.length > 0 && (
                <details className="mb-2">
                  <summary className="cursor-pointer font-medium text-muted">
                    Geen wijziging nodig ({applyReport.unchanged.length} producten)
                  </summary>
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-border px-3 py-2 text-xs text-muted">
                    {applyReport.unchanged.map((name, i) => (
                      <p key={i}>{name}</p>
                    ))}
                  </div>
                </details>
              )}
            </CardContent>
          )}
          {bulkResult && (
            <CardContent className="pt-0 text-sm text-success">
              {bulkResult}
            </CardContent>
          )}
          {missingPackagingCount > 0 && (
            <CardContent className="pt-0">
              <button
                onClick={() => {
                  setView("missing");
                  // Als de weergave al actief is, scroll naar de tabel —
                  // anders lijkt de knop niets te doen.
                  document
                    .getElementById("prijsregels-tabel")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="flex w-full items-center gap-1 rounded-md bg-copper/10 p-2 text-left text-sm text-copper hover:bg-copper/20"
              >
                <TriangleAlert className="h-4 w-4 shrink-0" />
                {missingPackagingCount} regel(s) hebben een gekoppeld product maar
                missen een verpakkingshoeveelheid — vul deze eerst in, anders wordt
                de prijs verkeerd geïnterpreteerd en kan er niet doorgevoerd worden.
                <span className="ml-auto shrink-0 underline">
                  {view === "missing"
                    ? "Deze regels staan hieronder ↓"
                    : "Bekijk deze regels →"}
                </span>
              </button>
            </CardContent>
          )}
          <CardContent className="flex flex-wrap items-center gap-2 pt-0 text-sm">
            <button
              onClick={() => setView("all")}
              className={cn(
                "rounded-full px-3 py-1",
                view === "all" ? "bg-teal text-white" : "bg-background text-muted hover:text-foreground"
              )}
            >
              Alle regels ({rows.length})
            </button>
            <button
              onClick={() => setView("changes")}
              className={cn(
                "rounded-full px-3 py-1",
                view === "changes" ? "bg-teal text-white" : "bg-background text-muted hover:text-foreground"
              )}
            >
              Wijzigingen
            </button>
            {missingPackagingCount > 0 && (
              <button
                onClick={() => setView("missing")}
                className={cn(
                  "rounded-full px-3 py-1",
                  view === "missing"
                    ? "bg-copper text-white"
                    : "bg-copper/10 text-copper hover:bg-copper/20"
                )}
              >
                Ontbrekende verpakking ({missingPackagingCount})
              </button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <table id="prijsregels-tabel" className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Regel</th>
                  <th className="px-5 py-3 font-medium">Bron: omschrijving</th>
                  <th className="px-5 py-3 font-medium">Merk</th>
                  <th className="px-5 py-3 font-medium">EAN / artikelnr.</th>
                  <th className="px-5 py-3 font-medium">Prijs (inkoop)</th>
                  <th className="px-5 py-3 font-medium">Verpakking</th>
                  <th className="px-5 py-3 font-medium">Stuks in verpakking</th>
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
            Gekoppeld
            {row.match_method === "handmatig" && " (handmatig)"}
            {row.match_method === "automatisch_aangemaakt" && " (nieuw product aangemaakt)"}
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

function SupplierInvoiceNotes({ supplierId }: { supplierId: string }) {
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("supplier_invoice_templates")
      .select("field_notes")
      .eq("supplier_id", supplierId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setNotes(data?.field_notes ?? "");
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  async function handleSave() {
    setSaving(true);
    const supabase = createClient();
    await supabase.from("supplier_invoice_templates").upsert({
      supplier_id: supplierId,
      field_notes: notes,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    setEditing(false);
  }

  if (!loaded) return null;

  return (
    <Card>
      <CardContent className="space-y-2 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Aanwijzingen voor deze leverancier
        </p>
        {editing ? (
          <>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Bv. 'Kolom Aantal: een S erachter betekent stuks, een kaal getal betekent kilo.' Deze tekst wordt bij een volgende factuur van deze leverancier automatisch meegegeven aan het uitlezen."
              className="w-full rounded-md border border-border bg-surface p-2 text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Opslaan…" : "Opslaan"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                Annuleren
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-muted">
              {notes.trim() || "Nog geen aanwijzingen vastgelegd — wordt gebruikt om het uitlezen van toekomstige facturen van deze leverancier te verbeteren."}
            </p>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Bewerken
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

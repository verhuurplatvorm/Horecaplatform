"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { InboundInvoiceQueueItem, Supplier } from "@/lib/types/database";
import type { ParsedInvoiceHeader } from "@/lib/invoice-import/parse-ubl";

const EMPTY_HEADER: ParsedInvoiceHeader = {
  invoiceNumber: null,
  invoiceDate: null,
  dueDate: null,
  supplierName: null,
  supplierVatNumber: null,
  supplierKvkNumber: null,
  supplierIban: null,
  currency: null,
  subtotalExclVat: null,
  totalInclVat: null,
};

export default function PostvakInDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: itemId } = use(params);
  const router = useRouter();

  const [item, setItem] = useState<InboundInvoiceQueueItem | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [confirmIban, setConfirmIban] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const [{ data: i }, { data: s }] = await Promise.all([
        supabase.from("inbound_invoice_queue").select("*").eq("id", itemId).single(),
        supabase.from("suppliers").select("*").order("name"),
      ]);
      if (cancelled) return;
      setItem(i as InboundInvoiceQueueItem);
      setSuppliers((s as Supplier[]) ?? []);
      const candidates = (i?.supplier_candidates as { supplier_id: string }[] | null) ?? [];
      if (candidates.length === 1) setSelectedSupplierId(candidates[0].supplier_id);
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  async function handleProcess() {
    if (!item) return;
    setSubmitting(true);
    setError(null);

    const header: ParsedInvoiceHeader = item.parsed_header ?? EMPTY_HEADER;
    const lines = item.parsed_lines ?? [];

    const res = await fetch("/api/invoices/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        header,
        lines,
        storagePath: item.storage_path,
        companyId: item.company_id,
        originalFilename: item.original_filename,
        supplierId: selectedSupplierId || undefined,
        newSupplierName: !selectedSupplierId ? newSupplierName : undefined,
        confirmIbanMismatch: confirmIban,
      }),
    });
    const body = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(body.error ?? "Verwerken mislukt.");
      return;
    }

    const supabase = createClient();
    await supabase
      .from("inbound_invoice_queue")
      .update({ status: "verwerkt", resulting_batch_id: body.batchId })
      .eq("id", item.id);

    router.push(`/leveranciers/prijzen/importeren/${body.batchId}`);
  }

  async function handleReject() {
    if (!item) return;
    if (!window.confirm("Deze e-mailfactuur afwijzen? Wordt niet verwerkt.")) return;
    const supabase = createClient();
    await supabase.from("inbound_invoice_queue").update({ status: "afgewezen" }).eq("id", item.id);
    router.push("/leveranciers/facturen/postvak-in");
  }

  if (loading || !item) {
    return (
      <>
        <Topbar title="Factuur verwerken" />
        <main className="p-6 text-sm text-muted">Laden…</main>
      </>
    );
  }

  const hasIbanMismatch = (item.supplier_candidates as { iban_mismatch?: boolean }[] | null)?.some(
    (c) => c.iban_mismatch
  );

  return (
    <>
      <Topbar title={`Factuur verwerken — ${item.original_filename}`} />
      <main className="max-w-xl p-6 space-y-4">
        {item.parsed_header && (
          <Card>
            <CardHeader>
              <CardTitle>Herkende gegevens</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <p>
                <span className="text-muted">Leverancier op factuur:</span>{" "}
                {item.parsed_header.supplierName ?? "onbekend"}
              </p>
              <p>
                <span className="text-muted">Factuurnummer:</span>{" "}
                {item.parsed_header.invoiceNumber ?? "—"}
              </p>
              <p>
                <span className="text-muted">Regels:</span> {(item.parsed_lines ?? []).length}
              </p>
              <p>
                <span className="text-muted">Totaal incl. btw:</span>{" "}
                {item.parsed_header.totalInclVat ? `€ ${item.parsed_header.totalInclVat}` : "—"}
              </p>
            </CardContent>
          </Card>
        )}

        {hasIbanMismatch && (
          <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Het IBAN op deze factuur wijkt af van het bekende IBAN van de leverancier.
              Controleer dit telefonisch bij de leverancier zelf voordat je verder gaat.
            </span>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Leverancier</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <select
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value)}
              className="input"
            >
              <option value="">Nieuwe leverancier aanmaken…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {!selectedSupplierId && (
              <input
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder={item.parsed_header?.supplierName ?? "Naam nieuwe leverancier"}
                className="input"
              />
            )}
            {hasIbanMismatch && (
              <label className="flex items-center gap-2 text-sm text-danger">
                <input
                  type="checkbox"
                  checked={confirmIban}
                  onChange={(e) => setConfirmIban(e.target.checked)}
                />
                Ik heb het nieuwe IBAN geverifieerd bij de leverancier
              </label>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button
                onClick={handleProcess}
                disabled={
                  submitting ||
                  (!selectedSupplierId && !newSupplierName.trim()) ||
                  (Boolean(hasIbanMismatch) && !confirmIban)
                }
              >
                {submitting ? "Bezig…" : "Verwerken"}
              </Button>
              <Button variant="secondary" onClick={handleReject}>
                Afwijzen
              </Button>
            </div>
          </CardContent>
        </Card>

        <style jsx>{`
          .input {
            display: block;
            width: 100%;
            height: 2.5rem;
            border-radius: 0.375rem;
            border: 1px solid var(--border);
            background: var(--surface);
            padding: 0 0.75rem;
            font-size: 0.875rem;
          }
        `}</style>
      </main>
    </>
  );
}

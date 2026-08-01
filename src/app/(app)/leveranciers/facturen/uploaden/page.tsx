"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import type { Supplier } from "@/lib/types/database";
import type { ParsedInvoiceHeader, ParsedInvoiceLine } from "@/lib/invoice-import/parse-ubl";

interface SupplierCandidate {
  supplier_id: string;
  supplier_name: string;
  match_method: string;
  iban_mismatch: boolean;
}

type Step =
  | { kind: "upload" }
  | {
      kind: "confirmSupplier";
      header: ParsedInvoiceHeader;
      lines: ParsedInvoiceLine[];
      candidates: SupplierCandidate[];
      storagePath: string;
    }
  | {
      kind: "confirmIban";
      header: ParsedInvoiceHeader;
      lines: ParsedInvoiceLine[];
      supplierId: string;
      supplierName: string;
      storagePath: string;
    }
  | { kind: "needsManualSupplier"; storagePath: string };

export default function FactuurUploadenPage() {
  const router = useRouter();
  const { companies } = useCompanyScope();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>({ kind: "upload" });
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("suppliers")
      .select("*")
      .order("name")
      .then(({ data }) => setSuppliers((data as Supplier[]) ?? []));
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    if (companyId) formData.append("companyId", companyId);
    if (step.kind === "needsManualSupplier" && selectedSupplierId) {
      formData.append("supplierId", selectedSupplierId);
    }

    const res = await fetch("/api/invoices/upload", { method: "POST", body: formData });
    const body = await res.json();
    setSubmitting(false);

    if (body.needsManualEntry) {
      setStep({ kind: "needsManualSupplier", storagePath: body.storagePath });
      return;
    }
    if (!res.ok) {
      setError(body.error ?? "Uploaden mislukt.");
      return;
    }
    if (body.needsSupplier) {
      setStep({
        kind: "confirmSupplier",
        header: body.header,
        lines: body.lines,
        candidates: body.candidates,
        storagePath: body.storagePath,
      });
      return;
    }
    if (body.needsIbanConfirmation) {
      setStep({
        kind: "confirmIban",
        header: body.header,
        lines: body.lines,
        supplierId: body.supplierId,
        supplierName: body.supplierName,
        storagePath: body.storagePath,
      });
      return;
    }
    router.push(`/leveranciers/prijzen/importeren/${body.batchId}`);
  }

  async function handleConfirmSupplierAndFinalize(step: Extract<Step, { kind: "confirmSupplier" }>) {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/invoices/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        header: step.header,
        lines: step.lines,
        storagePath: step.storagePath,
        companyId: companyId || null,
        originalFilename: file?.name ?? "factuur",
        supplierId: selectedSupplierId || undefined,
        newSupplierName: !selectedSupplierId ? newSupplierName : undefined,
      }),
    });
    const body = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Verwerken mislukt.");
      return;
    }
    router.push(`/leveranciers/prijzen/importeren/${body.batchId}`);
  }

  async function handleConfirmIbanAndFinalize(step: Extract<Step, { kind: "confirmIban" }>) {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/invoices/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        header: step.header,
        lines: step.lines,
        storagePath: step.storagePath,
        companyId: companyId || null,
        originalFilename: file?.name ?? "factuur",
        supplierId: step.supplierId,
        confirmIbanMismatch: true,
      }),
    });
    const body = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Verwerken mislukt.");
      return;
    }
    router.push(`/leveranciers/prijzen/importeren/${body.batchId}`);
  }

  if (step.kind === "confirmSupplier") {
    return (
      <>
        <Topbar title="Leverancier bevestigen" />
        <main className="max-w-xl p-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                Factuur {step.header.invoiceNumber ?? ""} — &quot;{step.header.supplierName ?? "onbekende afzender"}&quot;
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted">
                Geen zekere match op btw-nummer, KvK-nummer of IBAN. Kies de juiste leverancier,
                of maak een nieuwe aan.
              </p>
              {step.candidates.length > 0 && (
                <div className="space-y-1">
                  {step.candidates.map((c) => (
                    <label key={c.supplier_id} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="supplier"
                        checked={selectedSupplierId === c.supplier_id}
                        onChange={() => {
                          setSelectedSupplierId(c.supplier_id);
                          setNewSupplierName("");
                        }}
                      />
                      {c.supplier_name}{" "}
                      <span className="text-xs text-muted">(gelijkende naam)</span>
                    </label>
                  ))}
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="supplier"
                  checked={!selectedSupplierId}
                  onChange={() => setSelectedSupplierId("")}
                />
                Nieuwe leverancier aanmaken
              </label>
              {!selectedSupplierId && (
                <input
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  placeholder={step.header.supplierName ?? "Naam leverancier"}
                  className="input"
                />
              )}
              {error && <p className="text-sm text-danger">{error}</p>}
              <div className="flex gap-2">
                <Button
                  onClick={() => handleConfirmSupplierAndFinalize(step)}
                  disabled={submitting || (!selectedSupplierId && !newSupplierName.trim())}
                >
                  {submitting ? "Bezig…" : "Bevestigen en factuurregels tonen"}
                </Button>
                <Button variant="secondary" onClick={() => setStep({ kind: "upload" })}>
                  Annuleren
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

  if (step.kind === "confirmIban") {
    return (
      <>
        <Topbar title="IBAN-controle" />
        <main className="max-w-xl p-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-danger">
                <TriangleAlert className="h-5 w-5" />
                IBAN wijkt af
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-foreground">
                Het rekeningnummer op deze factuur van <strong>{step.supplierName}</strong> wijkt af
                van het rekeningnummer dat we eerder van deze leverancier hadden. Dit kan een teken
                zijn van factuurfraude — controleer dit altijd eerst telefonisch bij de leverancier
                zelf (niet via de contactgegevens op deze factuur) voordat je bevestigt.
              </p>
              <p className="text-sm text-muted">Nieuw IBAN op factuur: {step.header.supplierIban}</p>
              {error && <p className="text-sm text-danger">{error}</p>}
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  onClick={() => handleConfirmIbanAndFinalize(step)}
                  disabled={submitting}
                >
                  {submitting ? "Bezig…" : "Ik heb dit geverifieerd — doorgaan"}
                </Button>
                <Button variant="secondary" onClick={() => setStep({ kind: "upload" })}>
                  Annuleren
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar title="Factuur uploaden" />
      <main className="max-w-xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Nieuwe factuur verwerken</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Geldig voor bedrijf (optioneel)
                </label>
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="input"
                >
                  <option value="">Groepsbreed</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Bestand</label>
                <input
                  required
                  type="file"
                  accept=".xml,.ubl,.pdf,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-teal file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-teal-light"
                />
                <p className="mt-1 text-xs text-muted">
                  UBL/XML wordt direct gestructureerd uitgelezen. Een PDF of foto wordt
                  geprobeerd via automatische herkenning — lukt dat niet, dan wordt het bestand
                  bewaard als archief en kies je zelf de leverancier.
                </p>
              </div>

              {step.kind === "needsManualSupplier" && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Leverancier (verplicht voor PDF)
                  </label>
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    className="input"
                  >
                    <option value="">Kies leverancier…</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {error && <p className="text-sm text-danger">{error}</p>}

              <Button type="submit" disabled={submitting || !file}>
                <Upload className="h-4 w-4" />
                {submitting ? "Bezig…" : "Verwerken"}
              </Button>
            </form>
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

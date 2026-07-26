"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, ClipboardPaste } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { Company, Supplier } from "@/lib/types/database";

export default function ImporterenPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [mode, setMode] = useState<"bestand" | "plakken">("bestand");
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("suppliers")
      .select("*")
      .order("name")
      .then(({ data }) => setSuppliers((data as Supplier[]) ?? []));
    supabase
      .from("companies")
      .select("*")
      .order("name")
      .then(({ data }) => setCompanies((data as Company[]) ?? []));
  }, []);

  async function submitFile(fileToSend: File) {
    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", fileToSend);
    formData.append("supplierId", supplierId);
    if (companyId) formData.append("companyId", companyId);

    const res = await fetch("/api/price-imports", {
      method: "POST",
      body: formData,
    });
    const body = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(body.error ?? "Er ging iets mis bij het importeren.");
      return;
    }
    router.push(`/leveranciers/prijzen/importeren/${body.batchId}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) return;

    if (mode === "bestand") {
      if (!file) return;
      await submitFile(file);
    } else {
      if (!pastedText.trim()) return;
      // Geplakte tabel (uit Excel, e-mail, of een portal) is bijna altijd
      // tab-gescheiden; hertoveren tot een "bestand" hergebruikt exact
      // dezelfde server-side verwerking (parsing, matching, controle) —
      // geen aparte plak-pijplijn nodig.
      const asCsv = pastedText.replace(/\t/g, ";");
      const pastedFile = new File([asCsv], "geplakte-tabel.csv", {
        type: "text/csv",
      });
      await submitFile(pastedFile);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }

  const canSubmit =
    !!supplierId &&
    (mode === "bestand" ? !!file : pastedText.trim().length > 0) &&
    !submitting;

  return (
    <>
      <Topbar title="Prijslijst of factuur importeren" />
      <main className="p-6 max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Nieuwe prijslijst verwerken</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Leverancier
                </label>
                <select
                  required
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
                >
                  <option value="">Kies een leverancier…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Geldig voor bedrijf (optioneel)
                </label>
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
                >
                  <option value="">Groepsbreed (alle bedrijven)</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-1 rounded-md border border-border bg-surface p-1">
                <button
                  type="button"
                  onClick={() => setMode("bestand")}
                  className={cn(
                    "flex-1 rounded px-3 py-1.5 text-sm font-medium",
                    mode === "bestand" ? "bg-teal text-white" : "text-muted"
                  )}
                >
                  Bestand uploaden
                </button>
                <button
                  type="button"
                  onClick={() => setMode("plakken")}
                  className={cn(
                    "flex-1 rounded px-3 py-1.5 text-sm font-medium",
                    mode === "plakken" ? "bg-teal text-white" : "text-muted"
                  )}
                >
                  Tabel plakken
                </button>
              </div>

              {mode === "bestand" ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={cn(
                    "rounded-md border-2 border-dashed p-6 text-center transition-colors",
                    dragOver ? "border-teal bg-teal/5" : "border-border"
                  )}
                >
                  <Upload className="mx-auto h-6 w-6 text-muted" />
                  <p className="mt-2 text-sm text-foreground">
                    Sleep hier de prijslijst of factuur naartoe, of
                  </p>
                  <label className="mt-2 inline-block cursor-pointer rounded-md bg-teal px-3 py-2 text-sm font-medium text-white hover:bg-teal-light">
                    Kies een bestand
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      className="hidden"
                    />
                  </label>
                  {file && (
                    <p className="mt-2 text-xs text-muted">Gekozen: {file.name}</p>
                  )}
                  <p className="mt-2 text-xs text-muted">
                    Excel of CSV. Geen speciaal sjabloon nodig.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <ClipboardPaste className="h-4 w-4" />
                    Plak hier de tabel uit Excel, een e-mail of leveranciersportal
                  </div>
                  <textarea
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    rows={8}
                    placeholder={"Artikel\tPrijs\nPilsener fust 30L\t89,50"}
                    className="w-full rounded-md border border-border bg-surface p-3 font-mono text-xs"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Kopieer direct uit Excel/Sheets (met Ctrl+C) en plak hier —
                    kolommen worden automatisch herkend.
                  </p>
                </div>
              )}

              <p className="text-xs text-muted">
                Verwacht minimaal een kolom met EAN-code of artikelnummer, en
                een kolom met de inkoopprijs.
              </p>

              {error && <p className="text-sm text-danger">{error}</p>}

              <Button type="submit" disabled={!canSubmit}>
                <Upload className="h-4 w-4" />
                {submitting ? "Bezig met verwerken…" : "Verwerken"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, ClipboardPaste, ArrowRight, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { CANONICAL_FIELDS } from "@/lib/price-import/columns";
import type { Company, Supplier } from "@/lib/types/database";

interface PreviewData {
  originalFilename: string;
  headers: string[];
  rows: { rowNumber: number; raw: Record<string, unknown> }[];
  suggestedMapping: Record<string, string>;
}

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

  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

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

  function buildFileToSend(): File | null {
    if (mode === "bestand") return file;
    if (!pastedText.trim()) return null;
    const asCsv = pastedText.replace(/\t/g, ";");
    return new File([asCsv], "geplakte-tabel.csv", { type: "text/csv" });
  }

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    const toSend = buildFileToSend();
    if (!toSend || !supplierId) return;

    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", toSend);

    const res = await fetch("/api/price-imports", { method: "POST", body: formData });
    const body = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(body.error ?? "Kan bestand niet lezen.");
      return;
    }

    setPreview(body as PreviewData);
    setMapping(body.suggestedMapping);
  }

  async function handleFinalize() {
    if (!preview) return;
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/price-imports/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId,
        companyId: companyId || null,
        originalFilename: preview.originalFilename,
        headers: preview.headers,
        rows: preview.rows,
        mapping,
      }),
    });
    const body = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(body.error ?? "Er ging iets mis bij het verwerken.");
      return;
    }
    router.push(`/leveranciers/prijzen/importeren/${body.batchId}`);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }

  const canPreview =
    !!supplierId &&
    (mode === "bestand" ? !!file : pastedText.trim().length > 0) &&
    !submitting;

  const mappedCanonical = new Set(Object.values(mapping));
  const hasIdentifier = mappedCanonical.has("ean") || mappedCanonical.has("articleNumber");
  const hasPrice = mappedCanonical.has("purchasePrice");
  const canFinalize = hasIdentifier && hasPrice && !submitting;

  // ---------------------------------------------------------------
  // Stap 2: kolommen koppelen
  // ---------------------------------------------------------------
  if (preview) {
    return (
      <>
        <Topbar title="Kolommen koppelen" />
        <main className="p-6 max-w-4xl space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{preview.originalFilename} — {preview.rows.length} regels</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted">
                Geef per kolom aan wat erin staat. We hebben alvast een gok
                gedaan — controleer en pas aan waar nodig. Minimaal één kolom
                moet EAN-code of Artikelnummer zijn, en één kolom Prijs.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    {preview.headers.map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">
                        <p className="mb-1 normal-case text-foreground">{h}</p>
                        <select
                          value={mapping[h] ?? "ignore"}
                          onChange={(e) =>
                            setMapping((prev) => ({ ...prev, [h]: e.target.value }))
                          }
                          className="h-8 w-full rounded-md border border-border bg-surface px-1 text-xs font-normal normal-case"
                        >
                          {CANONICAL_FIELDS.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 5).map((r) => (
                    <tr key={r.rowNumber} className="border-t border-border">
                      {preview.headers.map((h) => (
                        <td key={h} className="px-4 py-2 text-muted">
                          {String(r.raw[h] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 5 && (
                <p className="px-4 py-2 text-xs text-muted">
                  + {preview.rows.length - 5} meer regels
                </p>
              )}
            </CardContent>
          </Card>

          {!canFinalize && (
            <p className="flex items-center gap-1 text-sm text-copper">
              <TriangleAlert className="h-4 w-4" />
              Koppel minimaal een kolom aan EAN-code of Artikelnummer, en een
              kolom aan Prijs, om door te gaan.
            </p>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={handleFinalize} disabled={!canFinalize}>
              <ArrowRight className="h-4 w-4" />
              {submitting ? "Bezig…" : "Doorgaan naar controle"}
            </Button>
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Terug
            </Button>
          </div>
        </main>
      </>
    );
  }

  // ---------------------------------------------------------------
  // Stap 1: leverancier + bestand/plakken
  // ---------------------------------------------------------------
  return (
    <>
      <Topbar title="Prijslijst of factuur importeren" />
      <main className="p-6 max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Nieuwe prijslijst verwerken</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePreview} className="space-y-4">
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
                  {file && <p className="mt-2 text-xs text-muted">Gekozen: {file.name}</p>}
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
                    Kopieer direct uit Excel/Sheets (met Ctrl+C) en plak hier.
                  </p>
                </div>
              )}

              {error && <p className="text-sm text-danger">{error}</p>}

              <Button type="submit" disabled={!canPreview}>
                <ArrowRight className="h-4 w-4" />
                {submitting ? "Bezig met inlezen…" : "Volgende: kolommen koppelen"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

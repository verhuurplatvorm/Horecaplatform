"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, TriangleAlert, CheckCircle2 } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";

interface SupplierCandidate {
  supplier_id: string;
  supplier_name: string;
  similarity_score: number;
}

interface SupplierGroup {
  rawName: string;
  rowCount: number;
  matched: boolean;
  supplierId: string | null;
  candidates: SupplierCandidate[];
}

interface ParsedRow {
  supplierNameRaw: string;
  flaggedBySource?: boolean;
  [key: string]: unknown;
}

export default function ProductenImporterenPage() {
  const router = useRouter();
  const { companies } = useCompanyScope();

  const [step, setStep] = useState<"upload" | "review" | "done">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [supplierGroups, setSupplierGroups] = useState<SupplierGroup[]>([]);
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    totalRows: number;
    productsCreated: number;
    productCreationFailures: number;
    pricesInserted: number;
    alreadyUpToDate: number;
    flaggedBySourceCount: number;
    contentDerivedCount?: number;
    skippedNoSupplier: number;
    flaggedForReview: number;
    skippedMissingPriceOrPackaging: number;
    skippedNoProductMatch: number;
  } | null>(null);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/product-import/upload", { method: "POST", body: formData });
      let body: { rows?: ParsedRow[]; supplierGroups?: SupplierGroup[]; error?: string };
      try {
        body = await res.json();
      } catch {
        throw new Error(`De server gaf een onverwacht antwoord terug (HTTP ${res.status}).`);
      }
      if (!res.ok) {
        setError(body.error ?? "Kan bestand niet lezen.");
        return;
      }
      setRows(body.rows ?? []);
      const groups = body.supplierGroups ?? [];
      setSupplierGroups(groups);
      const initialResolution: Record<string, string> = {};
      for (const g of groups) {
        if (g.matched && g.supplierId) initialResolution[g.rawName] = g.supplierId;
      }
      setResolution(initialResolution);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis bij het uploaden.");
    } finally {
      setUploading(false);
    }
  }

  async function handleImport() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/product-import/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows,
          supplierResolution: resolution,
          companyId: companyId || null,
        }),
      });
      let body: typeof result & { error?: string };
      try {
        body = await res.json();
      } catch {
        throw new Error(`De server gaf een onverwacht antwoord terug (HTTP ${res.status}).`);
      }
      if (!res.ok) {
        setError(body?.error ?? "Importeren mislukt.");
        return;
      }
      setResult(body as NonNullable<typeof result>);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis bij het importeren.");
    } finally {
      setSaving(false);
    }
  }

  const unresolvedCount = supplierGroups.filter((g) => !resolution[g.rawName]).length;
  const totalRowsResolved = supplierGroups
    .filter((g) => resolution[g.rawName])
    .reduce((s, g) => s + g.rowCount, 0);

  if (step === "done" && result) {
    return (
      <>
        <Topbar title="Import voltooid" />
        <main className="max-w-2xl space-y-4 p-6">
          <Card>
            <CardContent className="space-y-2 py-4">
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" />
                Import voltooid.
              </p>
              <ul className="space-y-1 text-sm text-muted">
                <li>{result.totalRows} productregels in het bestand</li>
                <li>{result.productsCreated} nieuwe producten aangemaakt</li>
                {result.productCreationFailures > 0 && (
                  <li className="text-danger">
                    {result.productCreationFailures} product(en) konden ondanks een nieuwe poging
                    per regel nog steeds niet aangemaakt worden (zie de servermeldingen voor de
                    precieze reden)
                  </li>
                )}
                <li>{result.pricesInserted} leveranciersprijzen opgeslagen</li>
                {result.alreadyUpToDate > 0 && (
                  <li className="text-muted">
                    {result.alreadyUpToDate} ongewijzigd — stonden al identiek in het systeem,
                    niet opnieuw aangemaakt
                  </li>
                )}
                {result.flaggedBySourceCount > 0 && (
                  <li className="text-copper">
                    {result.flaggedBySourceCount} daarvan komt uit een regel die het bronbestand
                    zelf al als onzeker markeerde — gewoon meegeïmporteerd, niet geblokkeerd, maar
                    gemarkeerd voor als je er later aan toe bent.
                  </li>
                )}
                {(result.contentDerivedCount ?? 0) > 0 && (
                  <li className="text-copper">
                    {result.contentDerivedCount} daarvan had geen inhoud/eenheid in het bestand —
                    de inhoud is uit de productnaam afgeleid (bv. &quot;2x5l&quot; → 10.000 ml).
                    Meegeïmporteerd en gemarkeerd onder &quot;Te controleren&quot;.
                  </li>
                )}
                {result.skippedNoSupplier > 0 && (
                  <li className="text-copper">
                    {result.skippedNoSupplier} regel(s) overgeslagen — leverancier niet gekoppeld
                  </li>
                )}
                {result.skippedMissingPriceOrPackaging > 0 && (
                  <li className="text-copper">
                    {result.skippedMissingPriceOrPackaging} regel(s) overgeslagen — geen prijs of
                    verpakkingsinfo in het bestand
                  </li>
                )}
                {result.skippedNoProductMatch > 0 && (
                  <li className="text-copper">
                    {result.skippedNoProductMatch} regel(s) overgeslagen — kon geen product
                    koppelen (nieuw aanmaken is mislukt)
                  </li>
                )}
                {result.flaggedForReview > 0 && (
                  <li className="text-danger">
                    {result.flaggedForReview} regel(s) overgeslagen — verpakkingseenheid past niet
                    bij het gekoppelde product (controleer handmatig)
                  </li>
                )}
              </ul>
              <p className="pt-2 text-xs text-muted">
                {result.pricesInserted +
                  result.alreadyUpToDate +
                  result.skippedNoSupplier +
                  result.flaggedForReview +
                  result.skippedMissingPriceOrPackaging +
                  result.skippedNoProductMatch}{" "}
                van {result.totalRows} regels verantwoord.
              </p>
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button onClick={() => router.push("/producten")}>Naar productoverzicht</Button>
            {result.flaggedBySourceCount > 0 && (
              <Button variant="secondary" onClick={() => router.push("/producten/opschonen")}>
                {result.flaggedBySourceCount} te controleren bekijken
              </Button>
            )}
          </div>
        </main>
      </>
    );
  }

  if (step === "review") {
    return (
      <>
        <Topbar title="Import controleren" />
        <main className="max-w-4xl space-y-4 p-6">
          <p className="text-sm text-muted">
            {supplierGroups.length} leverancier(s) herkend in dit bestand,{" "}
            {rows.length} productregels totaal. Leveranciers die niet automatisch gekoppeld
            konden worden, worden <strong>niet</strong> aangemaakt — koppel ze hieronder handmatig
            aan een bestaande leverancier, of laat ze op &quot;overslaan&quot; staan.
          </p>
          {rows.some((r) => r.flaggedBySource) && (
            <p className="text-sm text-copper">
              {rows.filter((r) => r.flaggedBySource).length} regel(s) waren in het bronbestand al
              gemarkeerd als onzeker — dat blokkeert niets, ze worden gewoon meegeïmporteerd en
              blijven daarna gemarkeerd onder &quot;Producten opschonen&quot; zodat je ze op je
              eigen moment kunt nalopen.
            </p>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-medium">Leverancier in bestand</th>
                    <th className="px-5 py-3 font-medium">Regels</th>
                    <th className="px-5 py-3 font-medium">Koppeling</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierGroups.map((g) => (
                    <tr key={g.rawName} className="border-t border-border">
                      <td className="px-5 py-3 font-medium">
                        {g.rawName}
                        {!g.matched && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs text-copper">
                            <TriangleAlert className="h-3.5 w-3.5" />
                            niet herkend
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted">{g.rowCount}</td>
                      <td className="px-5 py-3">
                        {g.matched ? (
                          <span className="text-success">Automatisch gekoppeld</span>
                        ) : (
                          <select
                            value={resolution[g.rawName] ?? ""}
                            onChange={(e) =>
                              setResolution((prev) => ({ ...prev, [g.rawName]: e.target.value }))
                            }
                            className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
                          >
                            <option value="">Overslaan</option>
                            {g.candidates.map((c) => (
                              <option key={c.supplier_id} value={c.supplier_id}>
                                Koppel aan &quot;{c.supplier_name}&quot;
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Bedrijf (optioneel)
            </label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="h-10 w-full max-w-xs rounded-md border border-border bg-surface px-3 text-sm"
            >
              <option value="">Groepsbreed</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handleImport} disabled={saving || totalRowsResolved === 0}>
              {saving ? "Bezig met importeren…" : `${totalRowsResolved} productregels importeren`}
            </Button>
            <Button variant="secondary" onClick={() => setStep("upload")}>
              Terug
            </Button>
            {unresolvedCount > 0 && (
              <span className="text-xs text-copper">
                {unresolvedCount} leverancier(s) nog niet gekoppeld — regels daarvan worden
                overgeslagen
              </span>
            )}
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar title="Producten importeren (Excel)" />
      <main className="max-w-xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Excel-bestand met meerdere leveranciers importeren</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Excel-bestand
                </label>
                <input
                  required
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-teal file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-teal-light"
                />
                <p className="mt-1 text-xs text-muted">
                  Eén rij per product, met een leverancier-kolom — meerdere leveranciers in één
                  bestand worden automatisch herkend en gescheiden. Ontbrekende leveranciers
                  worden nooit automatisch aangemaakt.
                </p>
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}

              <Button type="submit" disabled={uploading || !file}>
                <Upload className="h-4 w-4" />
                {uploading ? "Bezig met inlezen…" : "Inlezen"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, Download, FileSpreadsheet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { euro } from "@/lib/price-comparison";
import {
  checkDrafts,
  draftToInsert,
  parseContractSheet,
  TEMPLATE_HEADERS,
  toDrafts,
  type CatalogArticle,
  type ContractDraft,
  type ExistingContract,
  type NamedOption,
} from "@/lib/contract-import";

const cellCls = "h-8 w-full rounded border border-border bg-surface px-1.5 text-xs";

/**
 * Excel-import van contractprijzen met voorvertoning. Niets wordt opgeslagen
 * voordat de beheerder leverancier, bedrijf, artikelnummer, verpakking,
 * prijs excl. btw en ingangsdatum heeft gecontroleerd en "Opslaan" kiest.
 */
export function ContractImport({
  suppliers,
  companies,
  existing,
  onClose,
  onSaved,
}: {
  suppliers: NamedOption[];
  companies: NamedOption[];
  existing: ExistingContract[];
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ContractDraft[]>([]);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [catalog, setCatalog] = useState<Map<string, CatalogArticle[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const initialised = useRef(false);

  // Artikelen van de leveranciers in het bestand, om artikelnummers te matchen.
  const supplierIds = useMemo(
    () => [...new Set(drafts.map((d) => d.supplierId).filter(Boolean))].sort() as string[],
    [drafts],
  );
  const missingSuppliers = supplierIds.filter((id) => !catalog.has(id));
  const catalogKey = missingSuppliers.join(",");
  useEffect(() => {
    if (!catalogKey) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const loaded = new Map<string, CatalogArticle[]>();
      for (const supplierId of catalogKey.split(",")) {
        const list: CatalogArticle[] = [];
        // Gepagineerd: de standaardlimiet van 1000 rijen kapt stil af.
        for (let from = 0; ; from += 1000) {
          const { data } = await supabase
            .from("supplier_products")
            .select("supplier_article_code, packaging_description, product_id, products(name)")
            .eq("supplier_id", supplierId)
            .not("supplier_article_code", "is", null)
            .is("valid_to", null)
            .range(from, from + 999);
          const page = (data ?? []) as unknown as {
            supplier_article_code: string;
            packaging_description: string | null;
            product_id: string;
            products: { name: string } | null;
          }[];
          for (const p of page)
            list.push({
              supplierId,
              articleNumber: p.supplier_article_code,
              productId: p.product_id,
              productName: p.products?.name ?? "",
              packaging: p.packaging_description,
            });
          if (page.length < 1000) break;
        }
        loaded.set(supplierId, list);
      }
      if (!cancelled) setCatalog((prev) => new Map([...prev, ...loaded]));
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogKey]);

  const catalogReady = missingSuppliers.length === 0;
  const checked = useMemo(
    () => checkDrafts(drafts, { catalog: [...catalog.values()].flat(), existing }),
    [drafts, catalog, existing],
  );

  // Eerste keer na het inlezen: alles zonder fout en zonder overlap aanvinken.
  useEffect(() => {
    if (initialised.current || !catalogReady || drafts.length === 0) return;
    initialised.current = true;
    setInclude(
      new Set(
        checked
          .filter((c) => c.canSave && c.overlapsExisting.length === 0 && c.overlapsLines.length === 0)
          .map((c) => c.line),
      ),
    );
  }, [catalogReady, checked, drafts.length]);

  async function readFile(file: File) {
    setError(null);
    setFileName(file.name);
    initialised.current = false;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
      const { rows, missingColumns } = parseContractSheet(raw);
      if (missingColumns.length) {
        setError(`Kolommen niet gevonden: ${missingColumns.join(", ")}. Gebruik het voorbeeldbestand.`);
        setDrafts([]);
        return;
      }
      if (rows.length === 0) {
        setError("Geen regels gevonden in het eerste tabblad.");
        setDrafts([]);
        return;
      }
      setDrafts(toDrafts(rows, suppliers, companies));
    } catch (e) {
      setError(`Kan het bestand niet lezen: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      [suppliers[0]?.name ?? "Leverancier", "Alle", "123456", "Olijfolie extra vierge", "6 x 1 L", "45,90", "01-01-2027", "", ""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contractprijzen");
    XLSX.writeFile(wb, "contractprijzen-voorbeeld.xlsx");
  }

  const patch = (line: number, p: Partial<ContractDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.line === line ? { ...d, ...p } : d)));

  const toSave = checked.filter((c) => include.has(c.line) && c.canSave);
  const counts = {
    errors: checked.filter((c) => !c.canSave).length,
    noMatch: checked.filter((c) => c.canSave && !c.productId).length,
    overlap: checked.filter((c) => c.overlapsExisting.length || c.overlapsLines.length).length,
  };

  async function save() {
    if (toSave.length === 0) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const rows = toSave.map(draftToInsert);
    let saved = 0;
    const failed: string[] = [];
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error: batchError } = await supabase.from("supplier_contract_prices").insert(chunk);
      if (!batchError) {
        saved += chunk.length;
        continue;
      }
      // Regel voor regel, zodat één foute regel de rest niet tegenhoudt.
      for (let j = 0; j < chunk.length; j++) {
        const { error: oneError } = await supabase.from("supplier_contract_prices").insert(chunk[j]);
        if (oneError) failed.push(`regel ${toSave[i + j].line}: ${oneError.message}`);
        else saved++;
      }
    }
    setSaving(false);
    if (failed.length) {
      setError(`${saved} opgeslagen, ${failed.length} niet: ${failed.slice(0, 3).join("; ")}`);
      if (saved) onSaved(saved);
      return;
    }
    onSaved(saved);
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm font-medium">
            <FileSpreadsheet className="mr-1 inline h-4 w-4 text-teal" />
            Contractprijzen importeren uit Excel
            {fileName && <span className="ml-2 font-normal text-muted">{fileName}</span>}
          </p>
          <Button size="sm" variant="ghost" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> Voorbeeldbestand
          </Button>
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
            {drafts.length ? "Ander bestand" : "Bestand kiezen"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={saving} title="Sluiten">
            <X className="h-4 w-4" />
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
              e.target.value = "";
            }}
          />
        </div>
        {drafts.length === 0 && !error && (
          <p className="text-sm text-muted">
            Kolommen: Leverancier, Bedrijf (leeg of &ldquo;Alle&rdquo; = alle bedrijven), Artikelnummer,
            Omschrijving, Verpakking, Prijs excl. btw, Ingangsdatum en eventueel Einddatum en Notitie.
            Je controleert alles in een voorvertoning; er wordt pas opgeslagen als je dat bevestigt.
          </p>
        )}
        {error && <p className="rounded-md bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}

        {drafts.length > 0 && (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>{checked.length} regels</span>
              {counts.errors > 0 && <span className="text-danger">{counts.errors} met fout (niet op te slaan)</span>}
              {counts.noMatch > 0 && <span className="text-warning">{counts.noMatch} zonder match met een ingrediënt</span>}
              {counts.overlap > 0 && <span className="text-warning">{counts.overlap} met overlappende periode</span>}
              {!catalogReady && <span className="text-muted">Artikelen van de leverancier ophalen…</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-muted">
                    <th className="w-6 px-1 py-1" />
                    <th className="px-1 py-1 font-medium">#</th>
                    <th className="px-1 py-1 font-medium">Leverancier</th>
                    <th className="px-1 py-1 font-medium">Bedrijf</th>
                    <th className="px-1 py-1 font-medium">Art.nr</th>
                    <th className="px-1 py-1 font-medium">Ingrediënt (match)</th>
                    <th className="px-1 py-1 font-medium">Verpakking</th>
                    <th className="px-1 py-1 font-medium">Prijs excl. btw</th>
                    <th className="px-1 py-1 font-medium">Ingangsdatum</th>
                    <th className="px-1 py-1 font-medium">Einddatum</th>
                    <th className="px-1 py-1 font-medium">Controle</th>
                  </tr>
                </thead>
                <tbody>
                  {checked.map((c) => {
                    const hasError = !c.canSave;
                    return (
                      <tr
                        key={c.line}
                        className={cn(
                          "border-t border-border align-top",
                          hasError && "bg-danger/5",
                          !hasError && c.issues.length > 0 && "bg-warning/5",
                        )}
                      >
                        <td className="px-1 py-1">
                          <input
                            type="checkbox"
                            disabled={hasError}
                            checked={include.has(c.line) && !hasError}
                            onChange={(e) =>
                              setInclude((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(c.line);
                                else next.delete(c.line);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="px-1 py-1 tabular text-muted">{c.line}</td>
                        <td className="px-1 py-1">
                          <select
                            className={cn(cellCls, !c.supplierId && "border-danger")}
                            value={c.supplierId ?? ""}
                            onChange={(e) => patch(c.line, { supplierId: e.target.value || null })}
                            title={c.supplierText}
                          >
                            <option value="">— {c.supplierText || "kies"} —</option>
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <select
                            className={cn(cellCls, c.companyId === null && "border-danger")}
                            value={c.companyId === null ? "__none" : c.companyId}
                            onChange={(e) => patch(c.line, { companyId: e.target.value === "__none" ? null : e.target.value })}
                            title={c.companyText}
                          >
                            {c.companyId === null && <option value="__none">— {c.companyText} —</option>}
                            <option value="">Alle bedrijven</option>
                            {companies.map((co) => (
                              <option key={co.id} value={co.id}>
                                {co.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <input
                            className={cn(cellCls, "w-24")}
                            value={c.articleNumber}
                            onChange={(e) => patch(c.line, { articleNumber: e.target.value })}
                          />
                        </td>
                        <td className="px-1 py-1">
                          {c.productName ? (
                            <span>{c.productName}</span>
                          ) : (
                            <span className="text-warning">geen match</span>
                          )}
                          {c.description && <div className="text-muted">{c.description}</div>}
                        </td>
                        <td className="px-1 py-1">
                          <input
                            className={cn(cellCls, "w-24")}
                            value={c.packaging}
                            placeholder={c.catalogPackaging ?? ""}
                            onChange={(e) => patch(c.line, { packaging: e.target.value })}
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            className={cn(cellCls, "w-20 text-right", c.priceValue === null && "border-danger")}
                            value={c.price}
                            inputMode="decimal"
                            onChange={(e) => patch(c.line, { price: e.target.value })}
                          />
                          {c.priceValue !== null && <div className="text-right text-muted">{euro(c.priceValue)}</div>}
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="date"
                            className={cn(cellCls, "w-32")}
                            value={/^\d{4}-\d{2}-\d{2}$/.test(c.validFrom) ? c.validFrom : ""}
                            onChange={(e) => patch(c.line, { validFrom: e.target.value })}
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="date"
                            className={cn(cellCls, "w-32")}
                            value={/^\d{4}-\d{2}-\d{2}$/.test(c.validTo) ? c.validTo : ""}
                            onChange={(e) => patch(c.line, { validTo: e.target.value })}
                          />
                        </td>
                        <td className="px-1 py-1">
                          {c.issues.length === 0 ? (
                            <span className="text-success">In orde</span>
                          ) : (
                            <ul className="space-y-0.5">
                              {c.issues.map((i) => (
                                <li
                                  key={i.text}
                                  className={cn("flex gap-1", i.level === "fout" ? "text-danger" : "text-warning")}
                                >
                                  <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                                  {i.text}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} disabled={saving || toSave.length === 0 || !catalogReady}>
                {saving ? "Bezig met opslaan…" : `${toSave.length} contractprijs${toSave.length === 1 ? "" : "zen"} opslaan`}
              </Button>
              <Button variant="secondary" onClick={onClose} disabled={saving}>
                Annuleren
              </Button>
              <span className="text-xs text-muted">
                Regels met een overlappende periode staan standaard uit; vink ze aan als dat zo bedoeld is.
                Een contractprijs gaat in de prijsvergelijking vóór de prijslijst.
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

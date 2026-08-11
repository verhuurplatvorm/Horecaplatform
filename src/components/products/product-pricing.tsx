"use client";

import { useEffect, useState } from "react";
import { TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface PriceRow {
  id: string;
  supplierName: string;
  companyId: string | null;
  companyName: string | null;
  packagingDescription: string | null;
  packagingUnitCount: number;
  purchasePrice: number;
  pricePerBaseUnit: number;
  isContractPrice: boolean;
  validFrom: string;
}

interface ImpactRow {
  recipe_id: string;
  recipe_name: string;
  recipe_kind: "gerecht" | "halfproduct";
  old_cost: number;
  new_cost: number;
  delta: number;
  sales_price: number | null;
  old_foodcost_pct: number | null;
  new_foodcost_pct: number | null;
}

const FOODCOST_WARNING = 33;

export function ProductPricing({
  productId,
  baseUnitName,
}: {
  productId: string;
  baseUnitName: string | null;
}) {
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;

  const [rows, setRows] = useState<PriceRow[]>([]);
  const [manualPrice, setManualPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingRow, setEditingRow] = useState<PriceRow | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const { data: productRow } = await supabase
        .from("products")
        .select("manual_price_per_base_unit")
        .eq("id", productId)
        .maybeSingle();
      if (cancelled) return;
      setManualPrice(productRow?.manual_price_per_base_unit ?? null);

      const { data } = await supabase
        .from("supplier_products")
        .select(
          "id, company_id, packaging_description, packaging_unit_count, purchase_price, price_per_base_unit, is_contract_price, valid_from, suppliers(name), companies(name)"
        )
        .eq("product_id", productId)
        .is("valid_to", null)
        .order("purchase_price");
      if (cancelled) return;

      setRows(
        (data ?? []).map((r) => ({
          id: r.id,
          // @ts-expect-error -- geneste relaties, niet in het handmatige Database-type
          supplierName: r.suppliers?.name ?? "onbekend",
          companyId: r.company_id,
          // @ts-expect-error -- geneste relaties
          companyName: r.companies?.name ?? null,
          packagingDescription: r.packaging_description,
          packagingUnitCount: r.packaging_unit_count,
          purchasePrice: r.purchase_price,
          pricePerBaseUnit: r.price_per_base_unit ?? 0,
          isContractPrice: r.is_contract_price,
          validFrom: r.valid_from,
        }))
      );
      setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [productId, reloadToken]);

  function reload() {
    setReloadToken((t) => t + 1);
  }

  const cheapestPerBaseUnit =
    rows.length > 0 ? Math.min(...rows.map((r) => r.pricePerBaseUnit)) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leveranciersprijzen vergelijken</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
<table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Leverancier</th>
              <th className="px-5 py-3 font-medium">Verpakking</th>
              <th className="px-5 py-3 font-medium">Prijs</th>
              <th className="px-5 py-3 font-medium">Prijs/basiseenheid</th>
              <th className="px-5 py-3 font-medium">Sinds</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-5 py-3 font-medium">
                  {r.supplierName}
                  {r.isContractPrice && (
                    <span className="ml-2 rounded-full bg-teal/10 px-1.5 py-0.5 text-xs text-teal">
                      contract
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-muted">
                  {r.packagingDescription ?? "—"}
                </td>
                <td className="px-5 py-3 tabular">€ {r.purchasePrice.toFixed(2)}</td>
                <td className="px-5 py-3 tabular">
                  <span
                    className={cn(
                      r.pricePerBaseUnit === cheapestPerBaseUnit &&
                        rows.length > 1
                        ? "rounded bg-success/10 px-1.5 py-0.5 text-success"
                        : ""
                    )}
                  >
                    € {r.pricePerBaseUnit.toFixed(4)} / {baseUnitName ?? ""}
                  </span>
                </td>
                <td className="px-5 py-3 text-muted">
                  {new Date(r.validFrom).toLocaleDateString("nl-NL")}
                </td>
                <td className="px-5 py-3">
                  <Button size="sm" variant="secondary" onClick={() => setEditingRow(r)}>
                    Prijs wijzigen
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && manualPrice !== null && (
              <tr className="border-t border-border">
                <td className="px-5 py-3 font-medium">
                  Eigen prijs
                  <span className="ml-2 rounded-full bg-teal/10 px-1.5 py-0.5 text-xs text-teal">
                    zonder leverancier
                  </span>
                </td>
                <td className="px-5 py-3 text-muted">—</td>
                <td className="px-5 py-3 text-muted">—</td>
                <td className="px-5 py-3 tabular">
                  € {manualPrice.toFixed(4)} / {baseUnitName ?? ""}
                </td>
                <td className="px-5 py-3 text-muted">—</td>
                <td className="px-5 py-3 text-xs text-muted">
                  aanpasbaar via het productformulier
                </td>
              </tr>
            )}
            {rows.length === 0 && !loading && manualPrice === null && (
              <tr>
                <td colSpan={7} className="px-5 py-6 text-center text-muted">
                  Nog geen leveranciersprijs bekend voor dit ingrediënt.
                </td>
              </tr>
            )}
          </tbody>
        </table>
</div>
        {rows.length > 0 && manualPrice !== null && (
          <p className="px-5 pb-4 pt-2 text-xs text-muted">
            Dit ingrediënt heeft ook een eigen kostprijs (€ {manualPrice.toFixed(4)} /{" "}
            {baseUnitName ?? "basiseenheid"}), maar die is niet actief: een
            leveranciersprijs gaat altijd voor.
          </p>
        )}
      </CardContent>

      {editingRow && (
        <Modal title={`Prijs wijzigen — ${editingRow.supplierName}`} onClose={() => setEditingRow(null)}>
          <PriceChangeForm
            row={editingRow}
            productId={productId}
            baseUnitName={baseUnitName}
            referenceCompanyId={editingRow.companyId ?? referenceCompanyId}
            onDone={() => {
              setEditingRow(null);
              reload();
            }}
            onCancel={() => setEditingRow(null)}
          />
        </Modal>
      )}
    </Card>
  );
}

function PriceChangeForm({
  row,
  productId,
  baseUnitName,
  referenceCompanyId,
  onDone,
  onCancel,
}: {
  row: PriceRow;
  productId: string;
  baseUnitName: string | null;
  referenceCompanyId: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [newPrice, setNewPrice] = useState(row.purchasePrice.toString());
  const [packagingDescription, setPackagingDescription] = useState(row.packagingDescription ?? "");
  const [packagingUnitCount, setPackagingUnitCount] = useState(row.packagingUnitCount.toString());
  const [validFrom, setValidFrom] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [reason, setReason] = useState("");
  const [impactRaw, setImpactRaw] = useState<ImpactRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectivePackagingUnitCount = Number(packagingUnitCount) || row.packagingUnitCount;
  const newPricePerBaseUnit =
    Number(newPrice) > 0 && effectivePackagingUnitCount > 0
      ? Number(newPrice) / effectivePackagingUnitCount
      : 0;
  const diff = newPricePerBaseUnit - row.pricePerBaseUnit;
  const diffPct = row.pricePerBaseUnit > 0 ? (diff / row.pricePerBaseUnit) * 100 : 0;
  const hasValidPrice = Boolean(referenceCompanyId) && Number(newPrice) > 0;
  const impact = hasValidPrice ? impactRaw : null;

  useEffect(() => {
    if (!hasValidPrice) return;
    let cancelled = false;
    const timeout = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("get_price_change_impact", {
        p_product_id: productId,
        p_company_id: referenceCompanyId!,
        p_new_price_per_base_unit: newPricePerBaseUnit,
      });
      if (!cancelled) setImpactRaw((data as ImpactRow[]) ?? []);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newPrice, referenceCompanyId, productId]);

  async function handleConfirm() {
    setError(null);
    if (!Number(newPrice) || Number(newPrice) <= 0) {
      setError("Vul een geldige prijs in.");
      return;
    }
    setSaving(true);
    const supabase = createClient();

    const { data: existing } = await supabase
      .from("supplier_products")
      .select("supplier_id")
      .eq("id", row.id)
      .single();

    await supabase
      .from("supplier_products")
      .update({
        valid_to: new Date(new Date(validFrom).getTime() - 86400000)
          .toISOString()
          .slice(0, 10),
      })
      .eq("id", row.id);

    const { error: insertError } = await supabase.from("supplier_products").insert({
      supplier_id: existing?.supplier_id,
      product_id: productId,
      company_id: row.companyId,
      packaging_description: packagingDescription.trim() || null,
      packaging_unit_count: effectivePackagingUnitCount,
      purchase_price: Number(newPrice),
      is_contract_price: row.isContractPrice,
      valid_from: validFrom,
      change_reason: reason.trim() || null,
    });
    setSaving(false);

    if (insertError) {
      setError("Opslaan mislukt: " + insertError.message);
      return;
    }
    onDone();
  }

  const worseningRecipes = (impact ?? []).filter(
    (i) => i.new_foodcost_pct !== null && i.new_foodcost_pct > FOODCOST_WARNING
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Nieuwe prijs (per verpakking)
          </label>
          <input
            type="number"
            step="0.01"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Ingangsdatum
          </label>
          <input
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            className="input"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Verpakking (omschrijving)
          </label>
          <input
            value={packagingDescription}
            onChange={(e) => setPackagingDescription(e.target.value)}
            placeholder="bv. 1 x 700 ml"
            className="input"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Inhoud (in {baseUnitName ?? "basiseenheid"})
          </label>
          <input
            type="number"
            step="any"
            value={packagingUnitCount}
            onChange={(e) => setPackagingUnitCount(e.target.value)}
            className="input"
          />
          <p className="mt-1 text-xs text-muted">
            Klopt de verpakking niet (bv. verkeerd geïmporteerd)? Pas &apos;m hier direct aan.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        {diff > 0 ? (
          <span className="flex items-center gap-1 text-danger">
            <TrendingUp className="h-4 w-4" /> +€{diff.toFixed(4)} ({diffPct.toFixed(1)}%) duurder
          </span>
        ) : diff < 0 ? (
          <span className="flex items-center gap-1 text-success">
            <TrendingDown className="h-4 w-4" /> €{diff.toFixed(4)} ({diffPct.toFixed(1)}%) goedkoper
          </span>
        ) : (
          <span className="text-muted">Ongewijzigd</span>
        )}
        <span className="text-muted">
          (€ {newPricePerBaseUnit.toFixed(4)} / {baseUnitName ?? ""})
        </span>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">
          Reden / opmerking
        </label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className="input" />
      </div>

      {impact !== null && (
        <div className="rounded-md border border-border bg-background p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            Impact: {impact.length} gerecht(en)/halfproduct(en) geraakt
          </p>
          {impact.length === 0 ? (
            <p className="text-sm text-muted">Wordt nog nergens gebruikt.</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {impact.map((i) => (
                <li key={i.recipe_id} className="flex items-center justify-between">
                  <span>
                    {i.recipe_name}{" "}
                    <span className="text-xs text-muted">({i.recipe_kind})</span>
                  </span>
                  <span
                    className={cn(
                      "tabular",
                      i.delta > 0 ? "text-danger" : i.delta < 0 ? "text-success" : "text-muted"
                    )}
                  >
                    {i.delta > 0 ? "+" : ""}
                    €{i.delta.toFixed(4)}
                    {i.new_foodcost_pct !== null &&
                      ` · foodcost ${i.new_foodcost_pct.toFixed(1)}%`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {worseningRecipes.length > 0 && (
            <p className="mt-2 flex items-center gap-1 text-xs text-copper">
              <TriangleAlert className="h-3.5 w-3.5" />
              {worseningRecipes.length} gerecht(en) komen boven {FOODCOST_WARNING}% foodcost.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={handleConfirm} disabled={saving}>
          {saving ? "Opslaan…" : "Prijswijziging bevestigen"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Annuleren
        </Button>
      </div>

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
    </div>
  );
}

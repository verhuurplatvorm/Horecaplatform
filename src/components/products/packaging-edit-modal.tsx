"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  convert,
  fmt,
  isUnitKey,
  parsePackaging,
  pricesFromCount,
  type KeyBridge,
  type UnitKey,
} from "@/lib/packaging";

export interface PackagingEditTarget {
  productId: string;
  productName: string;
  priceRowId: string;
  purchasePrice: number;
  baseUnitKey: string;
  packagingDescription: string | null;
}

export interface PackagingEditResult {
  packagingUnitCount: number;
  packagingDescription: string;
  avgUnitQuantity: number | null;
}

const SIZE_UNITS: { key: UnitKey; label: string }[] = [
  { key: "g", label: "gram" },
  { key: "kg", label: "kilo" },
  { key: "ml", label: "ml" },
  { key: "l", label: "liter" },
];

const euro = (n: number) => `€ ${fmt(n, 4)}`;

/**
 * Eén simpel formulier om de verpakking in te vullen:
 *   "18 stuks per verpakking, elk 260 gram".
 * Staat het ingrediënt in stuks, dan wordt 260 g het gewicht per stuk
 * (zodat je in een recept 1 stuk óf 100 g kunt invullen). Staat het in
 * gram/ml, dan wordt het totaal omgerekend naar die eenheid.
 */
export function PackagingEditModal({
  target,
  onClose,
  onSaved,
}: {
  target: PackagingEditTarget;
  onClose: () => void;
  onSaved: (result: PackagingEditResult) => void;
}) {
  const baseKey = isUnitKey(target.baseUnitKey) ? target.baseUnitKey : null;
  const baseIsPiece = baseKey === "stuk";

  const initial = useMemo(() => {
    const spec = parsePackaging(target.packagingDescription) ?? parsePackaging(target.productName);
    const sizeUnit: UnitKey =
      spec && ["g", "kg", "ml", "l"].includes(spec.unit) ? spec.unit : baseKey && ["g", "ml"].includes(baseKey) ? baseKey : "g";
    return {
      pieces: spec?.packs != null && spec.perPack != null ? String(spec.packs) : "1",
      size: spec?.perPack != null ? String(spec.perPack) : spec && spec.packs == null ? String(spec.total) : "",
      sizeUnit,
    };
  }, [target, baseKey]);

  const [pieces, setPieces] = useState(initial.pieces);
  const [size, setSize] = useState(initial.size);
  const [sizeUnit, setSizeUnit] = useState<UnitKey>(initial.sizeUnit);
  const [bridge, setBridge] = useState<KeyBridge | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unitIds, setUnitIds] = useState<Record<string, string>>({});

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: units } = await supabase.from("units").select("id, key");
      const ids = Object.fromEntries((units ?? []).map((u) => [u.key as string, u.id as string]));
      setUnitIds(ids);
      const { data: prod } = await supabase
        .from("products")
        .select("avg_unit_quantity, avg_unit_id")
        .eq("id", target.productId)
        .maybeSingle();
      const avgKey = (units ?? []).find((u) => u.id === prod?.avg_unit_id)?.key;
      if (prod?.avg_unit_quantity && isUnitKey(avgKey)) {
        setBridge({ quantity: Number(prod.avg_unit_quantity), unit: avgKey });
      }
    })();
  }, [target.productId]);

  const piecesN = Number(pieces);
  const sizeN = Number(size);

  // Wat wordt er opgeslagen?
  const plan = useMemo(() => {
    if (!baseKey || !(piecesN > 0)) return null;
    if (baseIsPiece) {
      const usedBridge: KeyBridge | null = sizeN > 0 ? { quantity: sizeN, unit: sizeUnit } : bridge;
      return { count: piecesN, bridge: usedBridge, newBridge: sizeN > 0 ? { quantity: sizeN, unit: sizeUnit } : null };
    }
    if (!(sizeN > 0)) return null;
    const count = convert(piecesN * sizeN, sizeUnit, baseKey);
    return count === null ? null : { count, bridge, newBridge: null };
  }, [baseKey, baseIsPiece, piecesN, sizeN, sizeUnit, bridge]);

  const prices = plan && baseKey ? pricesFromCount(target.purchasePrice, plan.count, baseKey, plan.bridge) : null;
  const description = sizeN > 0
    ? `${fmt(piecesN)} × ${fmt(sizeN)} ${SIZE_UNITS.find((u) => u.key === sizeUnit)?.label === "gram" ? "Gram" : sizeUnit}`
    : `${fmt(piecesN)} × 1 Stuks`;

  async function save() {
    if (!plan || !baseKey) {
      setError(
        baseIsPiece
          ? "Vul het aantal stuks per verpakking in."
          : "Vul aantal en inhoud in, in een eenheid die bij dit ingrediënt past (gewicht of inhoud)."
      );
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    if (plan.newBridge && unitIds[plan.newBridge.unit as string]) {
      const { error: productError } = await supabase
        .from("products")
        .update({
          avg_unit_quantity: plan.newBridge.quantity,
          avg_unit_id: unitIds[plan.newBridge.unit as string],
        })
        .eq("id", target.productId);
      if (productError) {
        setError("Opslaan mislukt: " + productError.message);
        setSaving(false);
        return;
      }
    }
    const { error: priceError } = await supabase
      .from("supplier_products")
      .update({
        packaging_unit_count: plan.count,
        packaging_description: description,
        flagged_for_review: false,
      })
      .eq("id", target.priceRowId);
    if (priceError) {
      setError("Opslaan mislukt: " + priceError.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved({
      packagingUnitCount: plan.count,
      packagingDescription: description,
      avgUnitQuantity: plan.newBridge?.quantity ?? null,
    });
  }

  return (
    <Modal title={`Verpakking — ${target.productName}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Inkoopprijs per verpakking: <strong className="text-foreground">{euro(target.purchasePrice)}</strong>. Vul in
          hoeveel stuks er in één verpakking zitten en hoeveel één stuk is.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className="mb-1 block text-xs uppercase tracking-wide text-muted">Stuks per verpakking</span>
            <input type="number" step="any" value={pieces} onChange={(e) => setPieces(e.target.value)} className="input w-32" />
          </label>
          <span className="pb-2 text-muted">×</span>
          <label>
            <span className="mb-1 block text-xs uppercase tracking-wide text-muted">
              {baseIsPiece ? "Gewicht/inhoud per stuk" : "Inhoud per stuk"}
            </span>
            <input type="number" step="any" value={size} onChange={(e) => setSize(e.target.value)} className="input w-32" />
          </label>
          <label>
            <span className="mb-1 block text-xs uppercase tracking-wide text-muted">Eenheid</span>
            <select value={sizeUnit} onChange={(e) => setSizeUnit(e.target.value as UnitKey)} className="input">
              {SIZE_UNITS.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {prices && prices.perBase !== null && (
          <div className="rounded-md bg-background p-3">
            <div className="text-xs uppercase tracking-wide text-muted">Kostprijs na opslaan</div>
            <div className="mt-1 space-y-0.5">
              {prices.perPiece !== null && <div>{euro(prices.perPiece)} per stuk</div>}
              {prices.perKg !== null && <div>{euro(prices.perKg)} per kg</div>}
              {prices.perLiter !== null && <div>{euro(prices.perLiter)} per liter</div>}
              {prices.perPiece === null && prices.perKg === null && prices.perLiter === null && (
                <div>{euro(prices.perBase)} per {target.baseUnitKey}</div>
              )}
            </div>
            {baseIsPiece && sizeN > 0 && (
              <div className="mt-2 text-xs text-muted">
                In een recept kun je 1 stuk invullen ({prices.perPiece !== null ? euro(prices.perPiece) : "—"}), maar ook
                bijvoorbeeld 100 {sizeUnit}.
              </div>
            )}
          </div>
        )}

        {error && <p className="text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Annuleren
          </Button>
          <Button onClick={save} disabled={saving || !plan}>
            {saving ? "Bezig…" : "Opslaan"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

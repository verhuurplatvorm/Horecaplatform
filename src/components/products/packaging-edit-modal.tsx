"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  convert,
  convertCountToNewBase,
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
  baseUnitKey: string;
  packagingUnitCount: number;
  packagingDescription: string;
  avgUnitQuantity: number | null;
}

const SIZE_UNITS: { key: UnitKey; label: string }[] = [
  { key: "g", label: "gram" },
  { key: "kg", label: "kilo" },
  { key: "ml", label: "ml" },
  { key: "l", label: "liter" },
  { key: "stuk", label: "stuk" },
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
  const originalBase = isUnitKey(target.baseUnitKey) ? target.baseUnitKey : null;
  const [baseKey, setBaseKey] = useState<UnitKey | null>(originalBase);
  const baseIsPiece = baseKey === "stuk";

  const initial = useMemo(() => {
    const spec = parsePackaging(target.packagingDescription) ?? parsePackaging(target.productName);
    const sizeUnit: UnitKey =
      spec && ["g", "kg", "ml", "l", "stuk"].includes(spec.unit)
        ? spec.unit
        : originalBase && ["g", "ml"].includes(originalBase)
        ? originalBase
        : "g";
    return {
      pieces: spec?.packs != null && spec.perPack != null ? String(spec.packs) : "1",
      size: spec?.perPack != null ? String(spec.perPack) : spec && spec.packs == null ? String(spec.total) : "",
      sizeUnit,
    };
  }, [target, originalBase]);

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

  const baseChangedFromPiece = originalBase === "stuk";
  const piecesN = Number(pieces);
  const sizeN = Number(size);

  // Wat wordt er opgeslagen?
  const plan = useMemo(() => {
    if (!baseKey || !(piecesN > 0)) return null;
    if (sizeUnit === "stuk") {
      // "6 × 1 stuk": geen gewicht/inhoud, alleen aantallen.
      if (!baseIsPiece) return null;
      const per = sizeN > 0 ? sizeN : 1;
      return { count: piecesN * per, bridge: null, newBridge: null, clearBridge: true };
    }
    if (baseIsPiece) {
      const usedBridge: KeyBridge | null = sizeN > 0 ? { quantity: sizeN, unit: sizeUnit } : bridge;
      return { count: piecesN, bridge: usedBridge, clearBridge: false, newBridge: sizeN > 0 ? { quantity: sizeN, unit: sizeUnit } : null };
    }
    if (!(sizeN > 0)) return null;
    const count = convert(piecesN * sizeN, sizeUnit, baseKey);
    const sizeBridge: KeyBridge = { quantity: sizeN, unit: sizeUnit };
    return count === null ? null : { count, bridge: sizeBridge, clearBridge: false, newBridge: piecesN > 1 || baseChangedFromPiece ? sizeBridge : null };
  }, [baseKey, baseIsPiece, piecesN, sizeN, sizeUnit, bridge, baseChangedFromPiece]);

  const prices = plan && baseKey ? pricesFromCount(target.purchasePrice, plan.count, baseKey, plan.bridge) : null;
  const description = sizeUnit === "stuk"
    ? `${fmt(piecesN)} × ${fmt(sizeN > 0 ? sizeN : 1)} Stuks`
    : sizeN > 0
    ? `${fmt(piecesN)} × ${fmt(sizeN)} ${SIZE_UNITS.find((u) => u.key === sizeUnit)?.label === "gram" ? "Gram" : sizeUnit}`
    : `${fmt(piecesN)} × 1 Stuks`;

  async function save() {
    if (!plan || !baseKey) {
      setError(
        baseIsPiece
          ? "Vul het aantal stuks per verpakking in."
          : sizeUnit === "stuk"
          ? "Kies bij \"Ingrediënt rekent in\" de eenheid stuk."
          : "Vul aantal en inhoud in, in een eenheid die bij dit ingrediënt past (gewicht of inhoud)."
      );
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const baseChanged = baseKey !== originalBase;
    // Verandert de basiseenheid, dan moeten ook de andere leveranciersprijzen
    // van dit ingrediënt mee omgerekend worden (anders staat hun aantal in de oude eenheid).
    const otherUpdates: { id: string; count: number }[] = [];
    if (baseChanged && originalBase) {
      const { data: others } = await supabase
        .from("supplier_products")
        .select("id, packaging_unit_count")
        .eq("product_id", target.productId)
        .neq("id", target.priceRowId);
      for (const o of others ?? []) {
        const converted = convertCountToNewBase(Number(o.packaging_unit_count), originalBase, baseKey, plan.bridge);
        if (converted === null) {
          setError(
            "Dit ingrediënt heeft nog andere leveranciersprijzen die niet automatisch om te rekenen zijn. Vul eerst het gewicht per stuk in, of pas die prijzen apart aan."
          );
          setSaving(false);
          return;
        }
        otherUpdates.push({ id: o.id as string, count: converted });
      }
    }
    if (baseChanged || plan.newBridge || plan.clearBridge) {
      const patch: {
        base_unit_id?: string;
        avg_unit_quantity?: number | null;
        avg_unit_id?: string | null;
        net_unit_quantity?: number | null;
      } = {};
      if (plan.clearBridge) {
        patch.avg_unit_quantity = null;
        patch.avg_unit_id = null;
        patch.net_unit_quantity = null;
      }
      if (baseChanged && unitIds[baseKey]) patch.base_unit_id = unitIds[baseKey];
      if (plan.newBridge && unitIds[plan.newBridge.unit as string]) {
        patch.avg_unit_quantity = plan.newBridge.quantity as number;
        patch.avg_unit_id = unitIds[plan.newBridge.unit as string];
      }
      const { error: productError } = await supabase
        .from("products")
        .update(patch)
        .eq("id", target.productId);
      if (productError) {
        setError("Opslaan mislukt: " + productError.message);
        setSaving(false);
        return;
      }
    }
    for (const o of otherUpdates) {
      await supabase.from("supplier_products").update({ packaging_unit_count: o.count }).eq("id", o.id);
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
      baseUnitKey: baseKey,
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
            <select value={sizeUnit} onChange={(e) => {
                const k = e.target.value as UnitKey;
                setSizeUnit(k);
                if (k === "stuk") setBaseKey("stuk");
              }} className="input">
              {SIZE_UNITS.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-muted">
            Ingrediënt rekent in (eenheid in recepten en prijslijst)
          </span>
          <select
            value={baseKey ?? ""}
            onChange={(e) => setBaseKey(e.target.value as UnitKey)}
            className="input w-56"
          >
            {(["stuk", "g", "ml"] as UnitKey[])
              .concat(originalBase && !["stuk", "g", "ml"].includes(originalBase) ? [originalBase] : [])
              .map((k) => (
                <option key={k} value={k}>
                  {k === "stuk" ? "stuk" : k === "g" ? "gram" : k === "ml" ? "milliliter" : k}
                </option>
              ))}
          </select>
        </label>

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
            {baseIsPiece && sizeN > 0 && sizeUnit !== "stuk" && (
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

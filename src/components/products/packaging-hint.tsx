"use client";

import { useMemo } from "react";
import {
  fmt,
  pricesFromCount,
  suggestCountForDescription,
  type KeyBridge,
  type UnitKey,
} from "@/lib/packaging";

const euro = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/**
 * Controleert bij het handmatig invullen of het ingevulde verpakkingsaantal
 * past bij de omschrijving (centrale rekenmodule) en toont de prijs per
 * stuk / kg / liter. Wijzigt zelf niets: bij een afwijking staat er een
 * knop "Gebruik …" die het voorgestelde aantal invult.
 */
export function PackagingHint({
  description,
  count,
  price,
  baseUnit,
  bridge,
  onApply,
}: {
  description: string;
  count: string;
  price: string;
  baseUnit: UnitKey | null;
  bridge: KeyBridge | null;
  onApply: (count: number) => void;
}) {
  const info = useMemo(() => {
    if (!baseUnit) return null;
    const suggestion = suggestCountForDescription(description, baseUnit, bridge);
    const countNumber = Number(count);
    const priceNumber = Number(price);
    const prices =
      countNumber > 0 && priceNumber > 0 ? pricesFromCount(priceNumber, countNumber, baseUnit, bridge) : null;
    const differs =
      suggestion?.count != null &&
      countNumber > 0 &&
      Math.abs(suggestion.count - countNumber) / Math.max(suggestion.count, countNumber) > 0.01;
    return { suggestion, prices, differs };
  }, [description, count, price, baseUnit, bridge]);

  if (!info || !baseUnit) return null;
  const { suggestion, prices, differs } = info;

  return (
    <div className="mt-1 space-y-1 text-xs">
      {differs && suggestion?.count != null && (
        <p className="text-warning">
          Volgens de omschrijving ({suggestion.explanation}) hoort hier{" "}
          <strong>
            {fmt(suggestion.count)} {baseUnit}
          </strong>{" "}
          te staan, niet {fmt(Number(count))}.{" "}
          <button type="button" className="underline" onClick={() => onApply(suggestion.count as number)}>
            Gebruik {fmt(suggestion.count)}
          </button>
        </p>
      )}
      {prices && prices.perBase !== null && (
        <p className="text-muted">
          Kostprijs:{" "}
          {[
            prices.perPiece !== null && `${euro.format(prices.perPiece)} per stuk`,
            prices.perKg !== null && `${euro.format(prices.perKg)} per kg`,
            prices.perLiter !== null && `${euro.format(prices.perLiter)} per liter`,
          ]
            .filter(Boolean)
            .join(" · ") || `${euro.format(prices.perBase)} per ${baseUnit}`}
        </p>
      )}
    </div>
  );
}

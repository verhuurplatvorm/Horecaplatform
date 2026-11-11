"use client";

import { useState } from "react";
import type { Unit } from "@/lib/types/database";
import {
  PARTY_CONTAINERS,
  PORTION_PRESETS,
  containerInfo,
  containerLabel,
  formatDistribution,
  personsPerContainer,
  planParty,
  recipePerContainer,
} from "@/lib/party/party-calc";

export type PartySettingsValue = {
  container: string;
  capacity: string;
  capacityUnitId: string;
  portion: string;
  full: boolean;
};

const euro = (n: number) =>
  `€ ${n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) =>
  n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

/**
 * Partij-instellingen van een gerecht in de map Partijgerechten.
 * Het recept = één standaardvorm (incl. garnering); capaciteit = het
 * hoofdproduct per vorm (bijv. 1200 g carpaccio).
 */
export function PartySettings({
  value,
  onChange,
  units,
  totalCost,
  totalWeight,
  totalWeightUnitKey,
  capacityAuto = false,
  capacityFromTotal = null,
  onCapacityAuto,
}: {
  value: PartySettingsValue;
  onChange: (v: PartySettingsValue) => void;
  units: Unit[];
  /** Kostprijs van het recept = één standaardvorm */
  totalCost: number;
  /** Totaalgewicht (opbrengst) van één vorm incl. garnering */
  totalWeight: number;
  totalWeightUnitKey: string | null;
  /** Hoofdproduct volgt nu automatisch het totaalgewicht. */
  capacityAuto?: boolean;
  capacityFromTotal?: number | null;
  onCapacityAuto?: () => void;
}) {
  const [guests, setGuests] = useState("50");
  const [pct, setPct] = useState("100");
  const set = (patch: Partial<PartySettingsValue>) =>
    onChange({ ...value, ...patch });

  const capUnit = units.find((u) => u.id === value.capacityUnitId);
  const capUnitKey = capUnit?.key ?? "g";
  const capacity = Number(value.capacity) || 0;
  const portion = Number(value.portion) || 0;
  const perContainer = personsPerContainer(capacity, portion);
  const custom =
    portion > 0 &&
    !PORTION_PRESETS.includes(portion as (typeof PORTION_PRESETS)[number]);
  const vorm = containerInfo(value.container);

  // Controles op onlogische invoer (meestal een eenheid-vergissing).
  const totalInCapUnit =
    totalWeight > 0 && totalWeightUnitKey
      ? ({ g: 1, kg: 1000, ml: 1, l: 1000 }[totalWeightUnitKey as "g"] ?? 0) *
        totalWeight
      : 0;
  const perRecipe =
    capUnitKey !== "stuk" ? recipePerContainer(capacity, totalInCapUnit) : 1;
  const costPerContainer = totalCost * perRecipe;
  const plan = planParty({
    guests: Number(guests) || 0,
    portion,
    capacity,
    participationPct: Number(pct) || 0,
    fullContainers: value.full,
    perContainer: perRecipe,
  });
  let capacityWarning: string | null = null;
  if (capacity > 0 && portion > 0 && capacity < portion) {
    capacityWarning = `Hoofdproduct per ${vorm.label.toLowerCase()} (${num(capacity)} ${capUnitKey}) is kleiner dan één portie. Vul het in ${capUnit?.name ?? "gram"} in, bijv. 2400 voor 2,4 kg.`;
  }

  // Kosten per kg / liter op basis van het totaalgewicht van één vorm.
  let perKiloLabel: string | null = null;
  let perKilo: number | null = null;
  if (totalCost > 0 && totalWeight > 0 && totalWeightUnitKey) {
    const factor = { g: 1000, kg: 1, ml: 1000, l: 1 }[
      totalWeightUnitKey as "g"
    ];
    if (factor) {
      perKilo = (totalCost / totalWeight) * factor;
      perKiloLabel =
        totalWeightUnitKey === "g" || totalWeightUnitKey === "kg"
          ? "kg"
          : "liter";
    }
  }

  const label =
    "mb-1 block text-xs font-medium uppercase tracking-wide text-muted";
  const active = "border-teal bg-teal/10 text-teal";
  const idle = "border-border text-muted hover:border-teal/50";

  return (
    <div className="col-span-full space-y-4 rounded-md border border-teal/30 bg-teal/5 p-4">
      <p className="text-sm font-semibold">Partij-instellingen</p>

      {/* Rij 1: vorm, capaciteit, portie, personen per vorm */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,0.7fr)]">
        <div>
          <span className={label}>Productievorm</span>
          <select
            value={value.container}
            onChange={(e) => {
              const next = containerInfo(e.target.value);
              const unit = units.find((u) => u.key === next.unit);
              set({
                container: next.key,
                capacityUnitId:
                  capUnit && capUnit.dimension === unit?.dimension
                    ? value.capacityUnitId
                    : (unit?.id ?? ""),
              });
            }}
            className="input w-full"
          >
            {PARTY_CONTAINERS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className={label}>
            Hoofdproduct per {vorm.label.toLowerCase()}
          </span>
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              step="any"
              value={value.capacity}
              onChange={(e) => set({ capacity: e.target.value })}
              className={`input min-w-0 flex-1 ${capacity > 0 ? "" : "border-copper!"}`}
              placeholder="bijv. 1200"
            />
            <select
              value={value.capacityUnitId}
              onChange={(e) => set({ capacityUnitId: e.target.value })}
              className="input w-24!"
            >
              {units
                // Altijd in de kleine eenheid, zodat de portie p.p. ook in
                // gram/ml/stuks is (geen 60 kilo per persoon).
                .filter((u) => ["g", "ml", "stuk"].includes(u.key))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </div>
          {capacity >= 1000 && (capUnitKey === "g" || capUnitKey === "ml") && (
            <p className="mt-1 text-xs text-muted">
              = {num(capacity / 1000)} {capUnitKey === "g" ? "kg" : "liter"}
            </p>
          )}
          {capacityWarning && (
            <p className="mt-1 rounded bg-copper/10 px-2 py-1 text-xs text-copper">
              {capacityWarning}
            </p>
          )}
          {capacityAuto ? (
            <p className="mt-1 text-xs text-muted">
              Automatisch = totaalgewicht. Pas aan als de garnering niet
              meetelt.
            </p>
          ) : capacityFromTotal !== null && onCapacityAuto ? (
            <button
              type="button"
              onClick={onCapacityAuto}
              className="mt-1 text-xs text-teal underline"
            >
              = totaalgewicht ({num(capacityFromTotal)} {capUnitKey})
            </button>
          ) : null}
        </div>
        <div>
          <span className={label}>
            Portie per persoon ({capUnit?.name ?? "gram"})
          </span>
          <div className="flex items-center gap-1">
            {PORTION_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set({ portion: String(p) })}
                className={`h-10 w-11 rounded-md border text-sm tabular ${portion === p ? active : idle}`}
              >
                {p}
              </button>
            ))}
            <input
              type="number"
              min="0"
              step="any"
              value={value.portion}
              onChange={(e) => set({ portion: e.target.value })}
              className={`input w-20! text-center ${custom ? "border-teal!" : ""}`}
              title="Eigen portie"
              placeholder="eigen"
            />
          </div>
        </div>
        <div>
          <span className={label}>Personen per {vorm.label.toLowerCase()}</span>
          <p className="flex h-10 items-center text-lg font-semibold tabular">
            {perContainer !== null ? (
              num(perContainer)
            ) : (
              <span className="text-sm font-normal text-copper">vul in</span>
            )}
          </p>
        </div>
      </div>

      {/* Rij 2: afronding */}
      <div>
        <span className={label}>Afronding</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:w-2/3">
          <button
            type="button"
            onClick={() => set({ full: true })}
            className={`h-10 rounded-md border px-3 text-sm ${value.full ? active : idle}`}
          >
            A. Volle {vorm.plural} (standaard)
          </button>
          <button
            type="button"
            onClick={() => set({ full: false })}
            className={`h-10 rounded-md border px-3 text-sm ${!value.full ? active : idle}`}
          >
            B. Laatste {vorm.label.toLowerCase()} aanpassen
          </button>
        </div>
      </div>

      {/* Rij 3: kosten */}
      <div className="grid grid-cols-2 gap-4 border-t border-teal/20 pt-3 lg:grid-cols-4">
        <div>
          <span className={label}>Kosten per {vorm.label.toLowerCase()}</span>
          <p className="tabular text-base font-semibold">
            {totalCost > 0 ? euro(costPerContainer) : "—"}
          </p>
          {perRecipe > 1 && (
            <p className="text-xs text-muted">
              = recept × {num(perRecipe)} (recept {num(totalInCapUnit)}{" "}
              {capUnitKey}, {vorm.label.toLowerCase()} {num(capacity)}{" "}
              {capUnitKey})
            </p>
          )}
        </div>
        <div>
          <span className={label}>Per {perKiloLabel ?? "kg / liter"}</span>
          <p className="tabular text-base font-semibold">
            {perKilo !== null ? euro(perKilo) : "—"}
          </p>
        </div>
        <div>
          <span className={label}>Per standaardportie</span>
          <p className="tabular text-base font-semibold">
            {perContainer && totalCost > 0
              ? euro(costPerContainer / perContainer)
              : "—"}
          </p>
        </div>
        <div>
          <span className={label}>Verkoopprijs</span>
          <p className="text-sm text-muted">
            Niet hier — marge staat op menu/buffet
          </p>
        </div>
      </div>

      {/* Rij 4: rekenvoorbeeld */}
      <div className="rounded-md border border-border bg-surface p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Rekenvoorbeeld</span>
          <input
            type="number"
            min="0"
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
            className="input w-20! text-right"
          />
          <span>gasten ×</span>
          <input
            type="number"
            min="0"
            max="100"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="input w-20! text-right"
          />
          <span>% deelname</span>
        </div>
        {plan && plan.containers > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div>
              <span className={label}>Netto nodig</span>
              <p className="tabular font-semibold">
                {num(plan.needed)} {capUnitKey}
              </p>
            </div>
            <div>
              <span className={label}>Aantal</span>
              <p className="tabular font-semibold">
                {plan.containers}{" "}
                {containerLabel(value.container, plan.containers)}
              </p>
            </div>
            <div>
              <span className={label}>Verdeling</span>
              <p className="tabular">
                {formatDistribution(plan.distribution, capUnitKey)}
              </p>
            </div>
            <div>
              <span className={label}>Over</span>
              <p className="tabular">
                {num(plan.difference)} {capUnitKey}
              </p>
            </div>
            <div>
              <span className={label}>Kosten</span>
              <p className="tabular font-semibold">
                {totalCost > 0 ? euro(totalCost * plan.recipeFactor) : "—"}
              </p>
              {totalCost > 0 && plan.difference > 0 && (
                <p className="text-xs text-muted">
                  waarvan over{" "}
                  {euro((costPerContainer * plan.difference) / capacity)}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-muted">
            Vul hoofdproduct per vorm en portie in om te rekenen.
          </p>
        )}
      </div>
    </div>
  );
}

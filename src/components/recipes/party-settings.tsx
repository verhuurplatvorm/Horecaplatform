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
}: {
  value: PartySettingsValue;
  onChange: (v: PartySettingsValue) => void;
  units: Unit[];
  /** Kostprijs van het recept = één standaardvorm */
  totalCost: number;
  /** Totaalgewicht (opbrengst) van één vorm incl. garnering */
  totalWeight: number;
  totalWeightUnitKey: string | null;
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
  const plan = planParty({
    guests: Number(guests) || 0,
    portion,
    capacity,
    participationPct: Number(pct) || 0,
    fullContainers: value.full,
  });
  const vorm = containerInfo(value.container);

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

  return (
    <div className="space-y-3 rounded-md border border-teal/30 bg-teal/5 p-3 sm:col-span-2">
      <p className="text-sm font-medium">Partij-instellingen</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted">Productievorm</span>
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
            className="input"
          >
            {PARTY_CONTAINERS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">
            Hoofdproduct per {vorm.label.toLowerCase()}
          </span>
          <span className="flex gap-1">
            <input
              type="number"
              min="0"
              step="any"
              value={value.capacity}
              onChange={(e) => set({ capacity: e.target.value })}
              className="input w-24!"
              placeholder="1200"
            />
            <select
              value={value.capacityUnitId}
              onChange={(e) => set({ capacityUnitId: e.target.value })}
              className="input w-24!"
            >
              {units
                .filter((u) => ["g", "kg", "ml", "l", "stuk"].includes(u.key))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </span>
        </label>
        <div className="text-sm">
          <span className="mb-1 block text-muted">
            Standaardportie per persoon
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {PORTION_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set({ portion: String(p) })}
                className={`rounded border px-2 py-1 text-xs ${portion === p ? "border-teal bg-teal/10 text-teal" : "border-border text-muted"}`}
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
              className={`input h-7! w-16! text-xs ${custom ? "border-teal" : ""}`}
              title="Eigen portie"
            />
            <span className="text-xs text-muted">{capUnit?.name ?? ""}</span>
          </div>
        </div>
      </div>

      <p className="text-sm">
        {perContainer !== null ? (
          <>
            1 {vorm.label.toLowerCase()} ={" "}
            <strong>{num(perContainer)} personen</strong> bij {num(portion)}{" "}
            {capUnitKey} p.p.
          </>
        ) : (
          <span className="text-muted">
            Vul hoofdproduct per vorm en standaardportie in.
          </span>
        )}
      </p>

      <div className="flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          onClick={() => set({ full: true })}
          className={`rounded-md border px-3 py-1.5 ${value.full ? "border-teal bg-teal/10 text-teal" : "border-border text-muted"}`}
        >
          A. Volle {vorm.plural} (standaard)
        </button>
        <button
          type="button"
          onClick={() => set({ full: false })}
          className={`rounded-md border px-3 py-1.5 ${!value.full ? "border-teal bg-teal/10 text-teal" : "border-border text-muted"}`}
        >
          B. Laatste {vorm.label.toLowerCase()} aanpassen
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted">
            Kosten per {vorm.label.toLowerCase()}
          </p>
          <p className="tabular font-medium">
            {totalCost > 0 ? euro(totalCost) : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">
            Per {perKiloLabel ?? "kg / liter"}
          </p>
          <p className="tabular font-medium">
            {perKilo !== null ? euro(perKilo) : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Per standaardportie</p>
          <p className="tabular font-medium">
            {perContainer && totalCost > 0
              ? euro(totalCost / perContainer)
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Geen verkoopprijs</p>
          <p className="text-xs text-muted">Marge staat op menu/buffet</p>
        </div>
      </div>

      <div className="rounded border border-border bg-surface p-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">Rekenvoorbeeld:</span>
          <input
            type="number"
            min="0"
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
            className="input h-7! w-20!"
          />
          <span>gasten ×</span>
          <input
            type="number"
            min="0"
            max="100"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="input h-7! w-16!"
          />
          <span>% deelname</span>
        </div>
        {plan && plan.containers > 0 && (
          <p className="mt-1">
            Netto nodig{" "}
            <strong>
              {num(plan.needed)} {capUnitKey}
            </strong>{" "}
            →{" "}
            <strong>
              {plan.containers}{" "}
              {containerLabel(value.container, plan.containers)}
            </strong>{" "}
            ({formatDistribution(plan.distribution, capUnitKey)}) · capaciteit{" "}
            {num(plan.containers * capacity)} {capUnitKey} · verschil{" "}
            {num(plan.containers * capacity - plan.needed)} {capUnitKey}
            {totalCost > 0 && (
              <>
                {" "}
                · kosten {euro(totalCost * plan.recipeFactor)}
                {plan.difference > 0 && (
                  <>
                    {" "}
                    (waarvan overproductie{" "}
                    {euro((totalCost * plan.difference) / capacity)})
                  </>
                )}
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { chargeAmount } from "@/lib/menus/sales";
import type { EventMenuCharge } from "@/lib/types/database";

const euro = (n: number) => n.toLocaleString("nl-NL", { style: "currency", currency: "EUR" });

/** "40:150, 100:250, *:300" ⇄ staffel. */
export function formatTiers(t: EventMenuCharge["tiers"]): string {
  return (t ?? []).map((x) => `${x.tot ?? "*"}:${x.bedrag}`).join(", ");
}
export function parseTiers(s: string): EventMenuCharge["tiers"] {
  return s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [a, b] = p.split(":").map((x) => x.trim().replace(",", "."));
      return { tot: a === "*" || a === "" ? null : Number(a), bedrag: Number(b) };
    })
    .filter((x) => Number.isFinite(x.bedrag) && (x.tot === null || Number.isFinite(x.tot)));
}

/**
 * Toeslagen bij een menu/arrangement: drankenarrangement p.p., kok bij de
 * BBQ (staffel), tv-scherm of podium (vast). Tellen mee in de omzet, niet in
 * de foodcost. Bedragen incl. btw.
 */
export function MenuCharges({
  menuId,
  charges,
  personCount,
  onChanged,
  readOnly,
}: {
  menuId: string;
  charges: EventMenuCharge[];
  personCount: number;
  onChanged: (next: EventMenuCharge[]) => void;
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function patch(id: string, p: Partial<EventMenuCharge>) {
    onChanged(charges.map((c) => (c.id === id ? { ...c, ...p } : c)));
    const { error } = await createClient().from("event_menu_charges").update(p).eq("id", id);
    if (error) window.alert("Opslaan mislukt: " + error.message);
  }

  async function add() {
    setBusy(true);
    const { data, error } = await createClient()
      .from("event_menu_charges")
      .insert({ menu_id: menuId, name: "Drankenarrangement 3 uur", kind: "per_persoon", amount: 0, vat_rate: 21, sort_order: charges.length })
      .select()
      .single();
    setBusy(false);
    if (error || !data) return window.alert("Toevoegen mislukt: " + (error?.message ?? ""));
    onChanged([...charges, data as EventMenuCharge]);
  }

  async function remove(c: EventMenuCharge) {
    if (!window.confirm(`Toeslag "${c.name}" verwijderen?`)) return;
    const { error } = await createClient().from("event_menu_charges").delete().eq("id", c.id);
    if (error) return window.alert("Verwijderen mislukt: " + error.message);
    onChanged(charges.filter((x) => x.id !== c.id));
  }

  const input = "rounded border border-border bg-surface px-2 py-1 text-sm";
  return (
    <div className="space-y-2">
      {charges.length === 0 && (
        <p className="text-xs text-muted">
          Nog geen toeslagen. Bijvoorbeeld een drankenarrangement per persoon, kok bij de BBQ (staffel)
          of een tv-scherm (vast bedrag).
        </p>
      )}
      {charges.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-2 border-b border-border pb-2 last:border-b-0">
          <input
            type="checkbox"
            checked={c.is_selected}
            disabled={readOnly}
            onChange={(e) => void patch(c.id, { is_selected: e.target.checked })}
            title="Gekozen voor deze boeking"
          />
          <input
            defaultValue={c.name}
            disabled={readOnly}
            onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && void patch(c.id, { name: e.target.value.trim() })}
            className={`${input} min-w-48 flex-1`}
          />
          <select
            value={c.kind}
            disabled={readOnly}
            onChange={(e) => void patch(c.id, { kind: e.target.value as EventMenuCharge["kind"] })}
            className={input}
          >
            <option value="per_persoon">per persoon</option>
            <option value="vast">vast bedrag</option>
            <option value="staffel">staffel (aantal gasten)</option>
          </select>
          {c.kind === "staffel" ? (
            <input
              key={`t-${c.id}-${formatTiers(c.tiers)}`}
              defaultValue={formatTiers(c.tiers)}
              disabled={readOnly}
              placeholder="40:150, 100:250, *:300"
              title="t/m aantal gasten : bedrag — * = daarboven"
              onBlur={(e) => void patch(c.id, { tiers: parseTiers(e.target.value) })}
              className={`${input} w-52`}
            />
          ) : (
            <input
              key={`a-${c.id}-${c.amount}`}
              type="number"
              step="0.01"
              defaultValue={c.amount}
              disabled={readOnly}
              onBlur={(e) => void patch(c.id, { amount: Number(e.target.value) || 0 })}
              className={`${input} w-24 text-right tabular`}
            />
          )}
          <select
            value={String(c.vat_rate)}
            disabled={readOnly}
            onChange={(e) => void patch(c.id, { vat_rate: Number(e.target.value) })}
            className={input}
            title="Btw"
          >
            <option value="9">9%</option>
            <option value="21">21%</option>
            <option value="0">0%</option>
          </select>
          <span className="w-24 text-right text-sm tabular">{euro(chargeAmount(c, personCount))}</span>
          {!readOnly && (
            <button type="button" onClick={() => void remove(c)} title="Verwijderen">
              <Trash2 className="h-4 w-4 text-muted hover:text-danger" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void add()}>
          <Plus className="h-3.5 w-3.5" /> Toeslag toevoegen
        </Button>
      )}
      <p className="text-xs text-muted">
        Staffel invullen als <code>40:150, 100:250, *:300</code> (t/m 40 gasten € 150, t/m 100 € 250,
        daarboven € 300). Bedragen incl. btw; toeslagen tellen niet mee in de foodcost.
      </p>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MenuItemSearch } from "@/components/menus/menu-item-search";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { EventMenu, EventMenuActualRow, Unit } from "@/lib/types/database";

export interface PlannedLine {
  line_id: string;
  section_name: string;
  display_name: string;
  line_type: string;
  is_fixed: boolean;
  total_quantity: number;
  unit_name: string | null;
  unit_price: number | null;
  total_cost: number | null;
}

const eur = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `€ ${n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number | null | undefined) =>
  n == null ? "" : n.toLocaleString("nl-NL", { maximumFractionDigits: 3 });

/**
 * Nacalculatie: wat er werkelijk is gebruikt (totaal, niet per persoon) per
 * geplande regel, plus extra gebruikte gerechten/ingrediënten. Kostprijzen
 * komen uit dezelfde bronnen als de voorcalculatie (actuele inkoopprijzen).
 */
export function MenuNacalculatie({
  menu,
  lines,
  referenceCompanyId,
  canViewFinancial,
  units,
  onSaveMenu,
}: {
  menu: EventMenu;
  lines: PlannedLine[];
  referenceCompanyId: string | null;
  canViewFinancial: boolean;
  units: Unit[];
  onSaveMenu: (patch: Partial<EventMenu>) => Promise<void> | void;
}) {
  const [refs, setRefs] = useState<
    Map<
      string,
      {
        recipe_id: string | null;
        product_id: string | null;
        unit_id: string | null;
      }
    >
  >(new Map());
  const [actuals, setActuals] = useState<EventMenuActualRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [persons, setPersons] = useState<string>(
    menu.actual_person_count?.toString() ?? "",
  );
  const [notes, setNotes] = useState(menu.actual_notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: l }, a] = await Promise.all([
      supabase
        .from("event_menu_lines")
        .select("id, recipe_id, product_id, unit_id")
        .eq("menu_id", menu.id),
      referenceCompanyId
        ? supabase.rpc("get_event_menu_actuals", {
            p_menu_id: menu.id,
            p_company_id: referenceCompanyId,
          })
        : Promise.resolve({ data: [] as EventMenuActualRow[], error: null }),
    ]);
    setRefs(
      new Map(
        (l ?? []).map((x) => [
          x.id as string,
          {
            recipe_id: x.recipe_id,
            product_id: x.product_id,
            unit_id: x.unit_id,
          },
        ]),
      ),
    );
    if (a.error) setError(a.error.message);
    setActuals((a.data as EventMenuActualRow[]) ?? []);
  }, [menu.id, referenceCompanyId]);

  useEffect(() => {
    // load() zet pas state nadat de gegevens binnen zijn.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const byLine = useMemo(
    () => new Map(actuals.filter((a) => a.line_id).map((a) => [a.line_id!, a])),
    [actuals],
  );
  const extras = actuals.filter((a) => !a.line_id);
  const unitName = (id: string | null) =>
    units.find((u) => u.id === id)?.name ?? "";

  async function saveLine(line: PlannedLine, value: string) {
    const ref = refs.get(line.line_id);
    const existing = byLine.get(line.line_id);
    const supabase = createClient();
    setError(null);
    const v = value.trim() === "" ? null : Number(value.replace(",", "."));
    if (v !== null && (!Number.isFinite(v) || v < 0)) return;
    let err;
    if (v === null) {
      if (!existing) return;
      ({ error: err } = await supabase
        .from("event_menu_actuals")
        .delete()
        .eq("id", existing.actual_id));
    } else if (existing) {
      if (Number(existing.quantity_total) === v) return;
      ({ error: err } = await supabase
        .from("event_menu_actuals")
        .update({ quantity_total: v, updated_at: new Date().toISOString() })
        .eq("id", existing.actual_id));
    } else {
      ({ error: err } = await supabase.from("event_menu_actuals").insert({
        menu_id: menu.id,
        line_id: line.line_id,
        recipe_id: ref?.recipe_id ?? null,
        product_id: ref?.product_id ?? null,
        unit_id: ref?.unit_id ?? null,
        quantity_total: v,
      }));
    }
    if (err) setError(err.message);
    await load();
  }

  async function copyPlanned() {
    const factor =
      Number(persons) > 0 && menu.person_count > 0
        ? Number(persons) / menu.person_count
        : 1;
    const todo = lines.filter((l) => !byLine.has(l.line_id));
    if (todo.length === 0) return;
    setBusy(true);
    const rows = todo.map((l) => {
      const ref = refs.get(l.line_id);
      const q = l.is_fixed ? l.total_quantity : l.total_quantity * factor;
      return {
        menu_id: menu.id,
        line_id: l.line_id,
        recipe_id: ref?.recipe_id ?? null,
        product_id: ref?.product_id ?? null,
        unit_id: ref?.unit_id ?? null,
        quantity_total: Math.round(q * 1000) / 1000,
      };
    });
    const { error: err } = await createClient()
      .from("event_menu_actuals")
      .insert(rows);
    setBusy(false);
    if (err) setError(err.message);
    await load();
  }

  async function addExtra(hit: {
    kind: string;
    id: string;
    baseUnitId: string | null;
  }) {
    const stuk = units.find((u) => u.key === "stuk")?.id ?? null;
    const { error: err } = await createClient()
      .from("event_menu_actuals")
      .insert({
        menu_id: menu.id,
        recipe_id: hit.kind === "ingrediënt" ? null : hit.id,
        product_id: hit.kind === "ingrediënt" ? hit.id : null,
        unit_id: hit.kind === "gerecht" ? stuk : (hit.baseUnitId ?? stuk),
        quantity_total: 1,
        sort_order: extras.length + 1,
      });
    if (err) setError(err.message);
    await load();
  }

  async function updateExtra(
    a: EventMenuActualRow,
    patch: {
      quantity_total?: number;
      unit_id?: string | null;
      note?: string | null;
    },
  ) {
    const { error: err } = await createClient()
      .from("event_menu_actuals")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", a.actual_id);
    if (err) setError(err.message);
    await load();
  }

  async function removeExtra(a: EventMenuActualRow) {
    await createClient()
      .from("event_menu_actuals")
      .delete()
      .eq("id", a.actual_id);
    await load();
  }

  // ---------- totalen ----------
  const plannedVariable = lines.reduce((s, l) => s + (l.total_cost ?? 0), 0);
  let actualVariable = 0;
  let assumed = 0;
  let missingPrice = 0;
  for (const l of lines) {
    const a = byLine.get(l.line_id);
    if (a) {
      if (a.total_cost == null && Number(a.quantity_total) > 0) missingPrice++;
      actualVariable += a.total_cost ?? 0;
    } else {
      assumed++;
      actualVariable += l.total_cost ?? 0;
    }
  }
  for (const e of extras) {
    if (e.total_cost == null && Number(e.quantity_total) > 0) missingPrice++;
    actualVariable += e.total_cost ?? 0;
  }
  const fixed = menu.fixed_costs ?? 0;
  const plannedTotal = plannedVariable + fixed;
  const actualTotal = actualVariable + fixed;
  const actualPersons =
    Number(persons) > 0 ? Number(persons) : menu.person_count;
  const plannedPp =
    menu.person_count > 0 ? plannedTotal / menu.person_count : null;
  const actualPp = actualPersons > 0 ? actualTotal / actualPersons : null;
  const salesExcl = menu.sales_price_per_person
    ? menu.sales_price_per_person / (1 + menu.vat_rate / 100)
    : null;
  const fcPlanned =
    salesExcl && plannedPp != null ? (plannedPp / salesExcl) * 100 : null;
  const fcActual =
    salesExcl && actualPp != null ? (actualPp / salesExcl) * 100 : null;

  const sectionGroups: [string, PlannedLine[]][] = [];
  for (const l of lines) {
    const last = sectionGroups[sectionGroups.length - 1];
    if (last && last[0] === l.section_name) last[1].push(l);
    else sectionGroups.push([l.section_name, [l]]);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Nacalculatie</CardTitle>
          {menu.actual_recorded_at ? (
            <span className="flex items-center gap-1 text-sm text-teal">
              <CheckCircle2 className="h-4 w-4" /> Afgerond op{" "}
              {new Date(menu.actual_recorded_at).toLocaleDateString("nl-NL")}
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <label className="text-sm">
            <span className="mb-1 block font-medium">
              Werkelijk aantal personen
            </span>
            <input
              type="number"
              min="0"
              value={persons}
              placeholder={String(menu.person_count)}
              onChange={(e) => setPersons(e.target.value)}
              onBlur={() =>
                void onSaveMenu({
                  actual_person_count: persons ? Number(persons) : null,
                })
              }
              className="input w-32!"
            />
            <span className="mt-1 block text-xs text-muted">
              gepland: {menu.person_count}
            </span>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Opmerkingen</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => void onSaveMenu({ actual_notes: notes || null })}
              placeholder="bv. 20 personen later, extra brood ingekocht"
              className="input"
            />
          </label>
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Werkelijk gebruikt — geplande regels</CardTitle>
          {assumed > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void copyPlanned()}
              disabled={busy}
            >
              <Copy className="h-3.5 w-3.5" />
              Gepland overnemen
              {Number(persons) > 0 && Number(persons) !== menu.person_count
                ? ` (× ${persons}/${menu.person_count} personen)`
                : ""}{" "}
              voor {assumed} lege regels
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <p className="px-4 pb-2 text-xs text-muted">
            Vul per regel de <strong>totale</strong> hoeveelheid in die echt is
            gebruikt (gerechten in porties). Leeg = nog niet ingevuld; telt dan
            mee als gepland.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Naam</th>
                  <th className="px-2 py-2 text-right font-medium">Gepland</th>
                  <th className="px-2 py-2 text-right font-medium">
                    Werkelijk
                  </th>
                  <th className="px-2 py-2 font-medium">Eenheid</th>
                  {canViewFinancial && (
                    <>
                      <th className="px-2 py-2 text-right font-medium">
                        Kosten gepland
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Kosten werkelijk
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Verschil
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {sectionGroups.map(([section, group]) => (
                  <FragmentGroup
                    key={section}
                    title={section}
                    cols={canViewFinancial ? 7 : 4}
                  >
                    {group.map((l) => {
                      const a = byLine.get(l.line_id);
                      const draft = drafts[l.line_id];
                      const shown =
                        draft ?? (a ? String(Number(a.quantity_total)) : "");
                      const cost = a ? a.total_cost : null;
                      const diff =
                        a && cost != null && l.total_cost != null
                          ? cost - l.total_cost
                          : null;
                      return (
                        <tr key={l.line_id} className="border-t border-border">
                          <td className="px-4 py-1.5 pl-8">
                            {l.display_name}
                            <span className="ml-1 text-xs text-muted">
                              {l.line_type}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular text-muted">
                            {num(l.total_quantity)}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={shown}
                              placeholder={num(l.total_quantity)}
                              onChange={(e) =>
                                setDrafts((d) => ({
                                  ...d,
                                  [l.line_id]: e.target.value,
                                }))
                              }
                              onBlur={async (e) => {
                                await saveLine(l, e.target.value);
                                setDrafts((d) => {
                                  const n = { ...d };
                                  delete n[l.line_id];
                                  return n;
                                });
                              }}
                              className={cn(
                                "input h-8! w-24! text-right",
                                !a && "border-dashed!",
                              )}
                            />
                          </td>
                          <td className="px-2 py-1.5 text-muted">
                            {l.unit_name}
                          </td>
                          {canViewFinancial && (
                            <>
                              <td className="px-2 py-1.5 text-right tabular text-muted">
                                {eur(l.total_cost)}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular">
                                {a ? (
                                  cost == null ? (
                                    <span className="text-copper">
                                      geen prijs
                                    </span>
                                  ) : (
                                    eur(cost)
                                  )
                                ) : (
                                  <span className="text-muted">= gepland</span>
                                )}
                              </td>
                              <td
                                className={cn(
                                  "px-4 py-1.5 text-right tabular",
                                  diff != null && diff > 0.005 && "text-danger",
                                  diff != null &&
                                    diff < -0.005 &&
                                    "text-success",
                                )}
                              >
                                {diff == null
                                  ? ""
                                  : `${diff > 0 ? "+" : ""}${eur(diff)}`}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </FragmentGroup>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-4 text-muted">
                      Dit menu heeft nog geen regels.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Extra gebruikt (niet gepland)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-w-md">
            <MenuItemSearch
              placeholder="Gerecht, halfproduct of ingrediënt toevoegen…"
              onPick={(h) => void addExtra(h)}
            />
          </div>
          {extras.length > 0 && (
            <table className="w-full text-sm">
              <tbody>
                {extras.map((e) => (
                  <tr key={e.actual_id} className="border-t border-border">
                    <td className="py-1.5 pr-2">
                      {e.display_name}{" "}
                      <span className="text-xs text-muted">{e.line_type}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        defaultValue={Number(e.quantity_total)}
                        onBlur={(ev) => {
                          const v = Number(ev.target.value.replace(",", "."));
                          if (
                            Number.isFinite(v) &&
                            v >= 0 &&
                            v !== Number(e.quantity_total)
                          )
                            void updateExtra(e, { quantity_total: v });
                        }}
                        className="input h-8! w-24! text-right"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <select
                        value={e.unit_id ?? ""}
                        onChange={(ev) =>
                          void updateExtra(e, {
                            unit_id: ev.target.value || null,
                          })
                        }
                        className="input h-8! w-32!"
                      >
                        {units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.key === "stuk" ? "portie/stuk" : u.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        defaultValue={e.note ?? ""}
                        placeholder="waarom?"
                        onBlur={(ev) => {
                          const v = ev.target.value.trim() || null;
                          if (v !== (e.note ?? null))
                            void updateExtra(e, { note: v });
                        }}
                        className="input h-8! text-xs"
                      />
                    </td>
                    {canViewFinancial && (
                      <td className="py-1.5 pr-2 text-right tabular">
                        {e.total_cost == null ? (
                          <span className="text-copper">
                            geen prijs ({unitName(e.unit_id)})
                          </span>
                        ) : (
                          eur(e.total_cost)
                        )}
                      </td>
                    )}
                    <td className="py-1.5 text-right">
                      <button
                        onClick={() => void removeExtra(e)}
                        className="rounded p-1 text-muted hover:text-danger"
                        aria-label="Verwijderen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {canViewFinancial && (
        <Card>
          <CardHeader>
            <CardTitle>Voorcalculatie ↔ nacalculatie</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <table className="w-full max-w-2xl text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-1 font-medium"></th>
                  <th className="py-1 text-right font-medium">Gepland</th>
                  <th className="py-1 text-right font-medium">Werkelijk</th>
                  <th className="py-1 text-right font-medium">Verschil</th>
                </tr>
              </thead>
              <tbody className="tabular">
                <CompareRow
                  label="Personen"
                  a={menu.person_count}
                  b={actualPersons}
                  fmt={(n) => (n == null ? "—" : String(n))}
                  neutral
                />
                <CompareRow
                  label="Inkoop (gerechten + ingrediënten)"
                  a={plannedVariable}
                  b={actualVariable}
                  fmt={eur}
                />
                <CompareRow
                  label="Vaste kosten"
                  a={fixed}
                  b={fixed}
                  fmt={eur}
                />
                <CompareRow
                  label="Totale kostprijs"
                  a={plannedTotal}
                  b={actualTotal}
                  fmt={eur}
                  strong
                />
                <CompareRow
                  label="Kostprijs per persoon"
                  a={plannedPp}
                  b={actualPp}
                  fmt={eur}
                  strong
                />
                {fcPlanned != null && (
                  <CompareRow
                    label="Foodcost %"
                    a={fcPlanned}
                    b={fcActual}
                    fmt={(n) => (n == null ? "—" : `${n.toFixed(1)}%`)}
                  />
                )}
              </tbody>
            </table>
            {(assumed > 0 || missingPrice > 0) && (
              <p className="flex items-start gap-2 rounded-md bg-copper/10 px-3 py-2 text-sm text-copper">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {assumed > 0 &&
                    `${assumed} geplande regel(s) nog niet ingevuld — die tellen mee als gepland. `}
                  {missingPrice > 0 &&
                    `${missingPrice} regel(s) zonder prijs of met een eenheid die niet om te rekenen is — die tellen niet mee.`}
                </span>
              </p>
            )}
            <p className="text-xs text-muted">
              Prijzen: de actuele inkoopprijzen (dezelfde als de
              voorcalculatie), dus inclusief de laatste prijswijzigingen van
              leveranciers.
            </p>
            {!menu.actual_recorded_at ? (
              <Button
                onClick={async () => {
                  const { data } = await createClient().auth.getUser();
                  await onSaveMenu({
                    actual_recorded_at: new Date().toISOString(),
                    actual_recorded_by: data.user?.id ?? null,
                    actual_person_count: persons
                      ? Number(persons)
                      : menu.person_count,
                    status: "uitgevoerd",
                  });
                }}
              >
                <CheckCircle2 className="h-4 w-4" /> Nacalculatie afronden
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() =>
                  void onSaveMenu({
                    actual_recorded_at: null,
                    actual_recorded_by: null,
                  })
                }
              >
                Afronding ongedaan maken
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FragmentGroup({
  title,
  cols,
  children,
}: {
  title: string;
  cols: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className="border-t border-border bg-background">
        <td
          colSpan={cols}
          className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted"
        >
          {title}
        </td>
      </tr>
      {children}
    </>
  );
}

function CompareRow({
  label,
  a,
  b,
  fmt,
  strong,
  neutral,
}: {
  label: string;
  a: number | null;
  b: number | null;
  fmt: (n: number | null) => string;
  strong?: boolean;
  neutral?: boolean;
}) {
  const diff = a != null && b != null ? b - a : null;
  return (
    <tr className={cn("border-t border-border", strong && "font-semibold")}>
      <td className="py-1.5">{label}</td>
      <td className="py-1.5 text-right text-muted">{fmt(a)}</td>
      <td className="py-1.5 text-right">{fmt(b)}</td>
      <td
        className={cn(
          "py-1.5 text-right",
          !neutral && diff != null && diff > 0.005 && "text-danger",
          !neutral && diff != null && diff < -0.005 && "text-success",
        )}
      >
        {diff == null || Math.abs(diff) < 0.005
          ? ""
          : `${diff > 0 ? "+" : ""}${fmt(diff)}`}
      </td>
    </tr>
  );
}

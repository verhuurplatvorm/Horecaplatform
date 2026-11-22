"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Printer, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { containerLabel, formatDistribution, partyLineFigures } from "@/lib/party/party-calc";
import { RecipeBreakdown, type BreakdownColumn } from "@/components/menus/recipe-breakdown";
import type { PartyCapacityAdjustment } from "@/lib/types/database";

/** Eén rij uit get_event_menu_party_plan (centrale rekenregel in de database). */
export interface PartyPlanRow {
  line_id: string;
  recipe_id: string;
  recipe_name: string;
  section_name: string;
  container: string;
  capacity: number;
  capacity_unit: string | null;
  portion: number | null;
  quantity_per_person: number;
  participation_pct: number;
  needed: number;
  containers_exact: number;
  containers: number;
  full_containers: boolean;
  produced: number;
  last_container: number;
  difference: number;
  cost_per_container: number | null;
  total_cost: number | null;
  overproduction_cost: number | null;
  per_container: number;
  recipe_factor: number;
}

export function partyDistribution(p: PartyPlanRow): number[] {
  return Array.from({ length: p.containers }, (_, i) =>
    i === p.containers - 1 ? Number(p.last_container) : Number(p.capacity)
  );
}

/** Kolommen voor de ingrediënten van een partijgerecht: per vorm, kleinere laatste vorm, totaal. */
function partyColumns(p: PartyPlanRow): BreakdownColumn[] {
  const one = containerLabel(p.container, 1);
  const cols: BreakdownColumn[] = [{ label: `Per ${one}`, factor: p.per_container }];
  const partialLast =
    !p.full_containers && p.containers > 1 && p.capacity > 0 && p.last_container < p.capacity;
  if (partialLast) {
    cols.push({
      label: `Laatste ${one}`,
      factor: (p.last_container / p.capacity) * p.per_container,
    });
  }
  cols.push({
    label: `Totaal (${p.containers} ${containerLabel(p.container, p.containers)})`,
    factor: p.recipe_factor,
  });
  return cols;
}

interface WorkItem {
  /** recept + eenheid: lukt omrekenen niet, dan kan een recept twee regels hebben */
  key: string;
  recipeId: string;
  name: string;
  quantity: number;
  unitName: string | null;
  /** Hoe vaak het recept nodig is; null als de eenheid niet op de opbrengst aansluit. */
  recipeFactor: number | null;
  location: string;
  preparation: string | null;
  isHalfproduct: boolean;
}

/**
 * Productiewerklijst: wat moet er gemaakt worden voor dit menu, en
 * hoeveel. Klapt gerechten door naar de halfproducten die ze nodig
 * hebben, zodat de keuken één lijst heeft.
 *
 * Afvinken wordt per menu bewaard (tabel event_menu_work_done, migratie
 * 0139), zodat de stand na verversen blijft en elk scherm in de keuken
 * hetzelfde ziet. Een productie die je echt wilt vastleggen registreer je
 * op het halfproduct zelf — daar hoort ook de sticker bij.
 */
export function MenuWorkList({
  menuId,
  personCount,
  serviceDate,
  companyId,
  canViewFinancial = false,
}: {
  menuId: string;
  personCount: number;
  serviceDate: string | null;
  companyId: string | null;
  /** Productiekosten alleen tonen met financiële rechten (operator: nooit). */
  canViewFinancial?: boolean;
}) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [party, setParty] = useState<PartyPlanRow[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  // Praktijk boven theorie: werkelijk aantal vormen per partijregel.
  const [practice, setPractice] = useState<{ lineId: string; value: string } | null>(null);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<Map<string, PartyCapacityAdjustment>>(new Map());

  async function applyPractice(p: PartyPlanRow, actual: number) {
    setPracticeBusy(true);
    setPracticeError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_party_actual_containers", {
      p_line_id: p.line_id,
      p_actual: actual,
    });
    setPracticeBusy(false);
    if (error) {
      setPracticeError(error.message);
      return;
    }
    setPractice(null);
    setReloadKey((k) => k + 1);
  }
  const toggleOpen = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Afgevinkte regels ophalen: bij openen en als je terugkomt op het
  // tabblad (een ander scherm kan intussen hebben afgevinkt).
  useEffect(() => {
    let cancelled = false;
    async function loadDone() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("event_menu_work_done")
        .select("item_key")
        .eq("menu_id", menuId);
      if (!cancelled && !error) setDone(new Set((data ?? []).map((r) => r.item_key)));
    }
    loadDone();
    const onFocus = () => {
      if (document.visibilityState === "visible") loadDone();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [menuId]);

  async function toggle(key: string) {
    const wasDone = done.has(key);
    setDone((prev) => {
      const next = new Set(prev);
      if (wasDone) next.delete(key);
      else next.add(key);
      return next;
    });
    const supabase = createClient();
    const { error } = wasDone
      ? await supabase
          .from("event_menu_work_done")
          .delete()
          .eq("menu_id", menuId)
          .eq("item_key", key)
      : await supabase
          .from("event_menu_work_done")
          .upsert({ menu_id: menuId, item_key: key }, { onConflict: "menu_id,item_key" });
    if (error) {
      // Terugdraaien, zodat het scherm niet iets anders laat zien dan er bewaard is.
      setSaveError(true);
      setDone((prev) => {
        const next = new Set(prev);
        if (wasDone) next.add(key);
        else next.delete(key);
        return next;
      });
    } else {
      setSaveError(false);
    }
  }

  async function clearAll() {
    if (done.size === 0) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("event_menu_work_done")
      .delete()
      .eq("menu_id", menuId);
    if (error) setSaveError(true);
    else {
      setSaveError(false);
      setDone(new Set());
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      const supabase = createClient();

      // Partijgerechten: aantal vormen en verdeling komen uit de database.
      const { data: planData } = companyId
        ? await supabase.rpc("get_event_menu_party_plan", {
            p_menu_id: menuId,
            p_company_id: companyId,
          })
        : { data: [] };
      const plans = ((planData ?? []) as PartyPlanRow[]).map((p) => ({
        ...p,
        capacity: Number(p.capacity),
        needed: Number(p.needed),
        produced: Number(p.produced),
        last_container: Number(p.last_container),
        difference: Number(p.difference),
        containers_exact: Number(p.containers_exact),
        per_container: Number(p.per_container),
        recipe_factor: Number(p.recipe_factor),
      })).filter((p) => p.needed > 0); // niet-gekozen opties weglaten

      if (!cancelled) setParty(plans);

      // Laatste praktijkaanpassing per partijregel, als geheugensteun.
      if (plans.length > 0) {
        const { data: adj } = await supabase
          .from("party_capacity_adjustments")
          .select("*")
          .in("line_id", plans.map((p) => p.line_id))
          .order("adjusted_at", { ascending: false });
        const latest = new Map<string, PartyCapacityAdjustment>();
        for (const a of (adj ?? []) as PartyCapacityAdjustment[]) {
          if (a.line_id && !latest.has(a.line_id)) latest.set(a.line_id, a);
        }
        if (!cancelled) setAdjustments(latest);
      }

      // Wat er gemaakt moet worden, inclusief alle halfproducten, rekent de
      // database uit (get_event_menu_production, migratie 0135). Die rekent
      // elke hoeveelheid om naar de eenheid van het recept: 40 ml ijs p.p.
      // wordt dus bollen, niet "6.800 stuk".
      const { data: work } = await supabase.rpc("get_event_menu_production", {
        p_menu_id: menuId,
      });
      // Niet-gekozen opties komen met hoeveelheid 0 terug: niet tonen.
      const rows = (work ?? []).filter((w) => Number(w.quantity) > 0);
      if (rows.length === 0) {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
        return;
      }

      const recipeIds = [...new Set(rows.map((r) => r.recipe_id))];
      const [{ data: recipes }, { data: units }] = await Promise.all([
        supabase
          .from("recipes")
          .select("id, name, recipe_kind, preparation, production_location, base_unit_id, yield_quantity")
          .in("id", recipeIds),
        supabase.from("units").select("id, name"),
      ]);
      const unitName = new Map((units ?? []).map((u) => [u.id, u.name]));
      const recipeById = new Map((recipes ?? []).map((r) => [r.id, r]));

      const out: WorkItem[] = [];
      for (const row of rows) {
        const r = recipeById.get(row.recipe_id);
        if (!r) continue;
        const yieldQty = Number(r.yield_quantity ?? 0);
        out.push({
          recipeFactor:
            row.unit_id && row.unit_id === r.base_unit_id && yieldQty > 0
              ? Number(row.quantity) / yieldQty
              : null,
          key: `${row.recipe_id}:${row.unit_id ?? ""}`,
          recipeId: row.recipe_id,
          name: r.name,
          quantity: Number(row.quantity),
          unitName: row.unit_id ? unitName.get(row.unit_id) ?? null : null,
          location: r.production_location?.trim() || "Niet ingedeeld",
          preparation: r.preparation,
          isHalfproduct: r.recipe_kind === "halfproduct",
        });
      }

      if (!cancelled) {
        setItems(out.sort((a, b) => a.name.localeCompare(b.name, "nl")));
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [menuId, personCount, companyId, reloadKey]);

  const byLocation = new Map<string, WorkItem[]>();
  for (const i of items) {
    if (!byLocation.has(i.location)) byLocation.set(i.location, []);
    byLocation.get(i.location)!.push(i);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>
          Productiewerklijst
          {serviceDate && (
            <span className="ml-2 text-sm font-normal text-muted">
              voor {new Date(serviceDate).toLocaleDateString("nl-NL")}
            </span>
          )}
        </CardTitle>
        {(items.length > 0 || party.length > 0) && (
          <div className="flex items-center gap-2 print:hidden">
            {done.size > 0 && (
              <Button variant="secondary" size="sm" onClick={clearAll}>
                <RotateCcw className="h-3.5 w-3.5" />
                Vinkjes wissen
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
              Printen
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        {saveError && (
          <p className="px-5 text-sm text-danger">
            Vinkje kon niet worden opgeslagen. Controleer de verbinding en probeer het opnieuw.
          </p>
        )}
        {party.length > 0 && (
          <div>
            <p className="border-y border-border bg-background px-5 py-2 text-sm font-medium">
              Partijgerechten — productie per vorm
            </p>
            <ul className="divide-y divide-border">
              {party.map((p) => {
                const unit = p.capacity_unit ?? "";
                const fmt = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });
                return (
                  <li key={p.line_id} className="flex items-start gap-3 px-5 py-2.5">
                    <input
                      type="checkbox"
                      checked={done.has(p.line_id)}
                      onChange={() => toggle(p.line_id)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => toggleOpen(p.line_id)}
                        className={cn(
                          "flex items-center gap-1 text-left font-medium hover:text-teal",
                          done.has(p.line_id) && "text-muted line-through"
                        )}
                      >
                        {open.has(p.line_id) ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted print:hidden" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted print:hidden" />
                        )}
                        {p.recipe_name}
                        <span className="ml-1 text-xs font-normal text-muted">{p.section_name}</span>
                      </button>
                      {(() => {
                        // Zelfde getallen als het menu en de bestellijst (event_line_plan).
                        const f = partyLineFigures(p, canViewFinancial);
                        return (
                          <p className="text-xs text-muted">
                            {personCount} gasten
                            {Number(p.participation_pct) !== 100 && <> × {fmt(p.participation_pct)}%</>} ×{" "}
                            {fmt(p.quantity_per_person)} {unit} p.p. · netto <strong>{f.needed}</strong> · maken{" "}
                            <strong className="text-foreground">{f.produced}</strong> ({f.distribution})
                            {f.leftover && <> · verwacht over <strong>{f.leftover}</strong></>}
                            {f.productionCost !== null && (
                              <>
                                {" "}
                                · productie €{" "}
                                {f.productionCost.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </>
                            )}
                            <span className="sr-only">{formatDistribution(partyDistribution(p), unit)}</span>
                          </p>
                        );
                      })()}
                      {adjustments.has(p.line_id) && practice?.lineId !== p.line_id && (() => {
                        const a = adjustments.get(p.line_id)!;
                        return (
                          <p className="mt-0.5 text-xs text-teal">
                            Praktijk: {a.actual_containers} i.p.v. {a.planned_containers}{" "}
                            {containerLabel(p.container, 2)} · {fmt(Number(a.old_capacity))} →{" "}
                            {fmt(Number(a.new_capacity))} {unit} per {containerLabel(p.container, 1)} (
                            {new Date(a.adjusted_at).toLocaleDateString("nl-NL")})
                          </p>
                        );
                      })()}
                      {practice?.lineId === p.line_id && (() => {
                        const actual = Math.floor(Number(practice.value));
                        const valid = actual >= 1 && actual !== p.containers;
                        const newCap = valid ? Math.ceil((p.produced / actual) * 10) / 10 : null;
                        return (
                          <div className="mt-2 space-y-2 rounded-md border border-teal/40 bg-teal/5 p-3 text-sm print:hidden">
                            <label className="flex flex-wrap items-center gap-2">
                              <span>
                                Wat er gemaakt is ({fmt(p.produced)} {unit}) was genoeg voor
                              </span>
                              <input
                                type="number"
                                min={1}
                                step={1}
                                autoFocus
                                value={practice.value}
                                onChange={(e) => setPractice({ lineId: p.line_id, value: e.target.value })}
                                className="input h-9! w-20! text-center"
                              />
                              <span>{containerLabel(p.container, 2)}</span>
                            </label>
                            {newCap !== null && (
                              <p>
                                Nieuw gewicht per {containerLabel(p.container, 1)}:{" "}
                                <strong>
                                  {fmt(newCap)} {unit}
                                </strong>{" "}
                                (was {fmt(p.capacity)} {unit}). Dit wordt ook aangepast in het recept
                                &quot;{p.recipe_name}&quot;, dus ook voor volgende menu&apos;s.
                              </p>
                            )}
                            {practiceError && <p className="text-danger">{practiceError}</p>}
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={!valid || practiceBusy}
                                onClick={() => applyPractice(p, actual)}
                              >
                                {practiceBusy ? "Doorvoeren…" : "Doorvoeren in recept"}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setPractice(null);
                                  setPracticeError(null);
                                }}
                              >
                                Annuleren
                              </Button>
                            </div>
                          </div>
                        );
                      })()}
                      {open.has(p.line_id) && (
                        <RecipeBreakdown
                          key={`${p.line_id}:${p.capacity}`}
                          recipeId={p.recipe_id}
                          columns={partyColumns(p)}
                          note={
                            p.per_container >= 1.05
                              ? `1 ${containerLabel(p.container, 1)} = recept × ${p.per_container.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}`
                              : null
                          }
                        />
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="tabular whitespace-nowrap font-medium">
                        {p.containers} {containerLabel(p.container, p.containers)}
                      </span>
                      {practice?.lineId !== p.line_id && (
                        <button
                          type="button"
                          onClick={() => {
                            setPracticeError(null);
                            setPractice({ lineId: p.line_id, value: String(p.containers) });
                          }}
                          className="whitespace-nowrap text-xs text-muted hover:text-teal print:hidden"
                        >
                          Praktijk aanpassen
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {items.length === 0 && party.length > 0 ? null : items.length === 0 ? (
          <p className="px-5 py-8 text-center text-muted">
            {loading
              ? "Werklijst samenstellen…"
              : "Nog niets te produceren — voeg gerechten of halfproducten toe."}
          </p>
        ) : (
          [...byLocation.entries()].map(([location, list]) => (
            <div key={location}>
              <p className="border-y border-border bg-background px-5 py-2 text-sm font-medium">
                {location}
                <span className="ml-2 text-xs font-normal text-muted">
                  {list.filter((i) => done.has(i.key)).length}/{list.length} gereed
                </span>
              </p>
              <ul className="divide-y divide-border">
                {list.map((i) => (
                  <li key={i.key} className="flex items-start gap-3 px-5 py-2.5">
                    <input
                      type="checkbox"
                      checked={done.has(i.key)}
                      onChange={() => toggle(i.key)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => toggleOpen(i.key)}
                        className={cn(
                          "flex items-center gap-1 text-left font-medium hover:text-teal",
                          done.has(i.key) && "text-muted line-through"
                        )}
                      >
                        {open.has(i.key) ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted print:hidden" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted print:hidden" />
                        )}
                        {i.name}
                        <span className="ml-1 text-xs font-normal text-muted">
                          {i.isHalfproduct ? "halfproduct" : "gerecht"}
                        </span>
                      </button>
                      {open.has(i.key) ? (
                        <RecipeBreakdown
                          recipeId={i.recipeId}
                          columns={
                            i.recipeFactor !== null
                              ? [{ label: "Totaal", factor: i.recipeFactor }]
                              : [{ label: "Per recept", factor: 1 }]
                          }
                          note={
                            i.recipeFactor !== null
                              ? `Recept × ${i.recipeFactor.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}`
                              : "De hoeveelheid sluit niet aan op de opbrengst van het recept; dit is het recept zelf."
                          }
                        />
                      ) : (
                        i.preparation && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted">
                            {i.preparation}
                          </p>
                        )
                      )}
                    </div>
                    <span className="tabular whitespace-nowrap font-medium">
                      {i.quantity.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}{" "}
                      {i.unitName}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

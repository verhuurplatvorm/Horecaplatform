"use client";

import { Fragment, use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Plus, Save, Trash2, Users } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MenuOrderList } from "@/components/menus/menu-order-list";
import { MenuWorkList } from "@/components/menus/menu-work-list";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { EventMenu, EventMenuLine, EventMenuSection, Unit } from "@/lib/types/database";

const TABS = [
  { key: "algemeen", label: "Algemeen" },
  { key: "financieel", label: "Financieel" },
  { key: "werklijst", label: "Productiewerklijst" },
  { key: "bestellijst", label: "Bestellijst" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

interface BreakdownLine {
  line_id: string;
  section_name: string;
  section_sort: number;
  display_name: string;
  line_type: string;
  quantity_per_person: number;
  unit_name: string | null;
  is_fixed: boolean;
  total_quantity: number;
  unit_price: number | null;
  unit_price_label: string | null;
  cost_per_person: number | null;
  total_cost: number | null;
  note: string | null;
  sort_order: number;
}

export default function MenuDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const { can } = usePermissions();
  const canViewFinancial = can("menukaarten").canViewFinancial;

  const [tab, setTab] = useState<TabKey>("algemeen");
  const [menu, setMenu] = useState<EventMenu | null>(null);
  const [sections, setSections] = useState<EventMenuSection[]>([]);
  const [lines, setLines] = useState<BreakdownLine[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [units, setUnits] = useState<Unit[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("units")
      .select("*")
      .order("dimension")
      .order("sort_order")
      .then(({ data }) => setUnits((data as Unit[]) ?? []));
  }, []);
  const [totalCost, setTotalCost] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: m }, { data: secs }] = await Promise.all([
      supabase.from("event_menus").select("*").eq("id", id).single(),
      supabase.from("event_menu_sections").select("*").eq("menu_id", id).order("sort_order"),
    ]);
    if (!m) {
      setLoading(false);
      return;
    }
    setMenu(m as EventMenu);
    setSections((secs as EventMenuSection[]) ?? []);

    // Samenstelling mét kostprijzen komt uit één databasefunctie, die
    // dezelfde prijsbronnen en conversies gebruikt als de rest van het
    // platform. Hier wordt dus niets opnieuw uitgerekend.
    if (referenceCompanyId) {
      const [{ data: breakdown }, { data: cost }] = await Promise.all([
        supabase.rpc("get_event_menu_breakdown", {
          p_menu_id: id,
          p_company_id: referenceCompanyId,
        }),
        supabase.rpc("calculate_event_menu_cost", {
          p_menu_id: id,
          p_company_id: referenceCompanyId,
        }),
      ]);
      setLines((breakdown as BreakdownLine[]) ?? []);
      setTotalCost((cost as number | null) ?? null);
    } else {
      setLines([]);
    }
    setLoading(false);
  }, [id, referenceCompanyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveMenu(patch: Partial<EventMenu>) {
    if (!menu) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("event_menus").update(patch).eq("id", menu.id);
    setSaving(false);
    if (error) {
      window.alert("Opslaan mislukt: " + error.message);
      return;
    }
    setMenu({ ...menu, ...patch });
    // Aantal personen én vaste kosten zitten allebei in de totale
    // kostprijs die de database berekent; na een wijziging moet die
    // opnieuw opgehaald worden, anders blijft er een oud totaal staan.
    if (patch.person_count !== undefined || patch.fixed_costs !== undefined) {
      load();
    }
  }

  /**
   * Eén regel bijwerken. Na opslaan wordt de samenstelling opnieuw
   * opgehaald, zodat de kostprijzen meteen kloppen — die komen immers
   * uit de database en niet uit een berekening hier.
   */
  async function updateLine(lineId: string, patch: Partial<EventMenuLine>) {
    const supabase = createClient();
    const { error } = await supabase
      .from("event_menu_lines")
      .update(patch)
      .eq("id", lineId);
    if (error) {
      window.alert("Wijzigen mislukt: " + error.message);
      return;
    }
    load();
  }

  /** Onderdeel wijzigen: bestaande sectie hergebruiken of aanmaken. */
  async function updateSection(lineId: string, name: string) {
    const supabase = createClient();
    const trimmed = name.trim();
    if (!trimmed) {
      await updateLine(lineId, { section_id: null });
      return;
    }
    const { data: existing } = await supabase
      .from("event_menu_sections")
      .select("id")
      .eq("menu_id", id)
      .eq("name", trimmed)
      .maybeSingle();
    let sectionId = existing?.id ?? null;
    if (!sectionId) {
      const { data: created } = await supabase
        .from("event_menu_sections")
        .insert({ menu_id: id, name: trimmed })
        .select("id")
        .single();
      sectionId = created?.id ?? null;
    }
    await updateLine(lineId, { section_id: sectionId });
  }

  async function deleteLine(lineId: string) {
    const supabase = createClient();
    await supabase.from("event_menu_lines").delete().eq("id", lineId);
    load();
  }

  if (loading) {
    return (
      <>
        <Topbar title="Menu" />
        <main className="p-6">
          <p className="text-sm text-muted">Menu laden…</p>
        </main>
      </>
    );
  }
  if (!menu) {
    return (
      <>
        <Topbar title="Menu" />
        <main className="p-6">
          <p className="text-sm text-danger">Dit menu bestaat niet (meer).</p>
        </main>
      </>
    );
  }

  // Regels groeperen per onderdeel, in de volgorde die de database geeft.
  const sectionGroups: [string, BreakdownLine[]][] = [];
  for (const l of lines) {
    const last = sectionGroups[sectionGroups.length - 1];
    if (last && last[0] === l.section_name) last[1].push(l);
    else sectionGroups.push([l.section_name, [l]]);
  }

  // Optellen uit de regels zelf, zodat dit nooit uit de pas loopt met
  // een totaal dat nog opgehaald moet worden.
  const variableCost = lines.reduce((sum, l) => sum + (l.total_cost ?? 0), 0);

  const costPerPerson =
    totalCost !== null && menu.person_count > 0 ? totalCost / menu.person_count : null;
  const salesExclVat = menu.sales_price_per_person
    ? menu.sales_price_per_person / (1 + menu.vat_rate / 100)
    : null;
  const foodcostPct =
    costPerPerson !== null && salesExclVat && salesExclVat > 0
      ? (costPerPerson / salesExclVat) * 100
      : null;

  return (
    <>
      <Topbar title="Menu's & buffetten" />
      <main className="max-w-6xl space-y-4 p-6">
        {/* Vaste kop: naam, personen en kostprijs blijven in beeld. */}
        <div className="sticky top-0 z-30 -mx-6 border-b border-border bg-background px-6 pb-3 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold">{menu.name}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                <span>{menu.category ?? "geen categorie"}</span>
                <span>{menu.menu_type ?? "menu"}</span>
                <span className="rounded-full bg-teal/10 px-2 py-0.5 text-teal">
                  {menu.status}
                </span>
                {canViewFinancial && costPerPerson !== null && (
                  <span className="font-medium text-foreground">
                    € {costPerPerson.toFixed(2)} p.p.
                  </span>
                )}
              </p>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-teal bg-teal/5 px-3 py-1.5">
              <Users className="h-4 w-4 text-teal" />
              <span className="text-sm text-muted">Personen</span>
              <input
                type="number"
                min="1"
                value={menu.person_count}
                onChange={(e) => {
                  const n = Math.max(1, Number(e.target.value) || 1);
                  setMenu({ ...menu, person_count: n });
                }}
                onBlur={(e) =>
                  saveMenu({ person_count: Math.max(1, Number(e.target.value) || 1) })
                }
                className="w-20 rounded border border-border bg-surface px-2 py-1 text-sm tabular"
              />
            </label>
            <Button onClick={() => saveMenu({ name: menu.name })} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? "Opslaan…" : "Opslaan"}
            </Button>
          </div>

          <nav className="mt-3 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-1.5 text-sm",
                  tab === t.key
                    ? "border-teal font-medium text-teal"
                    : "border-transparent text-muted hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {tab === "algemeen" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Gegevens</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Naam">
                  <input
                    value={menu.name}
                    onChange={(e) => setMenu({ ...menu, name: e.target.value })}
                    onBlur={(e) => saveMenu({ name: e.target.value })}
                    className="input"
                  />
                </Field>
                <Field label="Type">
                  <input
                    value={menu.menu_type ?? ""}
                    onChange={(e) => setMenu({ ...menu, menu_type: e.target.value })}
                    onBlur={(e) => saveMenu({ menu_type: e.target.value || null })}
                    placeholder="buffet, arrangement, shared dining…"
                    className="input"
                  />
                </Field>
                <Field label="Categorie / map">
                  <input
                    value={menu.category ?? ""}
                    onChange={(e) => setMenu({ ...menu, category: e.target.value })}
                    onBlur={(e) => saveMenu({ category: e.target.value || null })}
                    className="input"
                  />
                </Field>
                <Field label="Datum">
                  <input
                    type="date"
                    value={menu.service_date ?? ""}
                    onChange={(e) => setMenu({ ...menu, service_date: e.target.value })}
                    onBlur={(e) => saveMenu({ service_date: e.target.value || null })}
                    className="input"
                  />
                </Field>
                <Field label="Kassakoppeling">
                  <input
                    value={menu.pos_reference ?? ""}
                    onChange={(e) => setMenu({ ...menu, pos_reference: e.target.value })}
                    onBlur={(e) => saveMenu({ pos_reference: e.target.value || null })}
                    className="input"
                  />
                </Field>
                <Field label="Status">
                  <select
                    value={menu.status}
                    onChange={(e) => {
                      const v = e.target.value as EventMenu["status"];
                      setMenu({ ...menu, status: v });
                      saveMenu({ status: v });
                    }}
                    className="input"
                  >
                    <option value="concept">Concept</option>
                    <option value="definitief">Definitief</option>
                    <option value="uitgevoerd">Uitgevoerd</option>
                    <option value="vervallen">Vervallen</option>
                  </select>
                </Field>
                <Field label="Omschrijving" span2>
                  <textarea
                    rows={2}
                    value={menu.description ?? ""}
                    onChange={(e) => setMenu({ ...menu, description: e.target.value })}
                    onBlur={(e) => saveMenu({ description: e.target.value || null })}
                    className="input"
                  />
                </Field>
                <Field label="Opmerkingen" span2>
                  <textarea
                    rows={2}
                    value={menu.notes ?? ""}
                    onChange={(e) => setMenu({ ...menu, notes: e.target.value })}
                    onBlur={(e) => saveMenu({ notes: e.target.value || null })}
                    className="input"
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={menu.is_template}
                    onChange={(e) => {
                      setMenu({ ...menu, is_template: e.target.checked });
                      saveMenu({ is_template: e.target.checked });
                    }}
                  />
                  Bewaren als sjabloon — voor een evenement vul je dan alleen datum en
                  aantal personen in.
                </label>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Samenstelling</CardTitle>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => router.push(`/menus/${id}/regel-toevoegen`)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Regel toevoegen
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <datalist id="menu-secties">
                  {sections.map((sec) => (
                    <option key={sec.id} value={sec.name} />
                  ))}
                </datalist>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted">
                        <th className="px-4 py-2 font-medium">Naam</th>
                        <th className="px-4 py-2 font-medium">Onderdeel</th>
                        <th className="px-4 py-2 font-medium">Type</th>
                        <th className="px-4 py-2 text-right font-medium">Per persoon</th>
                        <th className="px-4 py-2 font-medium">Eenheid</th>
                        <th className="px-4 py-2 text-right font-medium">Totaal</th>
                        {canViewFinancial && (
                          <>
                            <th className="px-4 py-2 text-right font-medium">Eenheidsprijs</th>
                            <th className="px-4 py-2 text-right font-medium">Kostprijs p.p.</th>
                            <th className="px-4 py-2 text-right font-medium">Totale kostprijs</th>
                          </>
                        )}
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sectionGroups.map(([sectionName, group]) => {
                        const isCollapsed = collapsed.has(sectionName);
                        const subtotal = group.reduce((sum, l) => sum + (l.total_cost ?? 0), 0);
                        return (
                          <Fragment key={sectionName}>
                            <tr className="border-t border-border bg-background">
                              <td colSpan={canViewFinancial ? 9 : 6} className="px-4 py-2">
                                <button
                                  onClick={() =>
                                    setCollapsed((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(sectionName)) next.delete(sectionName);
                                      else next.add(sectionName);
                                      return next;
                                    })
                                  }
                                  className="flex items-center gap-1.5 font-medium hover:text-teal"
                                >
                                  {isCollapsed ? (
                                    <ChevronRight className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                  {sectionName}
                                  <span className="text-xs font-normal text-muted">
                                    ({group.length})
                                  </span>
                                </button>
                              </td>
                              {canViewFinancial && (
                                <td className="px-4 py-2 text-right tabular font-medium">
                                  € {subtotal.toFixed(2)}
                                </td>
                              )}
                              <td />
                            </tr>
                            {!isCollapsed &&
                              group.map((l) => (
                                <tr key={l.line_id} className="border-t border-border">
                                  <td className="px-4 py-2 pl-8 font-medium">
                                    {l.display_name}
                                    <input
                                      defaultValue={l.note ?? ""}
                                      onBlur={(e) => {
                                        const v = e.target.value.trim() || null;
                                        if (v !== (l.note ?? null))
                                          updateLine(l.line_id, { note: v });
                                      }}
                                      placeholder="opmerking…"
                                      className="mt-0.5 block w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-normal text-muted hover:border-border focus:border-teal focus:bg-surface"
                                    />
                                  </td>
                                  <td className="px-4 py-2">
                                    <input
                                      defaultValue={
                                        l.section_name === "Overig" ? "" : l.section_name
                                      }
                                      onBlur={(e) => {
                                        const v = e.target.value.trim();
                                        const current =
                                          l.section_name === "Overig" ? "" : l.section_name;
                                        if (v !== current) updateSection(l.line_id, v);
                                      }}
                                      placeholder="bv. Koud buffet"
                                      list="menu-secties"
                                      className="w-32 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-muted hover:border-border focus:border-teal focus:bg-surface"
                                    />
                                  </td>
                                  <td className="px-4 py-2 text-muted">
                                    {l.line_type}
                                    <label
                                      className="ml-2 inline-flex cursor-pointer items-center gap-1 text-xs"
                                      title="Vaste hoeveelheid: telt één keer voor het hele menu"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={l.is_fixed}
                                        onChange={(e) =>
                                          updateLine(l.line_id, { is_fixed: e.target.checked })
                                        }
                                      />
                                      vast
                                    </label>
                                  </td>
                                  <td className="px-4 py-2 text-right">
                                    <input
                                      type="number"
                                      step="any"
                                      min="0"
                                      defaultValue={l.quantity_per_person}
                                      onBlur={(e) => {
                                        const v = Number(e.target.value);
                                        if (v > 0 && v !== l.quantity_per_person)
                                          updateLine(l.line_id, { quantity_per_person: v });
                                      }}
                                      className="w-20 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-sm tabular hover:border-border focus:border-teal focus:bg-surface"
                                    />
                                  </td>
                                  <td className="px-4 py-2">
                                    <select
                                      value={
                                        units.find((u) => u.name === l.unit_name)?.id ?? ""
                                      }
                                      onChange={(e) =>
                                        updateLine(l.line_id, { unit_id: e.target.value })
                                      }
                                      className="rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-muted hover:border-border focus:border-teal focus:bg-surface"
                                    >
                                      {units.map((u) => (
                                        <option key={u.id} value={u.id}>
                                          {u.name}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-4 py-2 text-right tabular font-medium">
                                    {l.total_quantity.toLocaleString("nl-NL", {
                                      maximumFractionDigits: 2,
                                    })}{" "}
                                    <span className="text-xs font-normal text-muted">
                                      {l.unit_name}
                                    </span>
                                  </td>
                                  {canViewFinancial && (
                                    <>
                                      <td className="px-4 py-2 text-right tabular text-muted">
                                        {l.unit_price !== null
                                          ? `€ ${l.unit_price.toFixed(4)} / ${l.unit_price_label ?? ""}`
                                          : "—"}
                                      </td>
                                      <td className="px-4 py-2 text-right tabular">
                                        {l.cost_per_person !== null
                                          ? `€ ${l.cost_per_person.toFixed(2)}`
                                          : "—"}
                                      </td>
                                      <td className="px-4 py-2 text-right tabular font-medium">
                                        {l.total_cost !== null
                                          ? `€ ${l.total_cost.toFixed(2)}`
                                          : "—"}
                                      </td>
                                    </>
                                  )}
                                  <td className="px-4 py-2">
                                    <button
                                      onClick={() => deleteLine(l.line_id)}
                                      title="Regel verwijderen"
                                      className="text-muted hover:text-danger"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </Fragment>
                        );
                      })}
                      {lines.length === 0 && (
                        <tr>
                          <td
                            colSpan={canViewFinancial ? 10 : 7}
                            className="px-4 py-8 text-center text-muted"
                          >
                            Nog niets toegevoegd. Voeg gerechten, halfproducten of losse
                            ingrediënten toe.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Altijd zichtbare samenvatting onder de samenstelling. */}
                {canViewFinancial && lines.length > 0 && (
                  <div className="grid gap-3 border-t border-border bg-background px-4 py-3 sm:grid-cols-5">
                    <Summary label="Totale kostprijs" value={`€ ${(totalCost ?? 0).toFixed(2)}`} />
                    <Summary
                      label="Kostprijs p.p."
                      value={costPerPerson !== null ? `€ ${costPerPerson.toFixed(2)}` : "—"}
                    />
                    <Summary
                      label="Verkoopprijs p.p."
                      value={
                        menu.sales_price_per_person
                          ? `€ ${menu.sales_price_per_person.toFixed(2)}`
                          : "niet ingevuld"
                      }
                    />
                    <Summary
                      label="Foodcost %"
                      value={foodcostPct !== null ? `${foodcostPct.toFixed(1)}%` : "—"}
                      tone={
                        foodcostPct === null ? undefined : foodcostPct > 33 ? "bad" : "good"
                      }
                    />
                    <Summary
                      label="Brutomarge"
                      value={
                        salesExclVat !== null && costPerPerson !== null
                          ? `€ ${((salesExclVat - costPerPerson) * menu.person_count).toFixed(2)}`
                          : "—"
                      }
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "financieel" &&
          (canViewFinancial ? (
            <Card>
              <CardHeader>
                <CardTitle>Calculatie bij {menu.person_count} personen</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row
                  label="Variabele kosten (ingrediënten en gerechten)"
                  value={`€ ${variableCost.toFixed(2)}`}
                />
                <div className="flex items-center justify-between">
                  <span className="text-muted">
                    Vaste kosten{" "}
                    <span className="text-xs">
                      (komen bovenop de variabele kosten, schalen niet mee met het
                      aantal personen)
                    </span>
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={menu.fixed_costs}
                    onChange={(e) =>
                      setMenu({ ...menu, fixed_costs: Number(e.target.value) || 0 })
                    }
                    onBlur={(e) => saveMenu({ fixed_costs: Number(e.target.value) || 0 })}
                    className="w-28 rounded border border-border bg-surface px-2 py-1 text-right text-sm tabular"
                  />
                </div>
                <div className="border-t border-border pt-2">
                  <Row label="Totale kostprijs" value={`€ ${(totalCost ?? 0).toFixed(2)}`} strong />
                </div>
                <Row
                  label="Kostprijs per persoon"
                  value={costPerPerson !== null ? `€ ${costPerPerson.toFixed(2)}` : "—"}
                  strong
                />
                <div className="flex items-center justify-between pt-2">
                  <span className="text-muted">Verkoopprijs per persoon (incl. btw)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={menu.sales_price_per_person ?? ""}
                    onChange={(e) =>
                      setMenu({
                        ...menu,
                        sales_price_per_person: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    onBlur={(e) =>
                      saveMenu({
                        sales_price_per_person: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className="w-28 rounded border border-border bg-surface px-2 py-1 text-right text-sm tabular"
                  />
                </div>
                {foodcostPct !== null && (
                  <>
                    <Row
                      label="Foodcost %"
                      value={`${foodcostPct.toFixed(1)}%`}
                      tone={foodcostPct > 33 ? "bad" : "good"}
                    />
                    <Row
                      label="Brutowinst per persoon"
                      value={`€ ${((salesExclVat ?? 0) - (costPerPerson ?? 0)).toFixed(2)}`}
                    />
                    <Row
                      label="Omzet totaal (excl. btw)"
                      value={`€ ${((salesExclVat ?? 0) * menu.person_count).toFixed(2)}`}
                    />
                    <Row
                      label="Brutowinst totaal"
                      value={`€ ${(((salesExclVat ?? 0) - (costPerPerson ?? 0)) * menu.person_count).toFixed(2)}`}
                      strong
                    />
                  </>
                )}
                {costPerPerson !== null && (
                  <div className="space-y-1 rounded-md bg-teal/5 p-3">
                    {menu.fixed_costs > 0 && (
                      <p>
                        € {variableCost.toFixed(2)} variabel + €{" "}
                        {menu.fixed_costs.toFixed(2)} vast ={" "}
                        <strong>€ {(totalCost ?? 0).toFixed(2)}</strong> totale kosten
                      </p>
                    )}
                    <p>
                      <strong>€ {(totalCost ?? 0).toFixed(2)}</strong> totale kosten ÷{" "}
                      <strong>{menu.person_count} personen</strong> ={" "}
                      <strong>€ {costPerPerson.toFixed(2)} per persoon</strong>
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <p className="rounded-md bg-copper/10 p-3 text-sm text-copper">
              Je rol heeft geen toegang tot financiële gegevens.
            </p>
          ))}

        {tab === "werklijst" && (
          <MenuWorkList
            menuId={id}
            personCount={menu.person_count}
            serviceDate={menu.service_date}
          />
        )}

        {tab === "bestellijst" && <MenuOrderList menuId={id} />}
      </main>
    </>
  );
}

function Field({
  label,
  span2,
  children,
}: {
  label: string;
  span2?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : undefined}>
      <label className="mb-1 block text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "good" | "bad";
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? "font-medium text-foreground" : "text-muted"}>{label}</span>
      <span
        className={cn(
          "tabular",
          strong && "font-semibold",
          tone === "bad" && "text-danger",
          tone === "good" && "text-success"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p
        className={cn(
          "tabular text-base font-semibold",
          tone === "bad" && "text-danger",
          tone === "good" && "text-success"
        )}
      >
        {value}
      </p>
    </div>
  );
}

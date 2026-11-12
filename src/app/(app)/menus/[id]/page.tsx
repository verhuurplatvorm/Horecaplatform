"use client";

import { Fragment, use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileSpreadsheet,
  MessageSquarePlus,
  Plus,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { MenuLineForm } from "@/components/menus/menu-line-form";
import { MenuOrderList } from "@/components/menus/menu-order-list";
import { MenuWorkList } from "@/components/menus/menu-work-list";
import { MenuNacalculatie } from "@/components/menus/menu-nacalculatie";
import { MenuGramDistribution } from "@/components/menus/menu-gram-distribution";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { withReturnTo } from "@/lib/use-return-navigation";
import Link from "next/link";
import type {
  EventMenu,
  EventMenuLine,
  EventMenuPartyPlanRow,
  EventMenuSection,
  Unit,
} from "@/lib/types/database";
import { containerLabel } from "@/lib/party/party-calc";
import { DEFAULT_TARGET_GRAMS } from "@/lib/event-menus/distribute-grams";

const TABS = [
  { key: "algemeen", label: "Algemeen" },
  { key: "financieel", label: "Financieel" },
  { key: "werklijst", label: "Productiewerklijst" },
  { key: "bestellijst", label: "Bestellijst" },
  { key: "nacalculatie", label: "Nacalculatie" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Korte eenheid voor in de tabel: gram → g, kilogram → kg. */
const UNIT_SHORT: Record<string, string> = {
  gram: "g",
  kilogram: "kg",
  milligram: "mg",
  milliliter: "ml",
  centiliter: "cl",
  deciliter: "dl",
  liter: "l",
  stuk: "st",
  stuks: "st",
};
function unitShort(name: string | null | undefined): string {
  if (!name) return "";
  const key = name.trim().toLowerCase().replace(/\s*\(.*\)$/, "");
  return UNIT_SHORT[key] ?? name;
}

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

  // Per regel waar hij naartoe verwijst, om het ingrediënt, halfproduct of
  // gerecht direct te kunnen openen.
  const [lineTargets, setLineTargets] = useState<Record<string, { href: string; label: string }>>({});
  // Deelname% per regel en de partij-planning (aantal schalen) per regel.
  const [lineExtra, setLineExtra] = useState<Record<string, { pct: number; full: boolean | null }>>({});
  const [partyPlan, setPartyPlan] = useState<Record<string, EventMenuPartyPlanRow>>({});
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<TabKey>("algemeen");
  const [menu, setMenu] = useState<EventMenu | null>(null);
  const [sections, setSections] = useState<EventMenuSection[]>([]);
  const [lines, setLines] = useState<BreakdownLine[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [units, setUnits] = useState<Unit[]>([]);
  // Streefgewicht per persoon voor de gewichtscontrole (alleen weergave).
  const [targetGrams, setTargetGrams] = useState<number>(DEFAULT_TARGET_GRAMS);

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
  const [addingLine, setAddingLine] = useState(false);

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

    // Waar elke regel naar verwijst (ingrediënt, halfproduct of gerecht).
    const { data: lineRefs } = await supabase
      .from("event_menu_lines")
      .select("id, recipe_id, product_id, participation_pct, full_containers")
      .eq("menu_id", id);
    const extra: Record<string, { pct: number; full: boolean | null }> = {};
    for (const r of lineRefs ?? []) {
      extra[r.id as string] = { pct: Number(r.participation_pct ?? 100), full: r.full_containers ?? null };
    }
    setLineExtra(extra);
    const recipeIds = [...new Set((lineRefs ?? []).map((r) => r.recipe_id).filter(Boolean))] as string[];
    const kindById = new Map<string, string>();
    if (recipeIds.length > 0) {
      const { data: recs } = await supabase.from("recipes").select("id, recipe_kind").in("id", recipeIds);
      for (const r of recs ?? []) kindById.set(r.id as string, r.recipe_kind as string);
    }
    const targets: Record<string, { href: string; label: string }> = {};
    for (const r of lineRefs ?? []) {
      if (r.product_id) {
        targets[r.id as string] = { href: `/producten/${r.product_id}/bewerken`, label: "Ingrediënt openen →" };
      } else if (r.recipe_id) {
        const half = kindById.get(r.recipe_id as string) === "halfproduct";
        targets[r.id as string] = half
          ? { href: `/halfproducten/${r.recipe_id}/bewerken`, label: "Halfproduct openen →" }
          : { href: `/recepturen/${r.recipe_id}/bewerken`, label: "Gerecht openen →" };
      }
    }
    setLineTargets(targets);

    // Samenstelling mét kostprijzen komt uit één databasefunctie, die
    // dezelfde prijsbronnen en conversies gebruikt als de rest van het
    // platform. Hier wordt dus niets opnieuw uitgerekend.
    if (referenceCompanyId) {
      const [{ data: breakdown }, { data: cost }, { data: plan }] = await Promise.all([
        supabase.rpc("get_event_menu_breakdown", {
          p_menu_id: id,
          p_company_id: referenceCompanyId,
        }),
        supabase.rpc("calculate_event_menu_cost", {
          p_menu_id: id,
          p_company_id: referenceCompanyId,
        }),
        supabase.rpc("get_event_menu_party_plan", {
          p_menu_id: id,
          p_company_id: referenceCompanyId,
        }),
      ]);
      const planMap: Record<string, EventMenuPartyPlanRow> = {};
      for (const p of (plan as EventMenuPartyPlanRow[] | null) ?? []) planMap[p.line_id] = p;
      setPartyPlan(planMap);
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
    // Bestaand onderdeel zoeken zonder op hoofdletters/spaties te letten,
    // zodat "koud" bij "Koud" komt en er geen dubbel onderdeel ontstaat.
    const key = trimmed.toLowerCase().replace(/\s+/g, " ");
    let sectionId =
      sections.find((s) => s.name.trim().toLowerCase().replace(/\s+/g, " ") === key)?.id ?? null;
    if (!sectionId) {
      // Nieuw onderdeel komt achteraan.
      const nextSort = sections.reduce((m, s) => Math.max(m, s.sort_order ?? 0), 0) + 1;
      const { data: created } = await supabase
        .from("event_menu_sections")
        .insert({ menu_id: id, name: trimmed, sort_order: nextSort })
        .select("id")
        .single();
      sectionId = created?.id ?? null;
    }
    await updateLine(lineId, { section_id: sectionId });
  }

  /** Onderdeel een plek omhoog/omlaag in het menu. */
  async function moveSection(order: string[], name: string, dir: -1 | 1) {
    const norm = (v: string) => v.trim().toLowerCase();
    const ids = order
      .map((n) => sections.find((s) => norm(s.name) === norm(n))?.id)
      .filter((v): v is string => Boolean(v));
    const target = sections.find((s) => norm(s.name) === norm(name))?.id;
    const i = target ? ids.indexOf(target) : -1;
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const supabase = createClient();
    await Promise.all(
      ids.map((sid, idx) =>
        sections.find((s) => s.id === sid)?.sort_order === idx
          ? null
          : supabase.from("event_menu_sections").update({ sort_order: idx }).eq("id", sid),
      ),
    );
    load();
  }

  async function deleteMenu() {
    if (!menu) return;
    if (
      !window.confirm(
        `"${menu.name}" verwijderen? De samenstelling en de nacalculatie van dit menu worden ook verwijderd. Gerechten, halfproducten en ingrediënten blijven bestaan.`,
      )
    )
      return;
    const { error } = await createClient().from("event_menus").delete().eq("id", menu.id);
    if (error) {
      window.alert("Verwijderen mislukt: " + error.message);
      return;
    }
    router.push("/menus");
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

  // Regels groeperen per onderdeel (zelfde naam = zelfde groep), in de
  // volgorde waarin een onderdeel voor het eerst voorkomt.
  const sectionGroups: [string, BreakdownLine[]][] = [];
  const groupByName = new Map<string, [string, BreakdownLine[]]>();
  for (const l of lines) {
    const key = l.section_name.trim().toLowerCase();
    const group = groupByName.get(key);
    if (group) group[1].push(l);
    else {
      const g: [string, BreakdownLine[]] = [l.section_name, [l]];
      groupByName.set(key, g);
      sectionGroups.push(g);
    }
  }

  // Optellen uit de regels zelf, zodat dit nooit uit de pas loopt met
  // een totaal dat nog opgehaald moet worden.
  const variableCost = lines.reduce((sum, l) => sum + (l.total_cost ?? 0), 0);

  // Gewicht per persoon: gram en ml (≈ gram) tellen mee, stuks niet.
  // totaal / personen, dus deelname% en vaste regels zitten erin verwerkt.
  const unitByName = new Map(units.map((u) => [u.name, u]));
  const gramsPerPerson = (l: BreakdownLine): number | null => {
    const u = l.unit_name ? unitByName.get(l.unit_name) : undefined;
    if (!u || (u.dimension !== "gewicht" && u.dimension !== "inhoud")) return null;
    if (!(menu.person_count > 0)) return null;
    return (Number(l.total_quantity) * Number(u.factor_to_base)) / menu.person_count;
  };
  const weightPP = lines.reduce((t, l) => t + (gramsPerPerson(l) ?? 0), 0);
  const countLines = lines.filter((l) => gramsPerPerson(l) === null).length;
  const totalKg = (weightPP * menu.person_count) / 1000;
  const guestsAtTarget = targetGrams > 0 ? Math.floor((weightPP * menu.person_count) / targetGrams) : null;
  const weightDiffPct = targetGrams > 0 ? ((weightPP - targetGrams) / targetGrams) * 100 : 0;
  const fmtG = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 0 });

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
              {lines.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span>
                    Gewicht p.p.{" "}
                    <strong
                      className={
                        Math.abs(weightDiffPct) <= 5
                          ? "text-teal"
                          : weightDiffPct < 0
                            ? "text-copper"
                            : "text-foreground"
                      }
                    >
                      {fmtG(weightPP)} g
                    </strong>
                  </span>
                  <label className="flex items-center gap-1 text-muted">
                    doel
                    <input
                      type="number"
                      min="0"
                      step="10"
                      value={targetGrams}
                      onChange={(e) => setTargetGrams(Math.max(0, Number(e.target.value) || 0))}
                      className="w-16 rounded border border-border bg-surface px-1 text-right tabular text-foreground"
                    />
                    g
                    {targetGrams > 0 && (
                      <span className={weightDiffPct < -5 ? "text-copper" : ""}>
                        ({weightDiffPct >= 0 ? "+" : ""}
                        {fmtG(weightPP - targetGrams)} g)
                      </span>
                    )}
                  </label>
                  <span className="text-muted">
                    totaal <strong className="text-foreground">{totalKg.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} kg</strong>
                  </span>
                  {guestsAtTarget !== null && (
                    <span className="text-muted">
                      genoeg voor ±{" "}
                      <strong
                        className={guestsAtTarget < menu.person_count ? "text-copper" : "text-foreground"}
                      >
                        {guestsAtTarget} gasten
                      </strong>{" "}
                      bij {fmtG(targetGrams)} g p.p.
                    </span>
                  )}
                  {countLines > 0 && (
                    <span className="text-xs text-muted">
                      ({countLines} regel{countLines === 1 ? "" : "s"} in stuks niet meegeteld)
                    </span>
                  )}
                </div>
              )}
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
                <div className="border-t border-border pt-3 sm:col-span-2">
                  <Button variant="danger" size="sm" onClick={() => void deleteMenu()}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Menu verwijderen
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Samenstelling</CardTitle>
                <div className="flex gap-2">
                  <MenuGramDistribution menuId={id} units={units} onDone={() => void load()} />
                  <Link href={`/menus/${id}/importeren`}>
                    <Button variant="secondary" size="sm">
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      Sheet importeren
                    </Button>
                  </Link>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setAddingLine(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Regel toevoegen
                  </Button>
                </div>
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
                        <th className="px-2 py-2 pl-8 font-medium">Naam</th>
                        <th className="px-2 py-2 font-medium">Onderdeel</th>
                        <th className="px-2 py-2 text-right font-medium">Per persoon</th>
                        <th className="px-2 py-2 text-right font-medium">Deelname</th>
                        <th className="px-2 py-2 text-center font-medium">Vast</th>
                        <th className="px-2 py-2 text-right font-medium">Totaal</th>
                        {canViewFinancial && (
                          <>
                            <th className="px-2 py-2 text-right font-medium">Prijs</th>
                            <th className="px-2 py-2 text-right font-medium">p.p.</th>
                            <th className="px-2 py-2 text-right font-medium">Kostprijs</th>
                          </>
                        )}
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sectionGroups.map(([sectionName, group], groupIndex) => {
                        const isCollapsed = collapsed.has(sectionName);
                        const subtotal = group.reduce((sum, l) => sum + (l.total_cost ?? 0), 0);
                        return (
                          <Fragment key={sectionName}>
                            <tr className="border-t border-border bg-background">
                              <td colSpan={canViewFinancial ? 8 : 6} className="px-4 py-2">
                                <div className="flex items-center gap-2">
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
                                  {(() => {
                                    const g = group.reduce((t, l) => t + (gramsPerPerson(l) ?? 0), 0);
                                    return g > 0 ? (
                                      <span className="ml-1 text-xs font-normal text-muted">
                                        · {fmtG(g)} g p.p.
                                      </span>
                                    ) : null;
                                  })()}
                                </button>
                                {sectionName !== "Overig" && (
                                  <span className="flex items-center gap-0.5 text-muted">
                                    <button
                                      type="button"
                                      disabled={groupIndex === 0}
                                      onClick={() =>
                                        moveSection(
                                          sectionGroups.map((g) => g[0]),
                                          sectionName,
                                          -1,
                                        )
                                      }
                                      className="rounded p-1 hover:bg-teal/10 hover:text-teal disabled:opacity-30"
                                      title="Onderdeel omhoog"
                                    >
                                      <ArrowUp className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={groupIndex === sectionGroups.length - 1}
                                      onClick={() =>
                                        moveSection(
                                          sectionGroups.map((g) => g[0]),
                                          sectionName,
                                          1,
                                        )
                                      }
                                      className="rounded p-1 hover:bg-teal/10 hover:text-teal disabled:opacity-30"
                                      title="Onderdeel omlaag"
                                    >
                                      <ArrowDown className="h-3.5 w-3.5" />
                                    </button>
                                  </span>
                                )}
                                </div>
                              </td>
                              {canViewFinancial && (
                                <td className="px-4 py-2 text-right tabular font-medium">
                                  € {subtotal.toFixed(2)}
                                </td>
                              )}
                              <td />
                            </tr>
                            {!isCollapsed &&
                              group.map((l) => {
                                const plan = partyPlan[l.line_id];
                                const cell = "px-2 py-1.5 align-middle";
                                const ghost =
                                  "rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-teal focus:bg-surface";
                                const showNote = Boolean(l.note) || openNotes.has(l.line_id);
                                return (
                                <tr key={l.line_id} className="group border-t border-border hover:bg-background/60">
                                  <td className={`${cell} pl-8`}>
                                    <div className="flex min-w-[13rem] items-center gap-1.5">
                                      <span className="font-medium">{l.display_name}</span>
                                      <span
                                        className="rounded bg-background px-1.5 py-px text-[10px] uppercase tracking-wide text-muted"
                                        title={l.line_type}
                                      >
                                        {l.line_type === "halfproduct"
                                          ? "HP"
                                          : l.line_type === "gerecht"
                                            ? "G"
                                            : "ING"}
                                      </span>
                                      {lineTargets[l.line_id] && (
                                        <Link
                                          href={lineTargets[l.line_id].href}
                                          target="_blank"
                                          // Het adres van dit menu meegeven, zodat "Terug" na
                                          // opslaan of annuleren weer hier uitkomt.
                                          onClick={(e) => {
                                            e.currentTarget.href = withReturnTo(lineTargets[l.line_id].href);
                                          }}
                                          className="text-muted hover:text-teal"
                                          title={lineTargets[l.line_id].label}
                                        >
                                          <ExternalLink className="h-3.5 w-3.5" />
                                        </Link>
                                      )}
                                      {!showNote && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setOpenNotes((prev) => new Set(prev).add(l.line_id))
                                          }
                                          className="text-muted opacity-0 hover:text-teal group-hover:opacity-100"
                                          title="Opmerking toevoegen"
                                        >
                                          <MessageSquarePlus className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                    {showNote && (
                                      <input
                                        autoFocus={!l.note}
                                        defaultValue={l.note ?? ""}
                                        onBlur={(e) => {
                                          const v = e.target.value.trim() || null;
                                          if (v !== (l.note ?? null)) updateLine(l.line_id, { note: v });
                                          if (!v)
                                            setOpenNotes((prev) => {
                                              const next = new Set(prev);
                                              next.delete(l.line_id);
                                              return next;
                                            });
                                        }}
                                        placeholder="opmerking…"
                                        className={`${ghost} mt-0.5 block w-full text-xs text-muted`}
                                      />
                                    )}
                                  </td>
                                  <td className={cell}>
                                    <input
                                      defaultValue={l.section_name === "Overig" ? "" : l.section_name}
                                      onBlur={(e) => {
                                        const v = e.target.value.trim();
                                        const current = l.section_name === "Overig" ? "" : l.section_name;
                                        if (v !== current) updateSection(l.line_id, v);
                                      }}
                                      placeholder="onderdeel"
                                      list="menu-secties"
                                      className={`${ghost} w-28 text-sm text-muted`}
                                    />
                                  </td>
                                  <td className={`${cell} whitespace-nowrap`}>
                                    <div className="flex items-center justify-end gap-1">
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
                                        className={`${ghost} w-16 border-border! text-right text-sm tabular`}
                                      />
                                      <select
                                        value={units.find((u) => u.name === l.unit_name)?.id ?? ""}
                                        onChange={(e) => updateLine(l.line_id, { unit_id: e.target.value })}
                                        className={`${ghost} w-20 text-xs text-muted`}
                                      >
                                        {units.map((u) => (
                                          <option key={u.id} value={u.id}>
                                            {u.name}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  </td>
                                  <td className={`${cell} whitespace-nowrap text-right`}>
                                    {l.is_fixed ? (
                                      <span className="text-xs text-muted">—</span>
                                    ) : (
                                      <span className="inline-flex items-center gap-0.5 text-xs text-muted">
                                        <input
                                          key={`pct-${l.line_id}-${lineExtra[l.line_id]?.pct ?? 100}`}
                                          type="number"
                                          min="0"
                                          max="100"
                                          step="any"
                                          defaultValue={lineExtra[l.line_id]?.pct ?? 100}
                                          onBlur={(e) => {
                                            const v = Number(e.target.value);
                                            const cur = lineExtra[l.line_id]?.pct ?? 100;
                                            if (v >= 0 && v <= 100 && v !== cur)
                                              updateLine(l.line_id, { participation_pct: v });
                                          }}
                                          title="Deelnamefactor: welk deel van de gasten neemt dit gerecht"
                                          className={`${ghost} w-12 text-right tabular ${
                                            (lineExtra[l.line_id]?.pct ?? 100) !== 100 ? "text-foreground" : ""
                                          }`}
                                        />
                                        %
                                      </span>
                                    )}
                                  </td>
                                  <td className={`${cell} text-center`}>
                                    <input
                                      type="checkbox"
                                      checked={l.is_fixed}
                                      onChange={(e) => updateLine(l.line_id, { is_fixed: e.target.checked })}
                                      title="Vaste hoeveelheid: telt één keer voor het hele menu"
                                    />
                                  </td>
                                  <td className={`${cell} whitespace-nowrap text-right tabular`}>
                                    <span className="font-medium">
                                      {l.total_quantity.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}
                                    </span>{" "}
                                    <span className="text-xs text-muted">{unitShort(l.unit_name)}</span>
                                    {plan && (
                                      <div className="text-xs text-teal">
                                        {plan.containers} {containerLabel(plan.container, plan.containers)}
                                        {Number(plan.difference) > 0 && (
                                          <span className="text-muted">
                                            {" "}
                                            +{Number(plan.difference).toLocaleString("nl-NL", {
                                              maximumFractionDigits: 0,
                                            })}
                                          </span>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updateLine(l.line_id, { full_containers: !plan.full_containers })
                                          }
                                          className="ml-1 text-muted underline decoration-dotted"
                                          title="Wisselen tussen volle vormen en laatste vorm aanpassen"
                                        >
                                          {plan.full_containers ? "vol" : "aangepast"}
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                  {canViewFinancial && (
                                    <>
                                      <td className={`${cell} whitespace-nowrap text-right text-xs tabular text-muted`}>
                                        {l.unit_price !== null
                                          ? `€ ${l.unit_price.toFixed(l.unit_price < 1 ? 4 : 2)} / ${unitShort(l.unit_price_label)}`
                                          : "—"}
                                      </td>
                                      <td className={`${cell} whitespace-nowrap text-right tabular`}>
                                        {l.cost_per_person !== null ? `€ ${l.cost_per_person.toFixed(2)}` : "—"}
                                      </td>
                                      <td className={`${cell} whitespace-nowrap text-right tabular font-medium`}>
                                        {l.total_cost !== null ? `€ ${l.total_cost.toFixed(2)}` : "—"}
                                      </td>
                                    </>
                                  )}
                                  <td className={`${cell} pr-3`}>
                                    <button
                                      onClick={() => deleteLine(l.line_id)}
                                      title="Regel verwijderen"
                                      className="text-muted opacity-40 hover:text-danger group-hover:opacity-100"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </td>
                                </tr>
                                );
                              })}
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
                {Object.keys(partyPlan).length > 0 &&
                  (() => {
                    const rows = Object.values(partyPlan);
                    const planned = rows.reduce((t, p) => t + Number(p.total_cost ?? 0), 0);
                    const over = rows.reduce((t, p) => t + Number(p.overproduction_cost ?? 0), 0);
                    return (
                      <>
                        <Row
                          label="waarvan partijgerechten (geplande productie, per vorm)"
                          value={`€ ${planned.toFixed(2)}`}
                        />
                        {over > 0 && (
                          <Row
                            label="waarvan overproductie door afronden op volle vormen"
                            value={`€ ${over.toFixed(2)}`}
                          />
                        )}
                      </>
                    );
                  })()}
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
            companyId={referenceCompanyId}
          />
        )}

        {tab === "bestellijst" && <MenuOrderList menuId={id} />}

        {tab === "nacalculatie" && (
          <MenuNacalculatie
            menu={menu}
            lines={lines}
            referenceCompanyId={referenceCompanyId}
            canViewFinancial={canViewFinancial}
            units={units}
            onSaveMenu={saveMenu}
          />
        )}
      </main>
      {addingLine && (
        <Modal title="Regel toevoegen" onClose={() => setAddingLine(false)}>
          <MenuLineForm
            id={id}
            onDone={() => {
              setAddingLine(false);
              load();
            }}
            onCancel={() => setAddingLine(false)}
          />
        </Modal>
      )}
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

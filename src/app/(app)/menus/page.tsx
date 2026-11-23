"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, FolderInput, FolderPlus, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { cn } from "@/lib/utils";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { ConfigurableTable } from "@/components/ui/configurable-table";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import type { EventMenu, EventMenuFolder } from "@/lib/types/database";
import type { CostStatus } from "@/lib/costing/status";
import { CostAmount, CostIncompleteBadge } from "@/components/costing/cost-status";
import { foodcostPct as calcFoodcostPct, menuSales } from "@/lib/menus/sales";
import { toCostStatus } from "@/lib/costing/status";
import type { EventMenuCharge } from "@/lib/types/database";

/** "Actueel" = menu's zonder map (standaard in beeld). */
const ACTUEEL = "__actueel__";
const ALLE = "__alle__";

interface MenuRow extends EventMenu {
  companyName: string | null;
  totalCost: number | null;
  costStatus: CostStatus | null;
  /** Eten-omzet excl. btw (basis × max(gasten, minimum) + gekozen opties). */
  foodExcl: number;
}

/**
 * Overzicht van menu's, buffetten en arrangementen. Kostprijzen worden
 * per menu opgehaald uit dezelfde centrale kostprijsfuncties als de rest
 * van het platform.
 */
export default function MenusPage() {
  const router = useRouter();
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const { can } = usePermissions();
  const canViewFinancial = can("menukaarten").canViewFinancial;

  const [rows, setRows] = useState<MenuRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState<EventMenuFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>(ACTUEEL);
  const [query, setQuery] = useState("");
  const [columnFilterActive, setColumnFilterActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [costsLoading, setCostsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const [{ data: menus }, { data: companies }, { data: folderRows }, { data: secRows }, { data: chRows }] =
        await Promise.all([
          supabase.from("event_menus").select("*").order("service_date", { ascending: false }),
          supabase.from("companies").select("id, name"),
          supabase.from("event_menu_folders").select("*").order("sort_order").order("name"),
          supabase.from("event_menu_sections").select("menu_id, name, option_price_pp, is_selected").limit(10000),
          supabase.from("event_menu_charges").select("*").limit(10000),
        ]);
      if (!cancelled) setFolders((folderRows as EventMenuFolder[]) ?? []);
      if (cancelled || !menus) {
        setLoading(false);
        return;
      }
      const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));

      // 1. Menu's direct tonen (snel); kostprijs volgt in één verzoek.
      const base: MenuRow[] = (menus as EventMenu[]).map((m) => {
        const sales = menuSales({
          personCount: m.person_count,
          minPersons: m.min_persons ?? null,
          pricePerPerson: m.sales_price_per_person,
          vatRate: m.vat_rate,
          sections: (secRows ?? [])
            .filter((x) => x.menu_id === m.id)
            .map((x) => ({ name: x.name, option_price_pp: x.option_price_pp ?? null, is_selected: x.is_selected ?? true })),
          charges: ((chRows as EventMenuCharge[]) ?? []).filter((c) => c.menu_id === m.id),
        });
        return {
          ...m,
          companyName: m.company_id ? companyName.get(m.company_id) ?? null : null,
          totalCost: null,
          costStatus: null,
          foodExcl: sales.foodExcl,
        };
      });
      if (cancelled) return;
      setRows(base);
      setLoading(false);

      // 2. Kostprijs + controle van alle menu's in één keer.
      if (!canViewFinancial || !referenceCompanyId) return;
      setCostsLoading(true);
      const { data: overview } = await supabase.rpc("event_menus_overview", {
        p_company_id: referenceCompanyId,
      });
      if (cancelled) return;
      const byId = new Map(
        ((overview ?? []) as { menu_id: string; total_cost: number | null; is_complete: boolean; issues: unknown }[]).map(
          (o) => [o.menu_id, o],
        ),
      );
      setRows((prev) =>
        prev.map((r) => {
          const o = byId.get(r.id);
          if (!o) return r;
          return {
            ...r,
            totalCost: o.total_cost === null ? null : Number(o.total_cost),
            costStatus: toCostStatus({ is_complete: o.is_complete, issues: o.issues }),
          };
        }),
      );
      setCostsLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [referenceCompanyId, canViewFinancial]);

  const costPerPerson = (r: MenuRow) =>
    r.totalCost !== null && r.person_count > 0 ? r.totalCost / r.person_count : null;

  const incomplete = (r: MenuRow) => r.costStatus?.isComplete === false;

  // Zelfde rekenregel als op het menu zelf (minimum personen + gekozen opties).
  const foodcost = (r: MenuRow) => (incomplete(r) ? null : calcFoodcostPct(r.totalCost, r.foodExcl));
  const margin = (r: MenuRow) =>
    incomplete(r) || r.totalCost === null || !(r.foodExcl > 0) ? null : r.foodExcl - r.totalCost;

  const folderName = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);
  const q = query.trim().toLowerCase();
  // Zoeken (zoekveld of kolomfilter) kijkt altijd in álle menu's, ook in mappen.
  const searching = q.length > 0 || columnFilterActive;
  const visibleRows = useMemo(() => {
    if (searching) {
      return q
        ? rows.filter((r) =>
            [r.name, r.category, r.menu_type, r.folder_id ? folderName.get(r.folder_id) : "Actueel"]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q)),
          )
        : rows;
    }
    if (activeFolder === ALLE) return rows;
    if (activeFolder === ACTUEEL) return rows.filter((r) => !r.folder_id);
    return rows.filter((r) => r.folder_id === activeFolder);
  }, [rows, searching, q, activeFolder, folderName]);
  const countIn = (id: string | null) => rows.filter((r) => (r.folder_id ?? null) === id).length;

  async function addFolder(): Promise<string | null> {
    const name = window.prompt("Naam van de nieuwe map (bv. Afgelopen evenementen 2026):");
    if (!name?.trim()) return null;
    const supabase = createClient();
    const groupId = await getCurrentGroupId(supabase);
    if (!groupId) return null;
    const { data, error } = await supabase
      .from("event_menu_folders")
      .insert({ group_id: groupId, name: name.trim(), sort_order: folders.length })
      .select()
      .single();
    if (error || !data) {
      window.alert("Map aanmaken mislukt: " + (error?.message ?? "onbekende fout"));
      return null;
    }
    setFolders((prev) => [...prev, data as EventMenuFolder]);
    return (data as EventMenuFolder).id;
  }

  async function renameFolder(f: EventMenuFolder) {
    const name = window.prompt("Nieuwe naam:", f.name);
    if (!name?.trim() || name.trim() === f.name) return;
    const { error } = await createClient()
      .from("event_menu_folders")
      .update({ name: name.trim() })
      .eq("id", f.id);
    if (error) return window.alert("Hernoemen mislukt: " + error.message);
    setFolders((prev) => prev.map((x) => (x.id === f.id ? { ...x, name: name.trim() } : x)));
  }

  async function deleteFolder(f: EventMenuFolder) {
    const n = countIn(f.id);
    if (
      !window.confirm(
        `Map "${f.name}" verwijderen?\n\n` +
          (n > 0
            ? `De ${n} menu('s) in deze map worden NIET verwijderd — ze komen terug bij Actueel.`
            : "Deze map is leeg."),
      )
    )
      return;
    const { error } = await createClient().from("event_menu_folders").delete().eq("id", f.id);
    if (error) return window.alert("Map verwijderen mislukt: " + error.message);
    setFolders((prev) => prev.filter((x) => x.id !== f.id));
    setRows((prev) => prev.map((r) => (r.folder_id === f.id ? { ...r, folder_id: null } : r)));
    if (activeFolder === f.id) setActiveFolder(ACTUEEL);
  }

  /** Alleen folder_id verandert; menu, regels en kostprijs blijven zoals ze zijn. */
  async function moveSelected(target: string) {
    if (selectedIds.size === 0) return;
    let folderId: string | null = target === ACTUEEL ? null : target;
    if (target === "__nieuw__") {
      folderId = await addFolder();
      if (!folderId) return;
    }
    setBusy(true);
    const ids = [...selectedIds];
    const { error } = await createClient().from("event_menus").update({ folder_id: folderId }).in("id", ids);
    setBusy(false);
    if (error) return window.alert("Verplaatsen mislukt: " + error.message);
    setRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, folder_id: folderId } : r)));
    setSelectedIds(new Set());
  }

  const navItem = (key: string, label: string, count: number) => (
    <button
      key={key}
      type="button"
      onClick={() => {
        setActiveFolder(key);
        setQuery("");
      }}
      className={cn(
        "flex w-full items-center rounded-md px-2 py-2.5 text-left text-sm hover:bg-background",
        !searching && activeFolder === key && "bg-teal/10 font-medium text-teal",
      )}
    >
      <span className="flex-1 truncate">{label}</span>
      <span className="text-xs text-muted">{count}</span>
    </button>
  );

  return (
    <>
      <Topbar title="Menu's & buffetten" />
      <main className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[230px_1fr] md:p-6">
        <Card className="h-fit">
          <CardContent className="p-2">
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Mappen</p>
              <button type="button" onClick={() => void addFolder()} title="Nieuwe map">
                <FolderPlus className="h-4 w-4 text-muted hover:text-teal" />
              </button>
            </div>
            {navItem(ACTUEEL, "Actueel", countIn(null))}
            {folders.map((f) => (
              <div
                key={f.id}
                className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-2.5 text-sm hover:bg-background",
                  !searching && activeFolder === f.id && "bg-teal/10 font-medium text-teal",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveFolder(f.id);
                    setQuery("");
                  }}
                  className="flex-1 truncate text-left"
                >
                  {f.name}
                </button>
                <span className="text-xs text-muted group-hover:hidden">{countIn(f.id)}</span>
                <span className="hidden shrink-0 items-center gap-1.5 group-hover:flex">
                  <button type="button" onClick={() => void renameFolder(f)} title="Hernoemen">
                    <Pencil className="h-3.5 w-3.5 text-muted hover:text-teal" />
                  </button>
                  <button type="button" onClick={() => void deleteFolder(f)} title="Verwijderen">
                    <Trash2 className="h-3.5 w-3.5 text-muted hover:text-danger" />
                  </button>
                </span>
              </div>
            ))}
            {navItem(ALLE, "Alle menu's", rows.length)}
            {folders.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted">
                Zet afgelopen menu&apos;s in een map: vink ze aan en kies &quot;Verplaatsen naar&quot;. Ze
                blijven vindbaar via zoeken.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Stel een menu, buffet of arrangement samen en reken het automatisch door op
            het aantal personen — tot en met de productiewerklijst en de bestellijst.
          </p>
          <div className="flex shrink-0 gap-2">
            <Link href="/menus/nieuw?sheet=1">
              <Button variant="secondary">
                <FileSpreadsheet className="h-4 w-4" />
                Nieuw uit sheet
              </Button>
            </Link>
            <Link href="/menus/nieuw">
              <Button>
                <Plus className="h-4 w-4" />
                Nieuw menu of buffet
              </Button>
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoeken in alle menu's, ook in mappen…"
              className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
            />
          </div>
          {selectedIds.size > 0 && (
            <label className="flex items-center gap-2 rounded-md border border-teal/40 bg-teal/5 px-3 py-1.5 text-sm">
              <FolderInput className="h-4 w-4 text-teal" />
              {selectedIds.size} geselecteerd — verplaatsen naar
              <select
                value=""
                disabled={busy}
                onChange={(e) => e.target.value && void moveSelected(e.target.value)}
                className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
              >
                <option value="">Kies…</option>
                <option value={ACTUEEL}>Actueel (geen map)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
                <option value="__nieuw__">+ Nieuwe map…</option>
              </select>
            </label>
          )}
        </div>
        {searching && (
          <p className="text-xs text-muted">
            Zoekresultaten uit alle menu&apos;s en mappen.
          </p>
        )}

        <ConfigurableTable<MenuRow>
          storageKey="menus"
          rows={visibleRows}
          countLabel="menu's"
          onFilterActiveChange={setColumnFilterActive}
          selectedIds={selectedIds}
          onToggleSelect={(id) =>
            setSelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onToggleSelectAll={(ids) =>
            setSelectedIds((prev) => (ids.every((id) => prev.has(id)) ? new Set() : new Set(ids)))
          }
          onRowClick={(r) => router.push(`/menus/${r.id}`)}
          emptyLabel={
            loading
              ? "Menu's laden…"
              : searching
                ? "Geen menu's gevonden."
                : rows.length === 0
                  ? "Nog geen menu's of buffetten."
                  : activeFolder === ACTUEEL
                    ? "Alles staat in mappen — kies links een map of zoek bovenaan."
                    : "Deze map is leeg. Vink menu's aan en kies \"verplaatsen naar\" om ze hierheen te zetten."
          }
          columns={[
            { key: "naam", label: "Naam", width: 220, sticky: true, value: (r) => r.name },
            { key: "type", label: "Type", width: 120, value: (r) => r.menu_type },
            { key: "cat", label: "Categorie", width: 130, value: (r) => r.category },
            { key: "loc", label: "Locatie", width: 130, value: (r) => r.companyName ?? "groepsbreed" },
            {
              key: "map",
              label: "Map",
              width: 150,
              value: (r) => (r.folder_id ? (folderName.get(r.folder_id) ?? "") : "Actueel"),
            },
            {
              key: "pers",
              label: "Personen",
              width: 90,
              align: "right",
              value: (r) => r.person_count,
            },
            ...(canViewFinancial
              ? [
                  {
                    key: "vkpp",
                    label: "Verkoop p.p.",
                    width: 110,
                    align: "right" as const,
                    value: (r: MenuRow) => r.sales_price_per_person,
                    render: (r: MenuRow) =>
                      r.sales_price_per_person
                        ? `€ ${r.sales_price_per_person.toFixed(2)}`
                        : "—",
                  },
                  {
                    key: "kpp",
                    label: "Kostprijs p.p.",
                    width: 110,
                    align: "right" as const,
                    value: (r: MenuRow) => costPerPerson(r),
                    render: (r: MenuRow) =>
                      costsLoading && !r.costStatus ? (
                        <span className="text-muted">…</span>
                      ) : (
                        <CostAmount amount={costPerPerson(r)} status={r.costStatus} />
                      ),
                  },
                  {
                    key: "totaal",
                    label: "Totale kostprijs",
                    width: 120,
                    align: "right" as const,
                    value: (r: MenuRow) => r.totalCost,
                    render: (r: MenuRow) =>
                      costsLoading && !r.costStatus ? (
                        <span className="text-muted">…</span>
                      ) : (
                        <CostAmount amount={r.totalCost} status={r.costStatus} />
                      ),
                  },
                  {
                    key: "fc",
                    label: "Foodcost %",
                    width: 100,
                    align: "right" as const,
                    value: (r: MenuRow) => foodcost(r),
                    render: (r: MenuRow) => {
                      if (incomplete(r)) return <CostIncompleteBadge status={r.costStatus} />;
                      const f = foodcost(r);
                      if (f === null) return "—";
                      return (
                        <span className={f > 33 ? "text-danger" : "text-success"}>
                          {f.toFixed(1)}%
                        </span>
                      );
                    },
                  },
                  {
                    key: "marge",
                    label: "Brutomarge",
                    width: 110,
                    align: "right" as const,
                    value: (r: MenuRow) => margin(r),
                    render: (r: MenuRow) => {
                      const m = margin(r);
                      return m === null ? "—" : `€ ${m.toFixed(2)}`;
                    },
                  },
                ]
              : []),
            {
              key: "datum",
              label: "Datum",
              width: 110,
              value: (r) => r.service_date,
              render: (r) =>
                r.service_date
                  ? new Date(r.service_date).toLocaleDateString("nl-NL")
                  : "—",
            },
            {
              key: "status",
              label: "Status",
              width: 110,
              value: (r) => (r.is_template ? "sjabloon" : r.status),
            },
          ]}
        />
        </div>
      </main>
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, ListPlus, Pencil, Plus } from "lucide-react";
import { useCompanyScope } from "@/components/company-context";
import { Topbar } from "@/components/layout/topbar";
import { PageActions } from "@/components/layout/page-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SingleCompany } from "@/components/haccp/single-company";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  FREQUENCIES,
  MONTHS,
  STANDARD_AREAS,
  STANDARD_TASKS,
  WEEKDAYS,
  describeFrequency,
  haccpError,
} from "@/lib/haccp/cleaning";
import type {
  HaccpArea,
  HaccpFrequency,
  HaccpTask,
} from "@/lib/types/database";

export default function HaccpPlanPage() {
  return (
    <>
      <Topbar title="Schoonmaakplan" />
      <SingleCompany>
        {(companyId) => <Plan key={companyId} companyId={companyId} />}
      </SingleCompany>
    </>
  );
}

interface Dept {
  id: string;
  name: string;
}

type Draft = {
  id: string | null;
  area_id: string;
  title: string;
  frequency: HaccpFrequency;
  times_per_day: number;
  weekday: number;
  month_day: number;
  month: number;
  department_id: string;
  instruction: string;
  cleaning_agent: string;
  is_active: boolean;
  requires_check: boolean;
};

const inputCls =
  "h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground focus:border-teal focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-foreground";

function Plan({ companyId }: { companyId: string }) {
  const { can } = usePermissions();
  const canEdit = can("haccp_plan").canEdit;

  const [areas, setAreas] = useState<HaccpArea[] | null>(null);
  const [tasks, setTasks] = useState<HaccpTask[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newArea, setNewArea] = useState<string | null>(null);
  const [standardOpen, setStandardOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const { companies } = useCompanyScope();

  const load = useCallback(async () => {
    const supabase = createClient();
    const [a, t, d] = await Promise.all([
      supabase
        .from("haccp_areas")
        .select("*")
        .eq("company_id", companyId)
        .order("sort_order")
        .order("name"),
      supabase
        .from("haccp_tasks")
        .select("*")
        .eq("company_id", companyId)
        .order("sort_order")
        .order("title"),
      supabase
        .from("departments")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
    ]);
    const err = a.error ?? t.error ?? d.error;
    if (err) setError(haccpError(err));
    setAreas((a.data as HaccpArea[]) ?? []);
    setTasks((t.data as HaccpTask[]) ?? []);
    setDepts((d.data as Dept[]) ?? []);
  }, [companyId]);

  useEffect(() => {
    // load() zet pas state na het ophalen (asynchroon), niet direct in het effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const activeAreas = (areas ?? []).filter((a) => a.is_active);
  const deptName = useMemo(
    () => new Map(depts.map((d) => [d.id, d.name])),
    [depts],
  );

  function startNew(areaId?: string) {
    setDraft({
      id: null,
      area_id: areaId ?? activeAreas[0]?.id ?? "",
      title: "",
      frequency: "dagelijks",
      times_per_day: 2,
      weekday: 1,
      month_day: 1,
      month: 1,
      department_id: "",
      instruction: "",
      cleaning_agent: "",
      is_active: true,
      requires_check: false,
    });
  }

  function startEdit(t: HaccpTask) {
    setDraft({
      id: t.id,
      area_id: t.area_id,
      title: t.title,
      frequency: t.frequency,
      times_per_day: t.times_per_day,
      weekday: t.weekday ?? 1,
      month_day: t.month_day ?? 1,
      month: t.month ?? 1,
      department_id: t.department_id ?? "",
      instruction: t.instruction ?? "",
      cleaning_agent: t.cleaning_agent ?? "",
      is_active: t.is_active,
      requires_check: t.requires_check,
    });
  }

  async function saveDraft(activeOverride?: boolean) {
    if (!draft) return;
    if (!draft.title.trim())
      return setError("Vul in wat er schoongemaakt moet worden.");
    if (!draft.area_id) return setError("Kies een ruimte.");
    setSaving(true);
    setError(null);
    const f = draft.frequency;
    const row = {
      area_id: draft.area_id,
      title: draft.title.trim(),
      frequency: f,
      times_per_day: f === "meerdere_per_dag" ? draft.times_per_day : 1,
      weekday: f === "wekelijks" ? draft.weekday : null,
      month_day: ["maandelijks", "kwartaal", "jaarlijks"].includes(f)
        ? draft.month_day
        : null,
      month: ["kwartaal", "jaarlijks"].includes(f) ? draft.month : null,
      department_id: draft.department_id || null,
      instruction: draft.instruction.trim() || null,
      cleaning_agent: draft.cleaning_agent.trim() || null,
      is_active: activeOverride ?? draft.is_active,
      requires_check: draft.requires_check,
    };
    const supabase = createClient();
    const res = draft.id
      ? await supabase.from("haccp_tasks").update(row).eq("id", draft.id)
      : await supabase
          .from("haccp_tasks")
          .insert({ ...row, company_id: companyId });
    setSaving(false);
    if (res.error) return setError(haccpError(res.error));
    setDraft(null);
    await load();
  }

  async function addArea() {
    const name = (newArea ?? "").trim();
    if (!name) return;
    const maxSort = Math.max(0, ...(areas ?? []).map((a) => a.sort_order));
    const { error: err } = await createClient()
      .from("haccp_areas")
      .insert({ company_id: companyId, name, sort_order: maxSort + 10 });
    if (err) {
      setError(
        /duplicate|unique/i.test(err.message)
          ? "Deze ruimte bestaat al."
          : haccpError(err),
      );
      return;
    }
    setNewArea(null);
    await load();
  }

  const visibleTasks = tasks.filter((t) => showInactive || t.is_active);
  const inactiveCount = tasks.filter((t) => !t.is_active).length;

  return (
    <div className="mx-auto max-w-4xl p-3 sm:p-6">
      {canEdit && (
        <PageActions>
          {companies.length > 1 && activeAreas.length > 0 && (
            <Button variant="ghost" onClick={() => setCopyOpen(true)}>
              <Copy className="h-4 w-4" />
              Kopiëren naar…
            </Button>
          )}
          <Button variant="secondary" onClick={() => setStandardOpen(true)}>
            <ListPlus className="h-4 w-4" />
            Standaardtaken
          </Button>
          <Button variant="secondary" onClick={() => setNewArea("")}>
            <Plus className="h-4 w-4" />
            Ruimte
          </Button>
          <Button
            onClick={() => startNew()}
            disabled={activeAreas.length === 0}
          >
            <Plus className="h-4 w-4" />
            Taak
          </Button>
        </PageActions>
      )}

      {error && !draft && (
        <p className="mb-4 rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {areas === null && <p className="text-sm text-muted">Laden…</p>}

      {areas !== null && activeAreas.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="mb-4 text-sm text-muted">
            Nog geen schoonmaakplan voor dit bedrijf. Begin met de
            standaardtaken en pas ze daarna aan.
          </p>
          {canEdit && (
            <Button onClick={() => setStandardOpen(true)}>
              Standaardtaken kiezen
            </Button>
          )}
        </div>
      )}

      {activeAreas.map((area) => {
        const list = visibleTasks.filter((t) => t.area_id === area.id);
        return (
          <section
            key={area.id}
            className="mb-5 overflow-hidden rounded-lg border border-border bg-surface"
          >
            <div className="flex items-center justify-between border-b border-border bg-background px-4 py-2">
              <h2 className="text-sm font-semibold text-foreground">
                {area.name}
              </h2>
              {canEdit && (
                <button
                  onClick={() => startNew(area.id)}
                  className="text-sm font-medium text-teal"
                >
                  + Taak
                </button>
              )}
            </div>
            {list.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">Geen taken.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="hidden text-left text-xs uppercase tracking-wide text-muted sm:table-header-group">
                  <tr>
                    <th className="px-4 py-2 font-medium">Onderdeel</th>
                    <th className="px-4 py-2 font-medium">Frequentie</th>
                    <th className="px-4 py-2 font-medium">Verantwoordelijke</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => canEdit && startEdit(t)}
                      className={cn(
                        "border-t border-border",
                        canEdit && "cursor-pointer hover:bg-background",
                        !t.is_active && "opacity-50",
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-foreground">
                          {t.title}
                        </span>
                        {!t.is_active && (
                          <span className="ml-2 text-xs text-muted">
                            (uit plan)
                          </span>
                        )}
                        {(t.instruction || t.cleaning_agent) && (
                          <span className="block truncate text-xs text-muted">
                            {[
                              t.instruction,
                              t.cleaning_agent && `Middel: ${t.cleaning_agent}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                        <span className="block text-xs text-muted sm:hidden">
                          {describeFrequency(t)} ·{" "}
                          {t.department_id
                            ? deptName.get(t.department_id)
                            : "Iedereen"}
                        </span>
                      </td>
                      <td className="hidden px-4 py-2.5 text-foreground sm:table-cell">
                        {describeFrequency(t)}
                        {t.requires_check && (
                          <span className="ml-2 rounded-full bg-copper/15 px-2 py-0.5 text-xs text-copper">
                            controle
                          </span>
                        )}
                      </td>
                      <td className="hidden px-4 py-2.5 text-foreground sm:table-cell">
                        {t.department_id
                          ? (deptName.get(t.department_id) ?? "—")
                          : "Iedereen"}
                      </td>
                      <td className="px-2 text-muted">
                        {canEdit && <Pencil className="h-4 w-4" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}

      {inactiveCount > 0 && (
        <button
          onClick={() => setShowInactive((v) => !v)}
          className="text-sm text-muted underline"
        >
          {showInactive ? "Verberg" : "Toon"} uit het plan gehaalde taken (
          {inactiveCount})
        </button>
      )}

      {newArea !== null && (
        <Modal title="Ruimte toevoegen" onClose={() => setNewArea(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void addArea();
            }}
            className="space-y-4"
          >
            <input
              autoFocus
              className={inputCls}
              placeholder="Bijv. Warme keuken, Koelcel 2, Bar"
              value={newArea}
              onChange={(e) => setNewArea(e.target.value)}
            />
            <div className="flex justify-end">
              <Button type="submit">Toevoegen</Button>
            </div>
          </form>
        </Modal>
      )}

      {draft && (
        <Modal
          title={draft.id ? "Taak aanpassen" : "Taak toevoegen"}
          onClose={() => setDraft(null)}
        >
          <form
            id="haccp-task-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveDraft();
            }}
            className="space-y-4"
          >
            <PageActions inline>
              {draft.id && (
                <Button
                  type="button"
                  variant={draft.is_active ? "danger" : "secondary"}
                  disabled={saving}
                  onClick={() => void saveDraft(!draft.is_active)}
                >
                  {draft.is_active ? "Uit plan halen" : "Terugzetten in plan"}
                </Button>
              )}
              <Button type="submit" disabled={saving}>
                {saving ? "Opslaan…" : "Opslaan"}
              </Button>
            </PageActions>

            {error && (
              <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            <div>
              <label className={labelCls}>Wat moet worden schoongemaakt?</label>
              <input
                autoFocus={!draft.id}
                className={inputCls}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Bijv. Werkbanken reinigen"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Ruimte</label>
                <select
                  className={inputCls}
                  value={draft.area_id}
                  onChange={(e) =>
                    setDraft({ ...draft, area_id: e.target.value })
                  }
                >
                  {activeAreas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Wie is verantwoordelijk?</label>
                <select
                  className={inputCls}
                  value={draft.department_id}
                  onChange={(e) =>
                    setDraft({ ...draft, department_id: e.target.value })
                  }
                >
                  <option value="">Iedereen</option>
                  {depts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Hoe vaak?</label>
                <select
                  className={inputCls}
                  value={draft.frequency}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      frequency: e.target.value as HaccpFrequency,
                    })
                  }
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <FrequencyDetail draft={draft} setDraft={setDraft} />
            </div>

            <div>
              <label className={labelCls}>
                Werkinstructie{" "}
                <span className="font-normal text-muted">(optioneel)</span>
              </label>
              <textarea
                rows={3}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-teal focus:outline-none"
                value={draft.instruction}
                onChange={(e) =>
                  setDraft({ ...draft, instruction: e.target.value })
                }
                placeholder="Bijv. Ontvetten, nawassen met heet water, desinfecteren, laten drogen."
              />
            </div>
            <div>
              <label className={labelCls}>
                Schoonmaakmiddel{" "}
                <span className="font-normal text-muted">(optioneel)</span>
              </label>
              <input
                className={inputCls}
                value={draft.cleaning_agent}
                onChange={(e) =>
                  setDraft({ ...draft, cleaning_agent: e.target.value })
                }
              />
            </div>
            <label className="flex items-start gap-3 rounded-md border border-border bg-surface p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5"
                checked={draft.requires_check}
                onChange={(e) =>
                  setDraft({ ...draft, requires_check: e.target.checked })
                }
              />
              <span className="text-sm">
                <span className="font-medium text-foreground">
                  Controle door leidinggevende
                </span>
                <span className="block text-xs text-muted">
                  Na afmelden verschijnt de taak bij Controle om goed of af te
                  keuren. Gebruik dit alleen waar het nodig is, bv. grondige
                  reiniging of periodieke controles.
                </span>
              </span>
            </label>
            {draft.id && (
              <p className="text-xs text-muted">
                Wijzigingen gelden vanaf nu. Eerdere registraties blijven
                gekoppeld aan de taakomschrijving die toen gold.
              </p>
            )}
          </form>
        </Modal>
      )}

      {copyOpen && (
        <CopyPlanModal
          fromId={companyId}
          companies={companies.filter((c) => c.id !== companyId)}
          fromName={companies.find((c) => c.id === companyId)?.name ?? ""}
          onClose={() => setCopyOpen(false)}
        />
      )}

      {standardOpen && (
        <StandardTasksModal
          companyId={companyId}
          areas={areas ?? []}
          tasks={tasks}
          depts={depts}
          onClose={() => setStandardOpen(false)}
          onDone={async () => {
            setStandardOpen(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function FrequencyDetail({
  draft,
  setDraft,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
}) {
  switch (draft.frequency) {
    case "meerdere_per_dag":
      return (
        <div>
          <label className={labelCls}>Hoe vaak per dag?</label>
          <select
            className={inputCls}
            value={draft.times_per_day}
            onChange={(e) =>
              setDraft({ ...draft, times_per_day: Number(e.target.value) })
            }
          >
            {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </div>
      );
    case "wekelijks":
      return (
        <div>
          <label className={labelCls}>Op welke dag?</label>
          <select
            className={inputCls}
            value={draft.weekday}
            onChange={(e) =>
              setDraft({ ...draft, weekday: Number(e.target.value) })
            }
          >
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
        </div>
      );
    case "maandelijks":
      return <MonthDay draft={draft} setDraft={setDraft} />;
    case "kwartaal":
    case "jaarlijks":
      return (
        <div className="grid grid-cols-2 gap-2">
          <MonthDay draft={draft} setDraft={setDraft} />
          <div>
            <label className={labelCls}>
              {draft.frequency === "kwartaal" ? "Startmaand" : "Maand"}
            </label>
            <select
              className={inputCls}
              value={draft.month}
              onChange={(e) =>
                setDraft({ ...draft, month: Number(e.target.value) })
              }
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      );
    case "na_gebruik":
    case "handmatig":
      return (
        <p className="self-end pb-2 text-xs text-muted">
          Staat altijd klaar op het scherm Vandaag; afmelden zo vaak als nodig.
        </p>
      );
    default:
      return <div />;
  }
}

function MonthDay({
  draft,
  setDraft,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
}) {
  return (
    <div>
      <label className={labelCls}>Dag van de maand</label>
      <select
        className={inputCls}
        value={draft.month_day}
        onChange={(e) =>
          setDraft({ ...draft, month_day: Number(e.target.value) })
        }
      >
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d === 31 ? "laatste dag" : d}
          </option>
        ))}
      </select>
    </div>
  );
}

function StandardTasksModal({
  companyId,
  areas,
  tasks,
  depts,
  onClose,
  onDone,
}: {
  companyId: string;
  areas: HaccpArea[];
  tasks: HaccpTask[];
  depts: Dept[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = useMemo(() => {
    const areaName = new Map(
      areas.map((a) => [a.id, a.name.trim().toLowerCase()]),
    );
    return new Set(
      tasks
        .filter((t) => t.is_active)
        .map(
          (t) => `${areaName.get(t.area_id)}|${t.title.trim().toLowerCase()}`,
        ),
    );
  }, [areas, tasks]);

  const exists = (i: number) =>
    existing.has(
      `${STANDARD_TASKS[i].area.toLowerCase()}|${STANDARD_TASKS[i].title.toLowerCase()}`,
    );

  function toggle(i: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function toggleArea(area: string) {
    const idx = STANDARD_TASKS.map((t, i) => [t, i] as const)
      .filter(([t, i]) => t.area === area && !exists(i))
      .map(([, i]) => i);
    const allOn = idx.every((i) => picked.has(i));
    setPicked((prev) => {
      const next = new Set(prev);
      for (const i of idx) {
        if (allOn) next.delete(i);
        else next.add(i);
      }
      return next;
    });
  }

  async function add() {
    if (picked.size === 0) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const chosen = [...picked].map((i) => STANDARD_TASKS[i]);

    // Ontbrekende ruimtes aanmaken (bestaande worden hergebruikt, ook als ze uit staan).
    const areaIds = new Map(areas.map((a) => [a.name.trim().toLowerCase(), a]));
    const neededAreas = [...new Set(chosen.map((t) => t.area))].filter(
      (n) => !areaIds.has(n.toLowerCase()),
    );
    if (neededAreas.length > 0) {
      const { data, error: err } = await supabase
        .from("haccp_areas")
        .insert(
          neededAreas.map((name) => ({
            company_id: companyId,
            name,
            sort_order: (STANDARD_AREAS.indexOf(name) + 1) * 10,
          })),
        )
        .select("*");
      if (err) {
        setBusy(false);
        return setError(haccpError(err));
      }
      for (const a of (data as HaccpArea[]) ?? [])
        areaIds.set(a.name.trim().toLowerCase(), a);
    }
    const inactive = [...areaIds.values()].filter(
      (a) =>
        !a.is_active &&
        chosen.some(
          (t) => t.area.toLowerCase() === a.name.trim().toLowerCase(),
        ),
    );
    for (const a of inactive) {
      await supabase
        .from("haccp_areas")
        .update({ is_active: true })
        .eq("id", a.id);
    }

    const deptByName = new Map(
      depts.map((d) => [d.name.trim().toLowerCase(), d.id]),
    );
    const rows = chosen.map((t, i) => ({
      company_id: companyId,
      area_id: areaIds.get(t.area.toLowerCase())!.id,
      title: t.title,
      frequency: t.frequency,
      times_per_day: t.times_per_day ?? 1,
      weekday: t.weekday ?? null,
      month_day: t.month_day ?? null,
      month: t.month ?? null,
      instruction: t.instruction ?? null,
      department_id: deptByName.get(t.team.toLowerCase()) ?? null,
      sort_order: (i + 1) * 10,
    }));
    const { error: err } = await supabase.from("haccp_tasks").insert(rows);
    setBusy(false);
    if (err) return setError(haccpError(err));
    onDone();
  }

  const byArea = STANDARD_AREAS.map((area) => ({
    area,
    items: STANDARD_TASKS.map((t, i) => [t, i] as const).filter(
      ([t]) => t.area === area,
    ),
  }));

  return (
    <Modal title="Standaardtaken toevoegen" onClose={onClose}>
      <PageActions inline>
        <span className="mr-auto text-sm text-muted">
          {picked.size} gekozen
        </span>
        <Button onClick={() => void add()} disabled={busy || picked.size === 0}>
          {busy ? "Toevoegen…" : "Toevoegen aan plan"}
        </Button>
      </PageActions>
      {error && (
        <p className="my-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <p className="my-3 text-sm text-muted">
        Vink aan wat bij dit bedrijf past. Frequentie, dag en verantwoordelijke
        kun je daarna per taak aanpassen.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {byArea.map(({ area, items }) => (
          <div
            key={area}
            className="rounded-lg border border-border bg-surface p-3"
          >
            <button
              onClick={() => toggleArea(area)}
              className="mb-2 text-sm font-semibold text-foreground hover:text-teal"
            >
              {area}
            </button>
            <ul className="space-y-1">
              {items.map(([t, i]) => (
                <li key={i}>
                  <label
                    className={cn(
                      "flex items-start gap-2 text-sm",
                      exists(i) ? "text-muted" : "text-foreground",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      disabled={exists(i)}
                      checked={picked.has(i)}
                      onChange={() => toggle(i)}
                    />
                    <span>
                      {t.title}
                      <span className="block text-xs text-muted">
                        {exists(i)
                          ? "staat al in het plan"
                          : describeFrequency({
                              frequency: t.frequency,
                              times_per_day: t.times_per_day ?? 1,
                              weekday: t.weekday ?? null,
                              month_day: t.month_day ?? null,
                              month: t.month ?? null,
                            })}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function CopyPlanModal({
  fromId,
  fromName,
  companies,
  onClose,
}: {
  fromId: string;
  fromName: string;
  companies: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [target, setTarget] = useState(companies[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await createClient().rpc("haccp_copy_plan", {
      p_from_company: fromId,
      p_to_company: target,
    });
    setBusy(false);
    if (err) return setError(haccpError(err));
    const r = data as { ruimtes: number; taken: number; overgeslagen: number };
    const name = companies.find((c) => c.id === target)?.name ?? "";
    setResult(
      `${r.taken} taken en ${r.ruimtes} nieuwe ruimtes gekopieerd naar ${name}.` +
        (r.overgeslagen
          ? ` ${r.overgeslagen} taken stonden er al en zijn overgeslagen.`
          : "") +
        ` Kies bovenaan ${name} om het plan daar aan te passen.`,
    );
  }

  return (
    <Modal title="Schoonmaakplan kopiëren" onClose={onClose}>
      {result ? (
        <>
          <p className="mb-4 rounded-md bg-teal/10 px-3 py-2 text-sm text-teal">
            {result}
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Sluiten</Button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-foreground">
            Kopieer alle ruimtes en taken van <b>{fromName}</b> naar:
          </p>
          <select
            className="mb-3 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="mb-4 text-xs text-muted">
            Er wordt alleen toegevoegd: wat daar al staat blijft staan, dubbele
            taken worden overgeslagen. Daarna kun je het plan daar gewoon
            aanpassen.
          </p>
          {error && (
            <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Annuleren
            </Button>
            <Button onClick={() => void copy()} disabled={busy || !target}>
              {busy ? "Kopiëren…" : "Kopiëren"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileBarChart, FileSpreadsheet, History, Search } from "lucide-react";
import { useCompanyScope } from "@/components/company-context";
import { exportHaccpExcel } from "@/lib/haccp/report";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SingleCompany } from "@/components/haccp/single-company";
import { NotDoneDialog } from "@/components/haccp/not-done-dialog";
import { PhotoStrip } from "@/components/haccp/photos";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  formatDateNL,
  formatDateTimeNL,
  formatTimeNL,
  haccpError,
  periodRange,
  todayISO,
} from "@/lib/haccp/cleaning";
import type {
  HaccpEventRow,
  HaccpHistoryRow,
  HaccpReportEventRow,
  HaccpReportRow,
} from "@/lib/types/database";

export default function HaccpHistoriePage() {
  return (
    <>
      <Topbar title="Registratie & historie" />
      <SingleCompany>
        {(companyId) => <Historie key={companyId} companyId={companyId} />}
      </SingleCompany>
    </>
  );
}

type PeriodKey =
  | "vandaag"
  | "gisteren"
  | "week"
  | "vorige_week"
  | "maand"
  | "vorige_maand"
  | "eigen";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "vandaag", label: "Vandaag" },
  { key: "gisteren", label: "Gisteren" },
  { key: "week", label: "Deze week" },
  { key: "vorige_week", label: "Vorige week" },
  { key: "maand", label: "Deze maand" },
  { key: "vorige_maand", label: "Vorige maand" },
  { key: "eigen", label: "Periode…" },
];

type StatusFilter =
  | "alle"
  | "uitgevoerd"
  | "te_laat_uitgevoerd"
  | "te_laat"
  | "open"
  | "niet_uitgevoerd"
  | "vervallen"
  | "gecorrigeerd";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "alle", label: "Alle statussen" },
  { key: "uitgevoerd", label: "Uitgevoerd" },
  { key: "te_laat_uitgevoerd", label: "Te laat uitgevoerd" },
  { key: "te_laat", label: "Te laat (nog open)" },
  { key: "open", label: "Open (vandaag)" },
  { key: "niet_uitgevoerd", label: "Niet uitgevoerd" },
  { key: "vervallen", label: "Vervallen" },
  { key: "gecorrigeerd", label: "Met correctie" },
];

function displayStatus(r: HaccpHistoryRow, today: string) {
  if (r.status === "uitgevoerd") {
    return r.done_late
      ? { label: "Te laat uitgevoerd", cls: "bg-copper/15 text-copper" }
      : { label: "Uitgevoerd", cls: "bg-teal/10 text-teal" };
  }
  if (r.status === "open") {
    return r.due_date < today
      ? { label: "Te laat", cls: "bg-danger/10 text-danger" }
      : {
          label: "Open",
          cls: "bg-background text-foreground border border-border",
        };
  }
  if (r.status === "niet_uitgevoerd")
    return { label: "Niet uitgevoerd", cls: "bg-danger/10 text-danger" };
  const why =
    r.void_reason === "gesloten"
      ? " (gesloten)"
      : r.void_reason === "planwijziging"
        ? " (planwijziging)"
        : r.void_reason === "correctie"
          ? " (gecorrigeerd)"
          : "";
  return { label: `Vervallen${why}`, cls: "bg-background text-muted" };
}

function matchesStatus(r: HaccpHistoryRow, f: StatusFilter, today: string) {
  switch (f) {
    case "alle":
      return true;
    case "uitgevoerd":
      return r.status === "uitgevoerd";
    case "te_laat_uitgevoerd":
      return r.status === "uitgevoerd" && r.done_late;
    case "te_laat":
      return r.status === "open" && r.due_date < today;
    case "open":
      return r.status === "open" && r.due_date >= today;
    case "niet_uitgevoerd":
      return r.status === "niet_uitgevoerd";
    case "vervallen":
      return r.status === "vervallen";
    case "gecorrigeerd":
      return r.has_corrections;
  }
}

const selectCls =
  "h-10 rounded-md border border-border bg-surface px-3 text-sm text-foreground focus:border-teal focus:outline-none";

function Historie({ companyId }: { companyId: string }) {
  const { can } = usePermissions();
  const canEdit = can("haccp_controle").canEdit;
  const [today] = useState(() => todayISO());

  const [period, setPeriod] = useState<PeriodKey>("week");
  const [range, setRange] = useState(() => periodRange("week"));
  const [rows, setRows] = useState<HaccpHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState("");
  const [person, setPerson] = useState("");
  const [status, setStatus] = useState<StatusFilter>("alle");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<HaccpHistoryRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const { companies } = useCompanyScope();

  async function exportExcel() {
    setExporting(true);
    const supabase = createClient();
    const args = {
      p_company_id: companyId,
      p_from: range.from,
      p_to: range.to,
    };
    const [r, e] = await Promise.all([
      supabase.rpc("haccp_report", args),
      supabase.rpc("haccp_report_events", args),
    ]);
    setExporting(false);
    if (r.error || e.error) {
      setError(haccpError(r.error ?? e.error));
      return;
    }
    exportHaccpExcel({
      companyName: companies.find((c) => c.id === companyId)?.name ?? "bedrijf",
      from: range.from,
      to: range.to,
      rows: (r.data as HaccpReportRow[]) ?? [],
      events: (e.data as HaccpReportEventRow[]) ?? [],
      today,
    });
  }

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().rpc("haccp_history", {
      p_company_id: companyId,
      p_from: range.from,
      p_to: range.to,
    });
    if (err) {
      setError(haccpError(err));
      setRows([]);
      return;
    }
    setError(null);
    setRows((data as HaccpHistoryRow[]) ?? []);
  }, [companyId, range]);

  useEffect(() => {
    // load() zet pas state na het ophalen (asynchroon).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function choosePeriod(key: PeriodKey) {
    setPeriod(key);
    if (key !== "eigen") setRange(periodRange(key));
  }

  const areas = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows ?? []) m.set(r.area_id, r.area_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows ?? [])
      if (r.completed_by_id && r.completed_by)
        m.set(r.completed_by_id, r.completed_by);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (!area || r.area_id === area) &&
        (!person || r.completed_by_id === person) &&
        matchesStatus(r, status, today) &&
        (!q || r.title.toLowerCase().includes(q)),
    );
  }, [rows, area, person, status, query, today]);

  const counts = useMemo(() => {
    const planned = filtered.filter(
      (r) => !r.is_on_demand && r.status !== "vervallen",
    );
    return {
      planned: planned.length,
      done: planned.filter((r) => r.status === "uitgevoerd").length,
      late: planned.filter((r) => r.status === "uitgevoerd" && r.done_late)
        .length,
      open: planned.filter((r) => r.status === "open" && r.due_date < today)
        .length,
      notDone: planned.filter((r) => r.status === "niet_uitgevoerd").length,
      onDemand: filtered.filter(
        (r) => r.is_on_demand && r.status === "uitgevoerd",
      ).length,
    };
  }, [filtered, today]);

  const pct =
    counts.planned > 0
      ? Math.round((counts.done / counts.planned) * 100)
      : null;

  return (
    <div className="mx-auto max-w-5xl p-3 sm:p-6">
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void exportExcel()}
          disabled={exporting}
        >
          <FileSpreadsheet className="h-4 w-4" />
          {exporting ? "Exporteren…" : "Excel (deze periode)"}
        </Button>
        <Link
          href="/haccp/rapport"
          className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-background"
        >
          <FileBarChart className="h-4 w-4" /> Inspectierapport
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => choosePeriod(p.key)}
            className={cn(
              "h-9 rounded-full border px-3 text-sm",
              period === p.key
                ? "border-navy bg-navy text-white"
                : "border-border bg-surface text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {period === "eigen" && (
          <>
            <input
              type="date"
              className={selectCls}
              value={range.from}
              max={range.to}
              onChange={(e) =>
                e.target.value &&
                setRange((r) => ({ ...r, from: e.target.value }))
              }
            />
            <span className="text-sm text-muted">t/m</span>
            <input
              type="date"
              className={selectCls}
              value={range.to}
              min={range.from}
              onChange={(e) =>
                e.target.value &&
                setRange((r) => ({ ...r, to: e.target.value }))
              }
            />
          </>
        )}
        <select
          className={selectCls}
          value={area}
          onChange={(e) => setArea(e.target.value)}
        >
          <option value="">Alle ruimtes</option>
          {areas.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        >
          <option value="">Alle medewerkers</option>
          {people.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className={cn(selectCls, "w-48 pl-9")}
            placeholder="Zoek taak"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {rows !== null && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Tile label="Gepland" value={counts.planned} />
          <Tile
            label="Uitgevoerd"
            value={counts.done}
            sub={pct !== null ? `${pct}%` : undefined}
            tone="teal"
          />
          <Tile
            label="Te laat uitgevoerd"
            value={counts.late}
            tone={counts.late ? "copper" : undefined}
          />
          <Tile
            label="Te laat, nog open"
            value={counts.open}
            tone={counts.open ? "danger" : undefined}
          />
          <Tile
            label="Niet uitgevoerd"
            value={counts.notDone}
            tone={counts.notDone ? "danger" : undefined}
          />
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {rows === null && <p className="text-sm text-muted">Laden…</p>}

      {rows !== null && filtered.length === 0 && !error && (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
          Geen registraties in deze periode.
        </p>
      )}

      {filtered.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-background text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Gepland</th>
                <th className="px-3 py-2 font-medium">Taak</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">
                  Ruimte
                </th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">
                  Uitgevoerd door
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const st = displayStatus(r, today);
                return (
                  <tr
                    key={r.occurrence_id}
                    onClick={() => setDetail(r)}
                    className="cursor-pointer border-t border-border hover:bg-background"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-foreground">
                      {formatDateNL(r.due_date)}
                      {r.slots_total > 1 && (
                        <span className="text-muted">
                          {" "}
                          · {r.slot}/{r.slots_total}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-foreground">
                        {r.title}
                      </span>
                      {r.is_on_demand && (
                        <span className="ml-1 text-xs text-muted">
                          (na gebruik)
                        </span>
                      )}
                      {r.has_corrections && (
                        <History
                          className="ml-1 inline h-3.5 w-3.5 text-copper"
                          aria-label="Met correctie"
                        />
                      )}
                      <span className="block text-xs text-muted md:hidden">
                        {r.area_name}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 text-foreground md:table-cell">
                      {r.area_name}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                          st.cls,
                        )}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 text-foreground sm:table-cell">
                      {r.completed_by ? (
                        <>
                          {r.completed_by}
                          <span className="text-muted">
                            {" "}
                            ·{" "}
                            {r.done_late
                              ? formatDateTimeNL(r.completed_at)
                              : formatTimeNL(r.completed_at)}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-muted">
        Een afmelding betekent dat een medewerker de taak heeft afgevinkt. Het
        is geen bewijs dat de reiniging goed is uitgevoerd; daarvoor dienen de
        controles door leidinggevenden. Registraties worden nooit gewijzigd of
        gewist: correcties staan als aparte regel in de tijdlijn.
      </p>

      {detail && (
        <Detail
          row={detail}
          companyId={companyId}
          canEdit={canEdit}
          today={today}
          onClose={() => setDetail(null)}
          onChanged={async () => {
            setDetail(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "teal" | "copper" | "danger";
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={cn(
          "text-xl font-semibold",
          tone === "teal" && "text-teal",
          tone === "copper" && "text-copper",
          tone === "danger" && "text-danger",
          !tone && "text-foreground",
        )}
      >
        {value}
        {sub && (
          <span className="ml-1 text-sm font-normal text-muted">{sub}</span>
        )}
      </div>
    </div>
  );
}

const EVENT_LABELS: Record<HaccpEventRow["event_type"], string> = {
  uitgevoerd: "Afgemeld als gereed",
  ingetrokken: "Direct ingetrokken",
  correctie: "Correctie",
  niet_uitgevoerd: "Afgesloten als niet uitgevoerd",
  gecontroleerd_akkoord: "Gecontroleerd: akkoord",
  gecontroleerd_afgekeurd: "Gecontroleerd: afgekeurd",
  probleem: "Probleem gemeld",
};

const CORRECTION_LABELS: Record<string, string> = {
  ongeldig: "afmelding ongeldig gemaakt",
  andere_medewerker: "uitvoerder aangepast",
  heropenen: "weer opengezet",
};

function Detail({
  row,
  companyId,
  canEdit,
  today,
  onClose,
  onChanged,
}: {
  row: HaccpHistoryRow;
  companyId: string;
  canEdit: boolean;
  today: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [events, setEvents] = useState<HaccpEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<
    null | "ongeldig" | "andere_medewerker" | "heropenen" | "niet_uitgevoerd"
  >(null);
  const [reason, setReason] = useState("");
  const [performer, setPerformer] = useState("");
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [eventId, setEventId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    createClient()
      .rpc("haccp_occurrence_events", { p_occurrence_id: row.occurrence_id })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(haccpError(err));
        setEvents((data as HaccpEventRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [row.occurrence_id]);

  useEffect(() => {
    if (mode !== "andere_medewerker" || staff.length > 0) return;
    let cancelled = false;
    createClient()
      .rpc("haccp_staff", { p_company_id: companyId })
      .then(({ data }) => {
        if (!cancelled)
          setStaff((data as { id: string; full_name: string }[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, staff.length, companyId]);

  function open(m: typeof mode) {
    setMode(m);
    setReason("");
    setPerformer("");
    setError(null);
    setEventId(crypto.randomUUID());
  }

  async function saveCorrection() {
    if (!mode || mode === "niet_uitgevoerd") return;
    if (!reason.trim()) return setError("Geef een reden op.");
    if (mode === "andere_medewerker" && !performer)
      return setError("Kies de medewerker.");
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("haccp_correct", {
      p_event_id: eventId,
      p_occurrence_id: row.occurrence_id,
      p_kind: mode,
      p_reason: reason.trim(),
      p_new_performer: mode === "andere_medewerker" ? performer : null,
    });
    setBusy(false);
    if (err) return setError(haccpError(err));
    onChanged();
  }

  const st = displayStatus(row, today);

  if (mode === "niet_uitgevoerd") {
    return (
      <NotDoneDialog
        occurrenceId={row.occurrence_id}
        title={row.title}
        dueDate={row.due_date}
        onClose={() => setMode(null)}
        onDone={onChanged}
      />
    );
  }

  return (
    <Modal title={row.title} onClose={onClose}>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span
          className={cn("rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}
        >
          {st.label}
        </span>
        <span className="text-muted">
          {row.area_name}
          {row.department_name ? ` · ${row.department_name}` : ""}
        </span>
        <span className="text-muted">
          Gepland {formatDateNL(row.due_date)}
          {row.slots_total > 1 ? ` (${row.slot} van ${row.slots_total})` : ""}
        </span>
        <span className="text-muted">Taakversie {row.version_no}</span>
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        Tijdlijn
      </h3>
      {events === null && <p className="text-sm text-muted">Laden…</p>}
      {events !== null && events.length === 0 && (
        <p className="text-sm text-muted">Nog niets geregistreerd.</p>
      )}
      <ol className="mb-5 space-y-3 border-l-2 border-border pl-4">
        {(events ?? []).map((e) => (
          <li key={e.id} className="text-sm">
            <div className="font-medium text-foreground">
              {EVENT_LABELS[e.event_type]}
              {e.event_type === "correctie" && e.details?.soort && (
                <span className="font-normal text-muted">
                  {" "}
                  — {CORRECTION_LABELS[e.details.soort] ?? e.details.soort}
                </span>
              )}
            </div>
            <div className="text-muted">
              {formatDateTimeNL(e.recorded_at)}
              {e.event_type === "uitgevoerd" && e.performed_by && (
                <> · door {e.performed_by}</>
              )}
              {e.event_type === "correctie" && e.performed_by && (
                <> · nieuwe uitvoerder {e.performed_by}</>
              )}
              {e.recorded_by &&
                (e.event_type !== "uitgevoerd" ||
                  e.recorded_by !== e.performed_by) && (
                  <>
                    {" "}
                    ·{" "}
                    {e.event_type === "uitgevoerd"
                      ? "via account"
                      : "vastgelegd door"}{" "}
                    {e.recorded_by}
                  </>
                )}
            </div>
            {e.note && <div className="text-foreground/80">“{e.note}”</div>}
          </li>
        ))}
      </ol>

      <div className="mb-5">
        <PhotoStrip occurrenceId={row.occurrence_id} />
      </div>

      {canEdit && !mode && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {row.status === "uitgevoerd" && (
            <>
              <Button
                variant="secondary"
                onClick={() => open("andere_medewerker")}
              >
                Andere uitvoerder
              </Button>
              <Button variant="secondary" onClick={() => open("ongeldig")}>
                Afmelding ongeldig maken
              </Button>
            </>
          )}
          {row.status === "open" && (
            <Button variant="secondary" onClick={() => open("niet_uitgevoerd")}>
              Afsluiten als niet uitgevoerd
            </Button>
          )}
          {row.status === "niet_uitgevoerd" && (
            <Button variant="secondary" onClick={() => open("heropenen")}>
              Weer openzetten
            </Button>
          )}
        </div>
      )}

      {canEdit && mode && (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm font-medium text-foreground">
            {mode === "ongeldig" &&
              "Afmelding ongeldig maken — de taak was niet (goed) gedaan"}
            {mode === "andere_medewerker" &&
              "De taak is door iemand anders uitgevoerd"}
            {mode === "heropenen" &&
              "Taak weer openzetten, zodat hij alsnog afgemeld kan worden"}
          </p>
          {mode === "andere_medewerker" && (
            <select
              className={cn(selectCls, "w-full")}
              value={performer}
              onChange={(e) => setPerformer(e.target.value)}
            >
              <option value="">Kies medewerker…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          )}
          <input
            autoFocus
            className={cn(selectCls, "w-full")}
            placeholder="Reden (verplicht)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-xs text-muted">
            De correctie wordt als aparte regel vastgelegd met jouw naam en de
            reden. De oorspronkelijke registratie blijft zichtbaar.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode(null)}>
              Annuleren
            </Button>
            <Button onClick={() => void saveCorrection()} disabled={busy}>
              {busy ? "Opslaan…" : "Correctie vastleggen"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

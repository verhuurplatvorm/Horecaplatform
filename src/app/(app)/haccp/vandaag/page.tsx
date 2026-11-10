"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  RefreshCw,
  User,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { SingleCompany } from "@/components/haccp/single-company";
import { StaffSwitcher } from "@/components/haccp/staff-switcher";
import { NotDoneDialog } from "@/components/haccp/not-done-dialog";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  describeFrequency,
  haccpError,
  readStaffSession,
  writeStaffSession,
  type StaffSession,
} from "@/lib/haccp/cleaning";
import type { HaccpTodayRow } from "@/lib/types/database";

export default function HaccpVandaagPage() {
  return (
    <>
      <Topbar title="Schoonmaak vandaag" />
      <SingleCompany>
        {(companyId) => <Vandaag key={companyId} companyId={companyId} />}
      </SingleCompany>
    </>
  );
}

const ALL = "__alle__";
const NONE = "__geen__";

function rowKey(r: HaccpTodayRow) {
  return r.occurrence_id ?? `taak:${r.task_id}`;
}

function time(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * Het belangrijkste scherm: welke schoonmaaktaken moeten vandaag, en één
 * tik op Gereed registreert wie, wat en wanneer (tijd van de server).
 */
function Vandaag({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<HaccpTodayRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [session, setSession] = useState<StaffSession | null>(() =>
    typeof window === "undefined" ? null : readStaffSession(companyId),
  );
  const [accountName, setAccountName] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [filter, setFilter] = useState<string>(() => {
    if (typeof window === "undefined") return ALL;
    try {
      return window.localStorage.getItem(`haccp:afdeling:${companyId}`) ?? ALL;
    } catch {
      return ALL;
    }
  });
  const canClose = usePermissions().can("haccp_controle").canEdit;
  const [notDone, setNotDone] = useState<HaccpTodayRow | null>(null);
  const [undo, setUndo] = useState<{ eventId: string; title: string } | null>(
    null,
  );
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().rpc("haccp_today", {
      p_company_id: companyId,
    });
    if (err) {
      setError(haccpError(err));
      return;
    }
    setError(null);
    setRows((data as HaccpTodayRow[]) ?? []);
  }, [companyId]);

  // Ophalen bij openen, elke minuut en zodra de tablet weer actief wordt.
  useEffect(() => {
    // load() zet pas state na het ophalen (asynchroon), niet direct in het effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await supabase
        .from("user_profiles")
        .select("full_name")
        .eq("id", data.user.id)
        .single();
      if (!cancelled) setAccountName(p?.full_name ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  function chooseFilter(f: string) {
    setFilter(f);
    try {
      window.localStorage.setItem(`haccp:afdeling:${companyId}`, f);
    } catch {
      /* niet onthouden is geen probleem */
    }
  }

  function setBusy(key: string, on: boolean) {
    setBusyKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function complete(row: HaccpTodayRow) {
    const key = rowKey(row);
    if (busyKeys.has(key)) return;
    setBusy(key, true);
    setError(null);
    const eventId = crypto.randomUUID();
    const performer = session?.name ?? accountName ?? "";
    const now = new Date().toISOString();

    // Direct groen tonen; de server bevestigt.
    if (row.kind === "gepland") {
      setRows((prev) =>
        (prev ?? []).map((r) =>
          rowKey(r) === key
            ? {
                ...r,
                status: "uitgevoerd",
                completed_at: now,
                completed_by: performer,
                is_late: false,
              }
            : r,
        ),
      );
    }

    const args = {
      p_event_id: eventId,
      p_occurrence_id: row.kind === "gepland" ? row.occurrence_id : null,
      p_task_id: row.kind === "op_aanvraag" ? row.task_id : null,
      p_session_id: session?.sessionId ?? null,
      p_client_at: now,
    };
    const supabase = createClient();
    let res = await supabase.rpc("haccp_complete", args);
    // Haperende wifi: één keer opnieuw met hetzelfde id (geeft nooit een dubbele registratie).
    if (res.error && /fetch|network/i.test(res.error.message)) {
      res = await supabase.rpc("haccp_complete", args);
    }
    setBusy(key, false);

    if (res.error) {
      const msg = haccpError(res.error);
      setError(msg);
      if (/sessie verlopen/i.test(msg)) {
        writeStaffSession(null, companyId);
        setSession(null);
      }
      await load();
      return;
    }

    const status = (res.data as { status: string } | null)?.status;
    if (status === "uitgevoerd") {
      setUndo({ eventId, title: row.title });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 10_000);
    }
    await load();
  }

  async function doUndo() {
    if (!undo) return;
    const { eventId } = undo;
    setUndo(null);
    const { error: err } = await createClient().rpc("haccp_undo", {
      p_event_id: eventId,
      p_undo_event_id: crypto.randomUUID(),
    });
    if (err) setError(haccpError(err));
    await load();
  }

  const departments = useMemo(() => {
    const m = new Map<string, string>();
    let none = false;
    for (const r of rows ?? []) {
      if (r.department_id) m.set(r.department_id, r.department_name ?? "");
      else none = true;
    }
    return {
      list: [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])),
      none,
    };
  }, [rows]);

  const visible = useMemo(
    () =>
      (rows ?? []).filter((r) =>
        filter === ALL
          ? true
          : filter === NONE
            ? !r.department_id
            : r.department_id === filter,
      ),
    [rows, filter],
  );

  const late = visible
    .filter((r) => r.is_late)
    .sort(
      (a, b) =>
        a.due_date.localeCompare(b.due_date) || a.title.localeCompare(b.title),
    );
  const planned = visible.filter((r) => r.kind === "gepland" && !r.is_late);
  const onDemand = visible.filter((r) => r.kind === "op_aanvraag");

  const byArea = useMemo(() => {
    const groups = new Map<
      string,
      { name: string; sort: number; rows: HaccpTodayRow[] }
    >();
    for (const r of planned) {
      const g = groups.get(r.area_id) ?? {
        name: r.area_name,
        sort: r.area_sort,
        rows: [],
      };
      g.rows.push(r);
      groups.set(r.area_id, g);
    }
    for (const g of groups.values()) {
      g.rows.sort(
        (a, b) =>
          a.task_sort - b.task_sort ||
          a.title.localeCompare(b.title) ||
          (a.slot ?? 0) - (b.slot ?? 0),
      );
    }
    return [...groups.values()].sort(
      (a, b) => a.sort - b.sort || a.name.localeCompare(b.name),
    );
  }, [planned]);

  const doneCount = planned.filter((r) => r.status === "uitgevoerd").length;
  const filterInvalid =
    rows !== null &&
    filter !== ALL &&
    !(filter === NONE
      ? departments.none
      : departments.list.some(([id]) => id === filter));

  function renderRow(r: HaccpTodayRow) {
    const key = rowKey(r);
    const done = r.kind === "gepland" && r.status === "uitgevoerd";
    const busy = busyKeys.has(key);
    const showInfo = openInfo === key;
    const hasInfo = Boolean(r.instruction || r.cleaning_agent);
    const meta: string[] = [];
    if (
      r.frequency !== "dagelijks" &&
      r.frequency !== "meerdere_per_dag" &&
      r.kind === "gepland"
    ) {
      meta.push(
        describeFrequency({
          frequency: r.frequency,
          times_per_day: 1,
          weekday: null,
          month_day: null,
          month: null,
        }),
      );
    }
    if (r.slots_total && r.slots_total > 1)
      meta.push(`${r.slot} van ${r.slots_total}`);
    if (r.is_late || r.kind === "op_aanvraag") meta.push(r.area_name);
    if (r.is_late) meta.push(`gepland ${shortDate(r.due_date)}`);
    if (r.department_name && filter === ALL) meta.push(r.department_name);

    return (
      <li
        key={key}
        className={cn(
          "flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0",
          done && "bg-teal/5",
        )}
      >
        <button
          type="button"
          onClick={() => hasInfo && setOpenInfo(showInfo ? null : key)}
          className={cn(
            "min-w-0 flex-1 text-left",
            !hasInfo && "cursor-default",
          )}
        >
          <span
            className={cn(
              "flex items-center gap-1.5 text-base font-medium",
              done ? "text-muted" : "text-foreground",
            )}
          >
            {r.title}
            {hasInfo && (
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted transition-transform",
                  showInfo && "rotate-180",
                )}
              />
            )}
          </span>
          {meta.length > 0 && (
            <span className="block text-xs text-muted">{meta.join(" · ")}</span>
          )}
          {showInfo && (
            <span className="mt-1 block whitespace-pre-line text-sm text-foreground/80">
              {r.instruction}
              {r.cleaning_agent && (
                <span className="block text-muted">
                  Middel: {r.cleaning_agent}
                </span>
              )}
            </span>
          )}
        </button>

        {done ? (
          <span className="flex shrink-0 items-center gap-2 text-right text-sm text-teal">
            <Check className="h-5 w-5" />
            <span>
              <span className="block font-medium">Gereed</span>
              <span className="block text-xs text-muted">
                {r.completed_by} · {time(r.completed_at)}
              </span>
            </span>
          </span>
        ) : (
          <div className="flex shrink-0 items-center gap-3">
            {r.is_late && canClose && r.occurrence_id && (
              <button
                type="button"
                onClick={() => setNotDone(r)}
                className="h-12 rounded-lg border border-border px-3 text-sm text-muted hover:text-foreground"
              >
                Niet gedaan
              </button>
            )}
            {r.kind === "op_aanvraag" && (r.done_today ?? 0) > 0 && (
              <span className="hidden text-right text-xs text-muted sm:block">
                vandaag {r.done_today}×
                <br />
                laatst {time(r.completed_at)} {r.completed_by}
              </span>
            )}
            <button
              type="button"
              onClick={() => void complete(r)}
              disabled={busy}
              className={cn(
                "h-12 min-w-28 rounded-lg px-5 text-base font-semibold text-white transition-colors disabled:opacity-60",
                r.is_late
                  ? "bg-danger hover:opacity-90"
                  : "bg-teal hover:bg-teal-light",
              )}
            >
              {busy ? "…" : "Gereed"}
            </button>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-3 pb-28 sm:p-6">
      {/* Wie werkt er + voortgang */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => setSwitching(true)}
          className="flex h-12 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm"
        >
          <User className="h-5 w-5 text-muted" />
          <span className="text-muted">Je werkt als</span>
          <span className="font-semibold text-foreground">
            {session?.name ?? accountName ?? "…"}
          </span>
          <span className="ml-1 text-teal">Wissel</span>
        </button>
        <div className="flex items-center gap-3">
          {rows !== null && (
            <span className="text-sm text-muted">
              <span className="font-semibold text-foreground">{doneCount}</span>{" "}
              van {planned.length} gedaan
            </span>
          )}
          <button
            onClick={() => void load()}
            className="rounded-md p-2 text-muted hover:bg-surface"
            aria-label="Vernieuwen"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
        </div>
      </div>

      {(departments.list.length > 1 ||
        (departments.list.length > 0 && departments.none)) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            [ALL, "Alles"] as const,
            ...departments.list,
            ...(departments.none ? [[NONE, "Iedereen"] as const] : []),
          ].map(([id, name]) => (
            <button
              key={id}
              onClick={() => chooseFilter(id)}
              className={cn(
                "h-10 rounded-full border px-4 text-sm font-medium",
                filter === id || (filterInvalid && id === ALL)
                  ? "border-navy bg-navy text-white"
                  : "border-border bg-surface text-foreground",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {rows === null && !error && <p className="text-sm text-muted">Laden…</p>}

      {rows !== null && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
          Er staan nog geen schoonmaaktaken in het plan. Een beheerder zet ze
          klaar bij HACCP → Schoonmaakplan.
        </div>
      )}

      {late.length > 0 && (
        <section className="mb-5 overflow-hidden rounded-lg border-2 border-danger/40 bg-surface">
          <h2 className="flex items-center gap-2 bg-danger/10 px-4 py-2 text-sm font-semibold text-danger">
            <AlertTriangle className="h-4 w-4" />
            Te laat ({late.length})
          </h2>
          <ul>{late.map(renderRow)}</ul>
        </section>
      )}

      {byArea.map((g) => (
        <section
          key={g.name}
          className="mb-5 overflow-hidden rounded-lg border border-border bg-surface"
        >
          <h2 className="flex items-center justify-between border-b border-border bg-background px-4 py-2 text-sm font-semibold text-foreground">
            {g.name}
            <span className="font-normal text-muted">
              {g.rows.filter((r) => r.status === "uitgevoerd").length}/
              {g.rows.length}
            </span>
          </h2>
          <ul>{g.rows.map(renderRow)}</ul>
        </section>
      ))}

      {onDemand.length > 0 && (
        <section className="mb-5 overflow-hidden rounded-lg border border-border bg-surface">
          <h2 className="border-b border-border bg-background px-4 py-2 text-sm font-semibold text-foreground">
            Na gebruik / wanneer nodig
          </h2>
          <ul>
            {[...onDemand]
              .sort(
                (a, b) =>
                  a.area_sort - b.area_sort ||
                  a.area_name.localeCompare(b.area_name) ||
                  a.title.localeCompare(b.title),
              )
              .map(renderRow)}
          </ul>
        </section>
      )}

      {undo && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex items-center gap-4 rounded-lg bg-navy px-4 py-3 text-sm text-white shadow-lg">
            <span>
              <Check className="mr-1 inline h-4 w-4" />
              {undo.title} afgemeld
            </span>
            <button
              onClick={() => void doUndo()}
              className="font-semibold text-copper underline"
            >
              Ongedaan maken
            </button>
          </div>
        </div>
      )}

      {notDone && notDone.occurrence_id && (
        <NotDoneDialog
          occurrenceId={notDone.occurrence_id}
          title={notDone.title}
          dueDate={notDone.due_date}
          onClose={() => setNotDone(null)}
          onDone={async () => {
            setNotDone(null);
            await load();
          }}
        />
      )}

      {switching && (
        <StaffSwitcher
          companyId={companyId}
          accountName={accountName}
          onClose={() => setSwitching(false)}
          onChosen={(s) => {
            writeStaffSession(s, companyId);
            setSession(s);
            setSwitching(false);
          }}
        />
      )}
    </div>
  );
}

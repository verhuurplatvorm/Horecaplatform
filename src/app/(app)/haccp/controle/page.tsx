"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Camera, Check, X } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SingleCompany } from "@/components/haccp/single-company";
import { NotDoneDialog } from "@/components/haccp/not-done-dialog";
import {
  DEVIATION_STATUS,
  DeviationDetail,
} from "@/components/haccp/deviation-detail";
import { PhotoStrip } from "@/components/haccp/photos";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  formatDateNL,
  formatTimeNL,
  haccpError,
  todayISO,
} from "@/lib/haccp/cleaning";
import type {
  HaccpDeviationRow,
  HaccpToCheckRow,
  HaccpTodayRow,
} from "@/lib/types/database";

export default function HaccpControlePage() {
  return (
    <>
      <Topbar title="Controle" />
      <SingleCompany>
        {(companyId) => <Controle key={companyId} companyId={companyId} />}
      </SingleCompany>
    </>
  );
}

/**
 * Overzicht voor chef-kok, sous-chef, manager: wat is gedaan, wat staat
 * open of is te laat, wat moet nog gecontroleerd worden en welke
 * afwijkingen lopen er.
 */
function Controle({ companyId }: { companyId: string }) {
  const canLead = usePermissions().can("haccp_controle").canEdit;
  const [today] = useState(() => todayISO());
  const [todayRows, setTodayRows] = useState<HaccpTodayRow[] | null>(null);
  const [toCheck, setToCheck] = useState<HaccpToCheckRow[]>([]);
  const [deviations, setDeviations] = useState<HaccpDeviationRow[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [reject, setReject] = useState<HaccpToCheckRow | null>(null);
  const [notDone, setNotDone] = useState<HaccpTodayRow | null>(null);
  const [devDetail, setDevDetail] = useState<HaccpDeviationRow | null>(null);
  const [openPhotos, setOpenPhotos] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [t, c, d] = await Promise.all([
      supabase.rpc("haccp_today", { p_company_id: companyId }),
      supabase.rpc("haccp_to_check", { p_company_id: companyId }),
      supabase.rpc("haccp_deviation_list", {
        p_company_id: companyId,
        p_include_closed: showClosed,
      }),
    ]);
    const err = t.error ?? c.error ?? d.error;
    setError(err ? haccpError(err) : null);
    setTodayRows((t.data as HaccpTodayRow[]) ?? []);
    setToCheck((c.data as HaccpToCheckRow[]) ?? []);
    setDeviations((d.data as HaccpDeviationRow[]) ?? []);
  }, [companyId, showClosed]);

  useEffect(() => {
    // load() zet pas state na het ophalen (asynchroon).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const planned = (todayRows ?? []).filter(
    (r) => r.kind === "gepland" && !r.is_late,
  );
  const done = planned.filter((r) => r.status === "uitgevoerd").length;
  const late = (todayRows ?? []).filter((r) => r.is_late);
  const openDevs = deviations.filter((d) => d.status !== "afgesloten");

  const checkGroups = useMemo(() => {
    const m = new Map<
      string,
      { name: string; sort: number; rows: HaccpToCheckRow[] }
    >();
    for (const r of toCheck) {
      const g = m.get(r.area_id) ?? {
        name: r.area_name,
        sort: r.area_sort,
        rows: [],
      };
      g.rows.push(r);
      m.set(r.area_id, g);
    }
    return [...m.entries()].sort(
      (a, b) => a[1].sort - b[1].sort || a[1].name.localeCompare(b[1].name),
    );
  }, [toCheck]);

  async function approve(ids: string[]) {
    setBusy((p) => new Set([...p, ...ids]));
    setError(null);
    const supabase = createClient();
    const res =
      ids.length === 1
        ? await supabase.rpc("haccp_check", {
            p_event_id: crypto.randomUUID(),
            p_occurrence_id: ids[0],
            p_result: "akkoord",
          })
        : await supabase.rpc("haccp_check_many", { p_occurrence_ids: ids });
    if (res.error) setError(haccpError(res.error));
    setBusy((p) => {
      const n = new Set(p);
      ids.forEach((i) => n.delete(i));
      return n;
    });
    await load();
  }

  return (
    <div className="mx-auto max-w-4xl p-3 sm:p-6">
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile
          label="Uitgevoerd vandaag"
          value={todayRows ? `${done}/${planned.length}` : "…"}
          tone="teal"
        />
        <Tile label="Nog open vandaag" value={planned.length - done} />
        <Tile
          label="Te laat"
          value={late.length}
          tone={late.length ? "danger" : undefined}
        />
        <Tile
          label="Te controleren"
          value={toCheck.length}
          tone={toCheck.length ? "copper" : undefined}
        />
        <Tile
          label="Afwijkingen open"
          value={openDevs.length}
          tone={openDevs.length ? "danger" : undefined}
        />
      </div>

      {error && (
        <p className="mb-4 rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Te controleren */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
          Te controleren
        </h2>
        {toCheck.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
            Niets te controleren. Bij Schoonmaakplan stel je per taak in of
            controle door een leidinggevende nodig is.
          </p>
        ) : (
          checkGroups.map(([areaId, g]) => (
            <div
              key={areaId}
              className="mb-3 overflow-hidden rounded-lg border border-border bg-surface"
            >
              <div className="flex items-center justify-between border-b border-border bg-background px-4 py-2">
                <span className="text-sm font-semibold text-foreground">
                  {g.name}
                </span>
                {canLead && g.rows.length > 1 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void approve(g.rows.map((r) => r.occurrence_id))
                    }
                  >
                    <Check className="h-4 w-4" /> Alles akkoord ({g.rows.length}
                    )
                  </Button>
                )}
              </div>
              <ul>
                {g.rows.map((r) => (
                  <li
                    key={r.occurrence_id}
                    className="border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-foreground">
                          {r.title}
                          {r.slots_total > 1 && (
                            <span className="text-muted">
                              {" "}
                              ({r.slot}/{r.slots_total})
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted">
                          {r.due_date !== today &&
                            `${formatDateNL(r.due_date)} · `}
                          {r.completed_by} · {formatTimeNL(r.completed_at)}
                          {r.photo_count > 0 && (
                            <button
                              className="ml-2 inline-flex items-center gap-1 text-teal"
                              onClick={() =>
                                setOpenPhotos(
                                  openPhotos === r.occurrence_id
                                    ? null
                                    : r.occurrence_id,
                                )
                              }
                            >
                              <Camera className="h-3.5 w-3.5" /> {r.photo_count}
                            </button>
                          )}
                        </div>
                      </div>
                      {canLead && (
                        <div className="flex shrink-0 gap-2">
                          <button
                            onClick={() => setReject(r)}
                            disabled={busy.has(r.occurrence_id)}
                            className="flex h-11 items-center gap-1 rounded-lg border border-danger/40 px-3 text-sm font-medium text-danger"
                          >
                            <X className="h-4 w-4" /> Afkeuren
                          </button>
                          <button
                            onClick={() => void approve([r.occurrence_id])}
                            disabled={busy.has(r.occurrence_id)}
                            className="flex h-11 items-center gap-1 rounded-lg bg-teal px-4 text-sm font-semibold text-white disabled:opacity-60"
                          >
                            <Check className="h-4 w-4" /> Akkoord
                          </button>
                        </div>
                      )}
                    </div>
                    {openPhotos === r.occurrence_id && (
                      <div className="mt-2">
                        <PhotoStrip occurrenceId={r.occurrence_id} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {/* Te laat */}
      {late.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-danger">
            <AlertTriangle className="h-4 w-4" /> Te laat
          </h2>
          <ul className="overflow-hidden rounded-lg border border-danger/30 bg-surface">
            {late.map((r) => (
              <li
                key={r.occurrence_id ?? r.task_id}
                className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{r.title}</div>
                  <div className="text-xs text-muted">
                    {r.area_name} · gepland {formatDateNL(r.due_date)}
                  </div>
                </div>
                {canLead && r.occurrence_id && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setNotDone(r)}
                  >
                    Niet gedaan
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Afwijkingen */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Afwijkingen
          </h2>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
            />
            Ook afgesloten
          </label>
        </div>
        {deviations.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
            Geen afwijkingen.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border bg-surface">
            {deviations.map((d) => {
              const st = DEVIATION_STATUS[d.status];
              return (
                <li
                  key={d.id}
                  onClick={() => setDevDetail(d)}
                  className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-background"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">
                      {d.description}
                    </div>
                    <div className="text-xs text-muted">
                      {[d.area_name, d.task_title].filter(Boolean).join(" · ")}
                      {" · "}gemeld door {d.reported_by} op{" "}
                      {formatDateNL(d.reported_at.slice(0, 10))}
                      {d.responsible && ` · verantwoordelijke ${d.responsible}`}
                      {d.photo_count > 0 && ` · ${d.photo_count} foto`}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                      st.cls,
                    )}
                  >
                    {st.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-sm">
        <Link href="/haccp/historie" className="text-teal underline">
          Alle registraties en wie wat heeft gedaan → Registratie &amp; historie
        </Link>
      </p>

      {reject && (
        <RejectDialog
          row={reject}
          onClose={() => setReject(null)}
          onDone={async () => {
            setReject(null);
            await load();
          }}
        />
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
      {devDetail && (
        <DeviationDetail
          deviation={devDetail}
          companyId={companyId}
          canLead={canLead}
          onClose={() => setDevDetail(null)}
          onChanged={async () => {
            setDevDetail(null);
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
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "teal" | "copper" | "danger";
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={cn(
          "text-2xl font-semibold",
          tone === "teal" && "text-teal",
          tone === "copper" && "text-copper",
          tone === "danger" && "text-danger",
          !tone && "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function RejectDialog({
  row,
  onClose,
  onDone,
}: {
  row: HaccpToCheckRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventId] = useState(() => crypto.randomUUID());

  async function save() {
    if (!note.trim()) return setError("Geef aan wat er niet goed is.");
    setBusy(true);
    const { error: err } = await createClient().rpc("haccp_check", {
      p_event_id: eventId,
      p_occurrence_id: row.occurrence_id,
      p_result: "afgekeurd",
      p_note: note.trim(),
    });
    setBusy(false);
    if (err) return setError(haccpError(err));
    onDone();
  }

  return (
    <Modal title="Afkeuren" onClose={onClose}>
      <p className="mb-3 text-sm">
        <span className="font-semibold text-foreground">{row.title}</span>
        <span className="text-muted">
          {" "}
          · {row.completed_by} · {formatTimeNL(row.completed_at)}
        </span>
      </p>
      {error && (
        <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <textarea
        autoFocus
        rows={3}
        className="mb-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-teal focus:outline-none"
        placeholder="Wat is er niet goed? Bv. vetresten achter de bakplaat"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="mb-4 text-xs text-muted">
        Er wordt automatisch een afwijking aangemaakt. Daar leg je de
        corrigerende maatregel en de oplossing vast.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Annuleren
        </Button>
        <Button variant="danger" onClick={() => void save()} disabled={busy}>
          {busy ? "Opslaan…" : "Afkeuren"}
        </Button>
      </div>
    </Modal>
  );
}

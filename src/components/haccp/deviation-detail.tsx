"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { PhotoButton, PhotoStrip } from "@/components/haccp/photos";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  formatDateNL,
  formatDateTimeNL,
  haccpError,
} from "@/lib/haccp/cleaning";
import type {
  HaccpDeviationEventRow,
  HaccpDeviationRow,
  HaccpDeviationStatus,
} from "@/lib/types/database";

export const DEVIATION_STATUS: Record<
  HaccpDeviationStatus,
  { label: string; cls: string }
> = {
  open: { label: "Open", cls: "bg-danger/10 text-danger" },
  in_behandeling: {
    label: "Maatregel genomen",
    cls: "bg-copper/15 text-copper",
  },
  opgelost: {
    label: "Opgelost — wacht op afsluiten",
    cls: "bg-teal/10 text-teal",
  },
  afgesloten: { label: "Afgesloten", cls: "bg-background text-muted" },
};

const EVENT_LABEL: Record<HaccpDeviationEventRow["event_type"], string> = {
  gemeld: "Gemeld",
  maatregel: "Corrigerende maatregel",
  opgelost: "Opgelost",
  afgesloten: "Gecontroleerd en afgesloten",
  heropend: "Heropend",
  opmerking: "Opmerking",
};

type Action =
  "maatregel" | "opgelost" | "afgesloten" | "heropend" | "opmerking";

/**
 * Afwijking afhandelen in 6 stappen: melden → foto → maatregel →
 * verantwoordelijke → oplossing → afsluiten door leidinggevende.
 * Elke stap wordt als aparte registratie vastgelegd.
 */
export function DeviationDetail({
  deviation,
  companyId,
  canLead,
  sessionId = null,
  onClose,
  onChanged,
}: {
  deviation: HaccpDeviationRow;
  companyId: string;
  canLead: boolean;
  sessionId?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [events, setEvents] = useState<HaccpDeviationEventRow[] | null>(null);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [responsible, setResponsible] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventId, setEventId] = useState(() => crypto.randomUUID());
  const [photoKey, setPhotoKey] = useState(0);
  const d = deviation;

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .rpc("haccp_deviation_events_list", { p_deviation_id: d.id })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(haccpError(err));
        setEvents((data as HaccpDeviationEventRow[]) ?? []);
      });
    if (canLead) {
      supabase
        .rpc("haccp_staff", { p_company_id: companyId })
        .then(({ data }) => {
          if (!cancelled)
            setStaff((data as { id: string; full_name: string }[]) ?? []);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [d.id, companyId, canLead]);

  function start(a: Action) {
    setAction(a);
    setNote(a === "maatregel" ? (d.corrective_action ?? "") : "");
    setResponsible(d.responsible_id ?? "");
    setError(null);
    setEventId(crypto.randomUUID());
  }

  async function save() {
    if (!action) return;
    if (action !== "afgesloten" && !note.trim())
      return setError("Vul een toelichting in.");
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("haccp_deviation_action", {
      p_event_id: eventId,
      p_deviation_id: d.id,
      p_action: action,
      p_note: note.trim() || null,
      p_responsible: action === "maatregel" && responsible ? responsible : null,
      p_session_id: sessionId,
    });
    setBusy(false);
    if (err) return setError(haccpError(err));
    onChanged();
  }

  const steps = [
    { label: "Gemeld", done: true },
    { label: "Maatregel", done: Boolean(d.corrective_action) },
    {
      label: "Opgelost",
      done: d.status === "opgelost" || d.status === "afgesloten",
    },
    { label: "Afgesloten", done: d.status === "afgesloten" },
  ];
  const st = DEVIATION_STATUS[d.status];
  const isOpen = d.status === "open" || d.status === "in_behandeling";

  return (
    <Modal title="Afwijking" onClose={onClose}>
      <div className="mb-4">
        <p className="text-base font-semibold text-foreground">
          {d.description}
        </p>
        <p className="mt-1 text-sm text-muted">
          {[
            d.area_name,
            d.task_title,
            d.due_date && `gepland ${formatDateNL(d.due_date)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <span
          className={cn(
            "mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium",
            st.cls,
          )}
        >
          {st.label}
        </span>
      </div>

      <ol className="mb-5 grid grid-cols-4 gap-1 text-center text-xs">
        {steps.map((s) => (
          <li
            key={s.label}
            className={cn(
              "rounded-md px-1 py-2",
              s.done
                ? "bg-teal/10 font-medium text-teal"
                : "bg-background text-muted",
            )}
          >
            {s.done && <Check className="mx-auto mb-0.5 h-4 w-4" />}
            {s.label}
          </li>
        ))}
      </ol>

      <div className="mb-5 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">
            Corrigerende maatregel
          </div>
          <div className="text-foreground">{d.corrective_action ?? "—"}</div>
          {d.responsible && (
            <div className="text-muted">Verantwoordelijke: {d.responsible}</div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">
            Oplossing
          </div>
          <div className="text-foreground">{d.resolution ?? "—"}</div>
          {d.resolved_by && (
            <div className="text-muted">
              {d.resolved_by} · {formatDateTimeNL(d.resolved_at)}
            </div>
          )}
        </div>
      </div>

      <div className="mb-5">
        <PhotoStrip deviationId={d.id} reloadKey={photoKey} />
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {!action && (
        <div className="mb-5 flex flex-wrap gap-2">
          {isOpen && canLead && (
            <Button onClick={() => start("maatregel")}>
              Maatregel vastleggen
            </Button>
          )}
          {isOpen && (
            <Button
              variant={canLead ? "secondary" : "primary"}
              onClick={() => start("opgelost")}
            >
              Opgelost melden
            </Button>
          )}
          {d.status === "opgelost" && canLead && (
            <Button onClick={() => start("afgesloten")}>
              Controleren en afsluiten
            </Button>
          )}
          {(d.status === "opgelost" || d.status === "afgesloten") &&
            canLead && (
              <Button variant="secondary" onClick={() => start("heropend")}>
                Heropenen
              </Button>
            )}
          {d.status !== "afgesloten" && (
            <PhotoButton
              companyId={companyId}
              deviationId={d.id}
              sessionId={sessionId}
              onAdded={() => setPhotoKey((k) => k + 1)}
            />
          )}
          <Button variant="ghost" onClick={() => start("opmerking")}>
            Opmerking
          </Button>
        </div>
      )}

      {action && (
        <div className="mb-5 space-y-3 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-medium text-foreground">
            {action === "maatregel" &&
              "Welke corrigerende maatregel wordt genomen?"}
            {action === "opgelost" && "Wat is er gedaan om het op te lossen?"}
            {action === "afgesloten" &&
              "Is de oplossing gecontroleerd en in orde?"}
            {action === "heropend" && "Waarom wordt de afwijking heropend?"}
            {action === "opmerking" && "Opmerking toevoegen"}
          </p>
          {action !== "afgesloten" && (
            <textarea
              autoFocus
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-teal focus:outline-none"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                action === "maatregel"
                  ? "Bv. deurrubber vervangen, koelcel extra reinigen en ontsmetten"
                  : action === "opgelost"
                    ? "Bv. nieuw rubber geplaatst, cel gereinigd"
                    : ""
              }
            />
          )}
          {action === "afgesloten" && (
            <input
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:border-teal focus:outline-none"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opmerking (optioneel)"
            />
          )}
          {action === "maatregel" && (
            <select
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
            >
              <option value="">Verantwoordelijke (optioneel)…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAction(null)}>
              Annuleren
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy
                ? "Opslaan…"
                : action === "afgesloten"
                  ? "Akkoord, afsluiten"
                  : "Vastleggen"}
            </Button>
          </div>
        </div>
      )}

      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        Tijdlijn
      </h3>
      {events === null && <p className="text-sm text-muted">Laden…</p>}
      <ol className="space-y-3 border-l-2 border-border pl-4">
        {(events ?? []).map((e) => (
          <li key={e.id} className="text-sm">
            <div className="font-medium text-foreground">
              {EVENT_LABEL[e.event_type]}
            </div>
            <div className="text-muted">
              {formatDateTimeNL(e.recorded_at)}
              {e.performed_by && <> · {e.performed_by}</>}
              {e.recorded_by && e.recorded_by !== e.performed_by && (
                <> · via account {e.recorded_by}</>
              )}
              {e.responsible && <> · verantwoordelijke {e.responsible}</>}
            </div>
            {e.note && <div className="text-foreground/80">“{e.note}”</div>}
          </li>
        ))}
      </ol>
    </Modal>
  );
}

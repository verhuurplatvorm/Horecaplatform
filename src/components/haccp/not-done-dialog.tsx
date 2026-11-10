"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  NOT_DONE_REASONS,
  formatDateNL,
  haccpError,
} from "@/lib/haccp/cleaning";

/**
 * Leidinggevende sluit een openstaande (te late) taak af als "niet
 * uitgevoerd", met reden. Wordt als aparte registratie vastgelegd.
 */
export function NotDoneDialog({
  occurrenceId,
  title,
  dueDate,
  onClose,
  onDone,
}: {
  occurrenceId: string;
  title: string;
  dueDate: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventId] = useState(() => crypto.randomUUID());

  async function save() {
    if (!reason.trim()) return setError("Kies of typ een reden.");
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("haccp_mark_not_done", {
      p_event_id: eventId,
      p_occurrence_id: occurrenceId,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (err) return setError(haccpError(err));
    onDone();
  }

  return (
    <Modal title="Afsluiten als niet uitgevoerd" onClose={onClose}>
      <p className="mb-4 text-sm text-foreground">
        <span className="font-semibold">{title}</span>
        <span className="text-muted"> · gepland {formatDateNL(dueDate)}</span>
      </p>
      {error && (
        <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        {NOT_DONE_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={cn(
              "h-10 rounded-full border px-4 text-sm",
              reason === r
                ? "border-navy bg-navy text-white"
                : "border-border bg-surface text-foreground",
            )}
          >
            {r}
          </button>
        ))}
      </div>
      <input
        className="mb-4 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm focus:border-teal focus:outline-none"
        placeholder="Of typ een eigen reden"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <p className="mb-4 text-xs text-muted">
        De taak verdwijnt dan van het scherm Vandaag. In de historie blijft
        zichtbaar dat hij niet is uitgevoerd, door wie dit is vastgelegd en
        waarom.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Annuleren
        </Button>
        <Button variant="danger" onClick={() => void save()} disabled={busy}>
          {busy ? "Opslaan…" : "Niet uitgevoerd"}
        </Button>
      </div>
    </Modal>
  );
}

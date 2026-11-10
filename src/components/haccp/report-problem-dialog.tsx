"use client";

import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { haccpError } from "@/lib/haccp/cleaning";
import { uploadHaccpPhoto } from "@/lib/haccp/photos";

const QUICK = [
  "Kapot / defect",
  "Schimmel",
  "Schoonmaakmiddel op",
  "Ongedierte",
  "Lekkage",
  "Niet goed schoon te krijgen",
];

/** Medewerker meldt een probleem bij een taak; optioneel met foto. */
export function ReportProblemDialog({
  companyId,
  occurrenceId,
  taskId,
  title,
  sessionId,
  onClose,
  onDone,
}: {
  companyId: string;
  occurrenceId: string | null;
  taskId: string;
  title: string;
  sessionId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devId] = useState(() => crypto.randomUUID());
  const input = useRef<HTMLInputElement>(null);

  async function save() {
    if (!text.trim()) return setError("Beschrijf kort wat er aan de hand is.");
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("haccp_report_problem", {
      p_deviation_id: devId,
      p_company_id: companyId,
      p_description: text.trim(),
      p_occurrence_id: occurrenceId,
      p_task_id: occurrenceId ? null : taskId,
      p_session_id: sessionId,
    });
    if (err) {
      setBusy(false);
      return setError(haccpError(err));
    }
    if (file) {
      const res = await uploadHaccpPhoto({
        companyId,
        file,
        deviationId: devId,
        sessionId,
      });
      if (res.error) {
        setBusy(false);
        return setError(`Probleem is gemeld, maar de foto niet: ${res.error}`);
      }
    }
    setBusy(false);
    onDone();
  }

  return (
    <Modal title="Probleem melden" onClose={onClose}>
      <p className="mb-3 text-sm font-semibold text-foreground">{title}</p>
      {error && (
        <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setText((t) => (t ? `${t}, ${q.toLowerCase()}` : q))}
            className="h-10 rounded-full border border-border bg-surface px-4 text-sm text-foreground"
          >
            {q}
          </button>
        ))}
      </div>
      <textarea
        autoFocus
        rows={3}
        className="mb-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-teal focus:outline-none"
        placeholder="Wat is er aan de hand? Bv. schimmel bij de deurafdichting"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="mb-4">
        {file ? (
          <span className="inline-flex items-center gap-2 rounded-md bg-background px-3 py-2 text-sm">
            <Camera className="h-4 w-4 text-teal" /> Foto toegevoegd
            <button
              type="button"
              onClick={() => setFile(null)}
              aria-label="Foto weghalen"
            >
              <X className="h-4 w-4 text-muted" />
            </button>
          </span>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => input.current?.click()}
          >
            <Camera className="h-4 w-4" /> Foto (optioneel)
          </Button>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Annuleren
        </Button>
        <Button variant="danger" onClick={() => void save()} disabled={busy}>
          {busy ? "Melden…" : "Probleem melden"}
        </Button>
      </div>
    </Modal>
  );
}

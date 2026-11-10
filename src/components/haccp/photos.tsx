"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { signedPhotoUrls, uploadHaccpPhoto } from "@/lib/haccp/photos";
import { formatDateTimeNL } from "@/lib/haccp/cleaning";
import type { HaccpPhotoRow } from "@/lib/types/database";

/** Knop die de camera (of fotobibliotheek) opent en de foto direct vastlegt. */
export function PhotoButton({
  companyId,
  occurrenceId,
  deviationId,
  sessionId,
  label = "Foto toevoegen",
  onAdded,
  variant = "secondary",
}: {
  companyId: string;
  occurrenceId?: string | null;
  deviationId?: string | null;
  sessionId?: string | null;
  label?: string;
  onAdded: () => void;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const res = await uploadHaccpPhoto({
      companyId,
      file,
      occurrenceId,
      deviationId,
      sessionId,
    });
    setBusy(false);
    if (input.current) input.current.value = "";
    if (res.error) setError(res.error);
    else onAdded();
  }

  return (
    <span className="inline-flex flex-col">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant={variant}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <Camera className="h-4 w-4" />
        {busy ? "Uploaden…" : label}
      </Button>
      {error && <span className="mt-1 text-xs text-danger">{error}</span>}
    </span>
  );
}

/** Miniaturen van foto's bij een taak of afwijking; klik = groot. */
export function PhotoStrip({
  occurrenceId,
  deviationId,
  reloadKey = 0,
}: {
  occurrenceId?: string | null;
  deviationId?: string | null;
  reloadKey?: number;
}) {
  const [photos, setPhotos] = useState<(HaccpPhotoRow & { url?: string })[]>(
    [],
  );
  const [big, setBig] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await createClient().rpc("haccp_photo_list", {
        p_occurrence_id: occurrenceId ?? null,
        p_deviation_id: deviationId ?? null,
      });
      const rows = (data as HaccpPhotoRow[]) ?? [];
      const urls = await signedPhotoUrls(rows.map((r) => r.storage_path));
      if (!cancelled)
        setPhotos(rows.map((r) => ({ ...r, url: urls.get(r.storage_path) })));
    })();
    return () => {
      cancelled = true;
    };
  }, [occurrenceId, deviationId, reloadKey]);

  if (photos.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => p.url && setBig(p.url)}
            className="text-left"
          >
            {p.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.url}
                alt=""
                className="h-20 w-20 rounded-md border border-border object-cover"
              />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-md border border-border text-xs text-muted">
                foto
              </span>
            )}
            <span className="mt-0.5 block w-20 truncate text-[10px] text-muted">
              {p.taken_by} · {formatDateTimeNL(p.recorded_at)}
            </span>
          </button>
        ))}
      </div>
      {big && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setBig(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={big} alt="" className="max-h-full max-w-full rounded-md" />
        </div>
      )}
    </>
  );
}

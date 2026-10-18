"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Probeert alle facturen onder "Controle nodig" opnieuw aan een leverancier te koppelen. */
export function RetryWaitingButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/invoices/retry-waiting", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.error ?? "Opnieuw proberen mislukt.");
      } else {
        const parts = [
          `${body.processed} verwerkt`,
          body.duplicates ? `${body.duplicates} dubbel` : null,
          body.noPrices ? `${body.noPrices} zonder prijzen afgewezen` : null,
          `${body.stillWaiting + body.notReadable} wachten nog${body.notReadable ? ` (${body.notReadable} niet uitgelezen)` : ""}`,
          body.failed ? `${body.failed} mislukt` : null,
        ].filter(Boolean);
        setMessage(`${parts.join(", ")}.`);
        router.refresh();
      }
    } catch {
      setMessage("Opnieuw proberen mislukt.");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" size="sm" onClick={run} disabled={busy}>
        {busy ? "Bezig…" : "Opnieuw proberen"}
      </Button>
      {message && <span className="text-xs text-muted">{message}</span>}
    </div>
  );
}

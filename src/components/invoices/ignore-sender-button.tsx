"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Haalt uit een doorgestuurd (SRS-)adres het domein van de echte afzender. */
function suggestEntry(sender: string | null): string {
  const s = (sender ?? "").trim().replace(/^.*<|>.*$/g, "");
  const srs = s.match(/^SRS[01]=[^=]+=[^=]+=([^=]+)=/i);
  if (srs) return srs[1].toLowerCase();
  const at = s.indexOf("@");
  return at >= 0 ? s.slice(at + 1).toLowerCase() : s.toLowerCase();
}

export function IgnoreSenderButton({
  queueId,
  mailboxId,
  sender,
}: {
  queueId: string;
  mailboxId: string | null;
  sender: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState(() => suggestEntry(sender));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = entry.trim();
    if (value.length < 3) {
      setError("Minimaal 3 tekens, anders blokkeert het te veel mail.");
      return;
    }
    if (!mailboxId) {
      setError("Deze mail hoort bij geen mailbox; negeren kan via Mailboxen beheren.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: mb, error: e1 } = await supabase
      .from("invoice_mailboxes")
      .select("ignored_senders")
      .eq("id", mailboxId)
      .single();
    if (e1) {
      setBusy(false);
      setError("Ophalen mislukt: " + e1.message);
      return;
    }
    const list: string[] = (mb?.ignored_senders as string[] | null) ?? [];
    if (!list.some((x) => x.trim().toLowerCase() === value.toLowerCase())) {
      const { error: e2 } = await supabase
        .from("invoice_mailboxes")
        .update({ ignored_senders: [...list, value] })
        .eq("id", mailboxId);
      if (e2) {
        setBusy(false);
        setError(
          e2.message.includes("row-level security")
            ? "Alleen groepsbeheerders mogen dit aanpassen."
            : "Opslaan mislukt: " + e2.message
        );
        return;
      }
    }
    // Deze mail (en andere wachtende mail van dezelfde afzender) uit de lijst halen.
    await supabase
      .from("inbound_invoice_queue")
      .update({ status: "afgewezen", error_message: `Afzender genegeerd: "${value}".` })
      .in("status", ["wacht_op_leverancier", "fout"])
      .ilike("sender_email", `%${value}%`);
    await supabase
      .from("inbound_invoice_queue")
      .update({ status: "afgewezen", error_message: `Afzender genegeerd: "${value}".` })
      .eq("id", queueId);
    setBusy(false);
    setOpen(false);
    router.refresh(); // blijft op deze pagina
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="shrink-0 text-muted hover:text-danger hover:underline">
        Afzender negeren
      </button>
    );
  }
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <span className="flex items-center gap-2">
        <input
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          className="input h-8 w-56"
          aria-label="Afzender of domein om te negeren"
        />
        <button onClick={save} disabled={busy} className="text-teal hover:underline">
          {busy ? "Bezig…" : "Opslaan"}
        </button>
        <button onClick={() => setOpen(false)} className="text-muted hover:underline">
          Annuleren
        </button>
      </span>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

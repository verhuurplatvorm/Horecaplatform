"use client";

import { Fragment, useEffect, useState } from "react";
import { Plus, Copy, Check } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import type { InvoiceMailbox } from "@/lib/types/database";

export default function MailboxenPage() {
  const { companies } = useCompanyScope();
  const [mailboxes, setMailboxes] = useState<InvoiceMailbox[]>([]);
  const [label, setLabel] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [ignoreEditId, setIgnoreEditId] = useState<string | null>(null);
  const [ignoreText, setIgnoreText] = useState("");
  const [ignoreSaving, setIgnoreSaving] = useState(false);
  const [ignoreError, setIgnoreError] = useState<string | null>(null);
  const [origin] = useState(() =>
    typeof window !== "undefined" ? window.location.origin : ""
  );

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const supabase = createClient();
    const { data } = await supabase.from("invoice_mailboxes").select("*").order("created_at");
    setMailboxes((data as InvoiceMailbox[]) ?? []);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const groupId = await getCurrentGroupId(supabase);
    if (!groupId) {
      setError("Kan groep van gebruiker niet bepalen. Log opnieuw in.");
      setSaving(false);
      return;
    }
    const { error: insertError } = await supabase.from("invoice_mailboxes").insert({
      group_id: groupId,
      company_id: companyId || null,
      label: label.trim(),
    });
    setSaving(false);
    if (insertError) {
      setError(
        insertError.message.includes("row-level security")
          ? "Alleen groepsbeheerders mogen mailboxen aanmaken."
          : "Opslaan mislukt: " + insertError.message
      );
      return;
    }
    setLabel("");
    setCompanyId("");
    load();
  }

  async function handleDeactivate(id: string) {
    if (
      !window.confirm(
        "Deze mailbox uitschakelen? Nieuwe e-mails naar dit adres worden dan niet meer verwerkt."
      )
    )
      return;
    const supabase = createClient();
    await supabase.from("invoice_mailboxes").update({ is_active: false }).eq("id", id);
    load();
  }

  async function handleEditEmail(m: InvoiceMailbox) {
    const input = window.prompt(
      "Op welk e-mailadres ontvangt deze mailbox facturen? (alleen ter weergave; laat leeg om te wissen)",
      m.email_address ?? ""
    );
    if (input === null) return;
    const value = input.trim();
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      window.alert("Dit lijkt geen geldig e-mailadres.");
      return;
    }
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("invoice_mailboxes")
      .update({ email_address: value || null })
      .eq("id", m.id);
    if (updateError) {
      window.alert(
        updateError.message.includes("row-level security")
          ? "Alleen groepsbeheerders mogen dit aanpassen."
          : "Opslaan mislukt: " + updateError.message
      );
      return;
    }
    load();
  }

  function openIgnoreEditor(m: InvoiceMailbox) {
    if (ignoreEditId === m.id) {
      setIgnoreEditId(null);
      return;
    }
    setIgnoreEditId(m.id);
    setIgnoreText((m.ignored_senders ?? []).join("\n"));
    setIgnoreError(null);
  }

  async function saveIgnoreList(id: string) {
    setIgnoreSaving(true);
    setIgnoreError(null);
    // Eén afzender per regel; lege regels weg, dubbelen weg (hoofdletterongevoelig).
    const seen = new Set<string>();
    const list: string[] = [];
    for (const line of ignoreText.split("\n")) {
      const entry = line.trim();
      const key = entry.toLowerCase();
      if (!entry || seen.has(key)) continue;
      seen.add(key);
      list.push(entry);
    }
    const tooShort = list.find((e) => e.length < 3);
    if (tooShort) {
      setIgnoreError(`"${tooShort}" is te kort (minimaal 3 tekens), anders blokkeert het te veel mail.`);
      setIgnoreSaving(false);
      return;
    }
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("invoice_mailboxes")
      .update({ ignored_senders: list })
      .eq("id", id);
    setIgnoreSaving(false);
    if (updateError) {
      setIgnoreError(
        updateError.message.includes("row-level security")
          ? "Alleen groepsbeheerders mogen dit aanpassen."
          : "Opslaan mislukt: " + updateError.message
      );
      return;
    }
    setIgnoreEditId(null);
    load();
  }

  function copyUrl(mailbox: InvoiceMailbox) {
    const url = `${origin}/api/invoices/inbound-email/${mailbox.webhook_token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(mailbox.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <>
      <Topbar title="Factuur-mailboxen" />
      <main className="max-w-3xl p-6 space-y-4">
        <p className="text-sm text-muted">
          Maak hier een ontvangstpunt aan voor inkomende factuur-e-mails. Je krijgt een geheime
          webhook-URL die je instelt bij je e-mail-ontvangstdienst (bijv. Mailgun of Postmark) —
          zo&apos;n dienst stel je zelf in, deze URL is de bestemming die je daar invoert.
        </p>

        <Card>
          <CardHeader>
            <CardTitle>Nieuwe mailbox</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex items-end gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-foreground">
                  Naam (herkenbaar label)
                </label>
                <input
                  required
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="bv. Centrale factuurinbox"
                  className="input"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-foreground">Bedrijf</label>
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="input">
                  <option value="">Groepsbreed</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={saving}>
                <Plus className="h-4 w-4" />
                Aanmaken
              </Button>
            </form>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
<table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Naam</th>
                  <th className="px-5 py-3 font-medium">Bedrijf</th>
                  <th className="px-5 py-3 font-medium">E-mailadres</th>
                  <th className="px-5 py-3 font-medium">Webhook-URL</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {mailboxes.map((m) => (
                  <Fragment key={m.id}>
                  <tr className="border-t border-border">
                    <td className="px-5 py-3 font-medium">{m.label}</td>
                    <td className="px-5 py-3 text-muted">
                      {companies.find((c) => c.id === m.company_id)?.name ?? "Groepsbreed"}
                    </td>
                    <td className="px-5 py-3">
                      {m.email_address ? (
                        <span className="block text-xs">{m.email_address}</span>
                      ) : (
                        <span className="block text-xs text-muted">Niet ingevuld</span>
                      )}
                      <button
                        onClick={() => handleEditEmail(m)}
                        className="text-xs text-teal hover:underline"
                      >
                        {m.email_address ? "Wijzigen" : "Invullen"}
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => copyUrl(m)}
                        className="flex items-center gap-1 text-xs text-teal hover:underline"
                      >
                        {copiedId === m.id ? (
                          <>
                            <Check className="h-3.5 w-3.5" /> Gekopieerd
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" /> URL kopiëren
                          </>
                        )}
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          m.is_active
                            ? "rounded-full bg-success/10 px-2 py-0.5 text-xs text-success"
                            : "rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted"
                        }
                      >
                        {m.is_active ? "Actief" : "Uitgeschakeld"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <button
                          onClick={() => openIgnoreEditor(m)}
                          className="text-xs text-teal hover:underline"
                        >
                          Afzenders negeren
                          {(m.ignored_senders?.length ?? 0) > 0 &&
                            ` (${m.ignored_senders.length})`}
                        </button>
                        {m.is_active && (
                          <button
                            onClick={() => handleDeactivate(m.id)}
                            className="text-xs text-muted hover:text-danger"
                          >
                            Uitschakelen
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {ignoreEditId === m.id && (
                    <tr className="bg-surface">
                      <td colSpan={6} className="px-5 pb-4 pt-2">
                        <label className="mb-1 block text-xs font-medium text-foreground">
                          Afzenders waarvan mail niet wordt ingelezen
                        </label>
                        <p className="mb-2 text-xs text-muted">
                          Eén per regel: een e-mailadres, een domein (bv. ovenservice.nl) of een
                          deel van de naam (bv. Leventie). Hoofdletters maken niet uit. Er wordt
                          gezocht in de afzender, het onderwerp en de mailtekst, dus ook in
                          doorgestuurde mail. Zulke mail wordt niet gelezen en niet verwerkt,
                          maar blijft zichtbaar onder &quot;Afgewezen&quot; in het
                          Factuurmailbox-overzicht, met de reden erbij.
                        </p>
                        <textarea
                          value={ignoreText}
                          onChange={(e) => setIgnoreText(e.target.value)}
                          rows={5}
                          placeholder={"leventie\novenservice.nl"}
                          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                        />
                        {ignoreError && (
                          <p className="mt-1 text-xs text-danger">{ignoreError}</p>
                        )}
                        <div className="mt-2 flex gap-2">
                          <Button
                            type="button"
                            onClick={() => saveIgnoreList(m.id)}
                            disabled={ignoreSaving}
                          >
                            Opslaan
                          </Button>
                          <button
                            type="button"
                            onClick={() => setIgnoreEditId(null)}
                            className="text-xs text-muted hover:underline"
                          >
                            Annuleren
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
                {mailboxes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-center text-muted">
                      Nog geen mailboxen aangemaakt.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
</div>
          </CardContent>
        </Card>

        <style jsx>{`
          .input {
            display: block;
            width: 100%;
            height: 2.5rem;
            border-radius: 0.375rem;
            border: 1px solid var(--border);
            background: var(--surface);
            padding: 0 0.75rem;
            font-size: 0.875rem;
          }
        `}</style>
      </main>
    </>
  );
}

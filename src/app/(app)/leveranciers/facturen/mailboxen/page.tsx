"use client";

import { useEffect, useState } from "react";
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
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Naam</th>
                  <th className="px-5 py-3 font-medium">Bedrijf</th>
                  <th className="px-5 py-3 font-medium">Webhook-URL</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {mailboxes.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="px-5 py-3 font-medium">{m.label}</td>
                    <td className="px-5 py-3 text-muted">
                      {companies.find((c) => c.id === m.company_id)?.name ?? "Groepsbreed"}
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
                      {m.is_active && (
                        <button
                          onClick={() => handleDeactivate(m.id)}
                          className="text-xs text-muted hover:text-danger"
                        >
                          Uitschakelen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {mailboxes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-muted">
                      Nog geen mailboxen aangemaakt.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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

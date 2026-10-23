import Link from "next/link";
import { Upload, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { IgnoreSenderButton } from "@/components/invoices/ignore-sender-button";
import { DeleteInvoiceButton } from "@/components/invoices/delete-invoice-button";

export default async function FacturenPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const showAll = tab === "alles";
  const supabase = await createClient();
  const { data: allBatches, error } = await supabase
    .from("price_import_batches")
    .select(
      "id, original_filename, invoice_number, invoice_date, total_incl_vat, status, iban_mismatch, supplier_id, total_rows, matched_rows, unmatched_rows, suppliers(name)"
    )
    .eq("source_kind", "factuur")
    .order("created_at", { ascending: false })
    .limit(100);

  const { data: mailItems } = await supabase
    .from("inbound_invoice_queue")
    .select("id, original_filename, sender_email, received_at, status, mailbox_id")
    .in("status", ["wacht_op_leverancier", "fout"])
    .order("received_at", { ascending: false })
    .limit(10);

  const toCheckCount = (allBatches ?? []).filter(
    (b) => b.status === "wacht_op_controle"
  ).length;
  const batches = showAll
    ? allBatches
    : (allBatches ?? []).filter((b) => b.status === "wacht_op_controle");

  return (
    <>
      <Topbar title="Facturen" />
      <main className="p-6 space-y-4">
        <div className="flex items-start justify-end gap-2">
          <details className="relative">
            <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-md border border-border bg-surface px-3 text-sm text-muted hover:text-foreground">
              Geavanceerd
            </summary>
            <div className="absolute right-0 z-10 mt-1 flex w-56 flex-col rounded-md border border-border bg-surface p-1 text-sm shadow">
              <Link className="rounded px-3 py-2 hover:bg-background" href="/leveranciers/facturen/mailboxen">
                Mailboxen beheren
              </Link>
              <Link className="rounded px-3 py-2 hover:bg-background" href="/leveranciers/facturen/genegeerd">
                Genegeerde artikelen
              </Link>
            </div>
          </details>
          <Link href="/leveranciers/facturen/mailbox">
            <Button variant="secondary">Alle e-mailfacturen</Button>
          </Link>
          <Link href="/leveranciers/facturen/uploaden">
            <Button>
              <Upload className="h-4 w-4" />
              Factuur uploaden
            </Button>
          </Link>
        </div>

        {mailItems && mailItems.length > 0 && (
          <Card className="border-warning/40">
            <CardContent className="space-y-2 p-4">
              <p className="text-sm font-medium">
                {mailItems.length} e-mailfactu{mailItems.length === 1 ? "ur wacht" : "ren wachten"} op jou
              </p>
              <ul className="divide-y divide-border text-sm">
                {mailItems.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">
                      {m.original_filename}
                      <span className="ml-2 text-muted">{m.sender_email ?? ""}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-4">
                      <IgnoreSenderButton queueId={m.id} mailboxId={m.mailbox_id} sender={m.sender_email} />
                      <Link
                        href={`/leveranciers/facturen/postvak-in/${m.id}`}
                        className="text-teal hover:underline"
                      >
                        Verwerken →
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-1 text-sm">
          <Link
            href="/leveranciers/facturen"
            className={`rounded-md px-3 py-1.5 ${!showAll ? "bg-teal text-white" : "bg-surface text-muted hover:text-foreground"}`}
          >
            Te controleren ({toCheckCount})
          </Link>
          <Link
            href="/leveranciers/facturen?tab=alles"
            className={`rounded-md px-3 py-1.5 ${showAll ? "bg-teal text-white" : "bg-surface text-muted hover:text-foreground"}`}
          >
            Alle facturen
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
<table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Bestand</th>
                  <th className="px-5 py-3 font-medium">Leverancier</th>
                  <th className="px-5 py-3 font-medium">Factuurnummer</th>
                  <th className="px-5 py-3 font-medium">Datum</th>
                  <th className="px-5 py-3 font-medium">Totaal</th>
                  <th className="px-5 py-3 font-medium">Regels</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {batches?.map((b) => (
                  <tr key={b.id} className="border-t border-border hover:bg-background">
                    <td className="px-5 py-3 font-medium">
                      <Link
                        href={`/leveranciers/prijzen/importeren/${b.id}`}
                        className="hover:text-teal hover:underline"
                      >
                        {b.original_filename ?? "—"}
                      </Link>
                      {b.iban_mismatch && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-danger">
                          <TriangleAlert className="h-3 w-3" /> IBAN-afwijking
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {/* @ts-expect-error -- geneste relatie, niet in het handmatige Database-type */}
                      {b.suppliers?.name ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-muted">{b.invoice_number ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">
                      {b.invoice_date ? new Date(b.invoice_date).toLocaleDateString("nl-NL") : "—"}
                    </td>
                    <td className="px-5 py-3 tabular">
                      {b.total_incl_vat !== null ? `€ ${b.total_incl_vat.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-5 py-3 text-xs">
                      {b.unmatched_rows > 0 ? (
                        <span className="text-copper">
                          {b.unmatched_rows} van {b.total_rows} niet gekoppeld
                        </span>
                      ) : (
                        <span className="text-muted">{b.total_rows} gekoppeld</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted">{b.status.replace(/_/g, " ")}</td>
                    <td className="px-5 py-3">
                      <DeleteInvoiceButton batchId={b.id} filename={b.original_filename ?? "deze factuur"} />
                    </td>
                  </tr>
                ))}
                {(!batches || batches.length === 0) && (
                  <tr>
                    <td colSpan={8} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan facturen niet laden — controleer de Supabase-koppeling."
                        : showAll
                        ? "Nog geen facturen geüpload."
                        : "Alles is gecontroleerd — geen facturen die op controle wachten."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
</div>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { DeleteMailItemButton } from "@/components/invoices/delete-mail-item-button";
import type { InboundInvoiceQueueItem } from "@/lib/types/database";

// Statusoverzicht van de Factuurmailbox: ELKE binnengekomen e-mailfactuur
// staat hier, in welke status dan ook — niet alleen de afwijkingen. Dat is
// het verschil met het "Postvak in"-scherm (dat alleen de regels toont die
// nog een leverancier-keuze nodig hebben).
const TABS: { key: string; label: string; statuses: InboundInvoiceQueueItem["status"][] }[] = [
  // Standaardlijst: alles wat nog aandacht vraagt. Verwerkte en dubbele
  // facturen zijn afgehandeld en staan hier niet meer tussen; ze blijven
  // gewoon bewaard en zijn te vinden onder hun eigen tabblad en onder "Alles".
  {
    key: "open",
    label: "Open",
    statuses: ["nieuw_ontvangen", "wordt_verwerkt", "wacht_op_leverancier", "fout", "afgewezen"],
  },
  { key: "controle", label: "Controle nodig", statuses: ["wacht_op_leverancier"] },
  { key: "verwerkt", label: "Verwerkt", statuses: ["verwerkt"] },
  { key: "bezig", label: "Wordt verwerkt", statuses: ["wordt_verwerkt", "nieuw_ontvangen"] },
  { key: "fout", label: "Fout", statuses: ["fout"] },
  { key: "dubbel", label: "Dubbele factuur", statuses: ["dubbele_factuur"] },
  { key: "afgewezen", label: "Afgewezen", statuses: ["afgewezen"] },
  {
    key: "alles",
    label: "Alles",
    statuses: [
      "nieuw_ontvangen",
      "wordt_verwerkt",
      "verwerkt",
      "wacht_op_leverancier",
      "fout",
      "dubbele_factuur",
      "afgewezen",
    ],
  },
];

const STATUS_BADGE: Record<InboundInvoiceQueueItem["status"], { label: string; cls: string }> = {
  nieuw_ontvangen: { label: "Nieuw ontvangen", cls: "bg-muted/10 text-muted" },
  wordt_verwerkt: { label: "Wordt verwerkt", cls: "bg-muted/10 text-muted" },
  verwerkt: { label: "Verwerkt", cls: "bg-success/10 text-success" },
  wacht_op_leverancier: { label: "Controle nodig", cls: "bg-warning/10 text-warning" },
  fout: { label: "Fout", cls: "bg-danger/10 text-danger" },
  dubbele_factuur: { label: "Dubbele factuur", cls: "bg-warning/10 text-warning" },
  afgewezen: { label: "Afgewezen", cls: "bg-muted/10 text-muted" },
};

export default async function FactuurmailboxOverzichtPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];

  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from("inbound_invoice_queue")
    .select("*, suppliers:matched_supplier_id(name)")
    .in("status", activeTab.statuses)
    .order("received_at", { ascending: false })
    .limit(200);

  return (
    <>
      <Topbar title="Factuurmailbox" />
      <main className="p-6 space-y-4">
        <p className="text-sm text-muted">
          E-mailfacturen die via de factuur-mailboxen zijn binnengekomen. Onder &quot;Open&quot;
          staat wat nog aandacht vraagt; verwerkte en dubbele facturen vind je onder hun eigen
          tabblad of onder &quot;Alles&quot;. Automatisch verwerkt betekent dat er een prijsimport-batch is
          aangemaakt — de prijzen zelf worden pas doorgevoerd nadat je die batch op het
          Facturen-scherm bevestigt.
        </p>

        <div className="flex flex-wrap gap-1 border-b border-border">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/leveranciers/facturen/mailbox?tab=${t.key}`}
              className={
                "px-3 py-2 text-sm " +
                (t.key === activeTab.key
                  ? "border-b-2 border-teal font-medium text-foreground"
                  : "text-muted hover:text-foreground")
              }
            >
              {t.label}
            </Link>
          ))}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-medium">Bestand</th>
                    <th className="px-5 py-3 font-medium">Afzender</th>
                    <th className="px-5 py-3 font-medium">Leverancier</th>
                    <th className="px-5 py-3 font-medium">Factuurnummer</th>
                    <th className="px-5 py-3 font-medium">Ontvangen</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium"></th>
                    <th className="px-5 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {items?.map((item) => {
                    const badge = STATUS_BADGE[item.status];
                    return (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-5 py-3 font-medium">{item.original_filename}</td>
                        <td className="px-5 py-3 text-muted">{item.sender_email ?? "—"}</td>
                        <td className="px-5 py-3 text-muted">
                          {/* @ts-expect-error -- geneste relatie, niet in het handmatige Database-type */}
                          {item.suppliers?.name ?? "—"}
                        </td>
                        <td className="px-5 py-3 text-muted">{item.invoice_number ?? "—"}</td>
                        <td className="px-5 py-3 text-muted">
                          {new Date(item.received_at).toLocaleString("nl-NL")}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${badge.cls}`}>
                            {badge.label}
                          </span>
                          {item.error_message && (
                            <p className="mt-1 max-w-xs truncate text-xs text-danger" title={item.error_message}>
                              {item.error_message}
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {item.status === "wacht_op_leverancier" && (
                            <Link
                              href={`/leveranciers/facturen/postvak-in/${item.id}`}
                              className="text-teal hover:underline"
                            >
                              Verwerken →
                            </Link>
                          )}
                          {item.status === "verwerkt" && item.resulting_batch_id && (
                            <Link
                              href={`/leveranciers/prijzen/importeren/${item.resulting_batch_id}`}
                              className="text-teal hover:underline"
                            >
                              Bekijken →
                            </Link>
                          )}
                          {item.status === "dubbele_factuur" && item.duplicate_of_queue_id && (
                            <span className="text-xs text-muted">
                              Eerder al ontvangen
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <DeleteMailItemButton
                            id={item.id}
                            filename={item.original_filename}
                            status={item.status}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {(!items || items.length === 0) && (
                    <tr>
                      <td colSpan={8} className="px-5 py-6 text-center text-muted">
                        {error
                          ? "Kan factuurmailbox niet laden — controleer de Supabase-koppeling."
                          : "Niets in deze categorie."}
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

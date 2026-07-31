import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

const OUTCOME_LABELS: Record<string, string> = {
  pdf: "PDF — kies handmatig een leverancier",
  ubl: "Onbekende leverancier — bevestig zelf",
  onbekend: "Bestand niet herkend als UBL-factuur",
};

export default async function PostvakInPage() {
  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from("inbound_invoice_queue")
    .select("*")
    .eq("status", "wacht_op_leverancier")
    .order("received_at", { ascending: false });

  return (
    <>
      <Topbar title="Postvak in — e-mailfacturen" />
      <main className="p-6 space-y-4">
        <p className="text-sm text-muted">
          Binnengekomen facturen die niet automatisch verwerkt konden worden — meestal omdat de
          leverancier niet met zekerheid herkend is, of omdat het een PDF was.
        </p>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Bestand</th>
                  <th className="px-5 py-3 font-medium">Afzender</th>
                  <th className="px-5 py-3 font-medium">Ontvangen</th>
                  <th className="px-5 py-3 font-medium">Reden</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {items?.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-5 py-3 font-medium">{item.original_filename}</td>
                    <td className="px-5 py-3 text-muted">{item.sender_email ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">
                      {new Date(item.received_at).toLocaleString("nl-NL")}
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {OUTCOME_LABELS[item.file_kind] ?? "Controle nodig"}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/leveranciers/facturen/postvak-in/${item.id}`}
                        className="text-teal hover:underline"
                      >
                        Verwerken →
                      </Link>
                    </td>
                  </tr>
                ))}
                {(!items || items.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan postvak niet laden — controleer de Supabase-koppeling."
                        : "Postvak is leeg."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

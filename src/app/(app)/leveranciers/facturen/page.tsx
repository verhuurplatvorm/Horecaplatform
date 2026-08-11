import Link from "next/link";
import { Upload, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { DeleteInvoiceButton } from "@/components/invoices/delete-invoice-button";

export default async function FacturenPage() {
  const supabase = await createClient();
  const { data: batches, error } = await supabase
    .from("price_import_batches")
    .select(
      "id, original_filename, invoice_number, invoice_date, total_incl_vat, status, iban_mismatch, supplier_id, suppliers(name)"
    )
    .eq("source_kind", "factuur")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <Topbar title="Facturen" />
      <main className="p-6 space-y-4">
        <div className="flex justify-end gap-2">
          <Link href="/leveranciers/facturen/mailboxen">
            <Button variant="secondary">Mailboxen beheren</Button>
          </Link>
          <Link href="/leveranciers/facturen/postvak-in">
            <Button variant="secondary">Postvak in</Button>
          </Link>
          <Link href="/leveranciers/facturen/uploaden">
            <Button>
              <Upload className="h-4 w-4" />
              Factuur uploaden
            </Button>
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
                    <td className="px-5 py-3 text-muted">{b.status.replace(/_/g, " ")}</td>
                    <td className="px-5 py-3">
                      <DeleteInvoiceButton batchId={b.id} filename={b.original_filename ?? "deze factuur"} />
                    </td>
                  </tr>
                ))}
                {(!batches || batches.length === 0) && (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan facturen niet laden — controleer de Supabase-koppeling."
                        : "Nog geen facturen geüpload."}
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

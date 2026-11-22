import Link from "next/link";
import { Upload, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { IgnoreSenderButton } from "@/components/invoices/ignore-sender-button";
import { DeleteInvoiceButton } from "@/components/invoices/delete-invoice-button";
import { cn } from "@/lib/utils";
import type { PriceComparisonRow } from "@/lib/types/database";
import {
  PRIORITY_META,
  computeTotals,
  daysAgoIso,
  euro,
  normalizeComparisonRow,
  statusOf,
} from "@/lib/price-comparison";
import { DashboardFilterBar } from "@/components/dashboard/filter-bar";
import { dashboardHref, parseDashboardScope } from "@/lib/dashboard-links";

export default async function FacturenPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; bedrijf?: string }>;
}) {
  const sp = await searchParams;
  const { tab } = sp;
  const showAll = tab === "alles";
  // Bedrijf uit de URL (vanaf het dashboard); zonder = alle bedrijven.
  const scope = parseDashboardScope(sp);
  const fromDashboard = Boolean(sp.bedrijf);
  const supabase = await createClient();

  // Zelfde definitie als de dashboardtegels (migratie 0148).
  const [{ data: toCheckIds }, { data: mailIds }] = await Promise.all([
    supabase.rpc("dashboard_invoice_ids", { p_company_ids: scope.companyIds }),
    supabase.rpc("dashboard_mail_ids", { p_company_ids: scope.companyIds }),
  ]);
  const checkIds = (toCheckIds ?? []).map((r) => r.id);
  const mailIdList = (mailIds ?? []).map((r) => r.id);

  const select =
    "id, original_filename, invoice_number, invoice_date, total_incl_vat, status, iban_mismatch, supplier_id, company_id, total_rows, matched_rows, unmatched_rows, suppliers(name)";
  // "Te controleren": alle facturen die de teller telt (geen limiet van 100).
  // "Alle facturen": de laatste 100, binnen het gekozen bedrijf.
  const { data: allBatches, error } = showAll
    ? await supabase
        .from("price_import_batches")
        .select(select)
        .eq("source_kind", "factuur")
        .order("created_at", { ascending: false })
        .limit(100)
    : checkIds.length
      ? await supabase
          .from("price_import_batches")
          .select(select)
          .in("id", checkIds)
          .order("created_at", { ascending: false })
      : { data: [], error: null };

  const { data: mailItems } = mailIdList.length
    ? await supabase
        .from("inbound_invoice_queue")
        .select("id, original_filename, sender_email, received_at, status, mailbox_id")
        .in("id", mailIdList)
        .order("received_at", { ascending: false })
        .limit(10)
    : { data: [] };
  const mailHref = dashboardHref("/leveranciers/facturen/mailbox", { companyIds: scope.companyIds, onlyCurrent: false }, { tab: "verwerken" });

  // Prijscontrole per factuur (alleen lezen): één vergelijking over de
  // periode van de getoonde facturen.
  const invoiceDates = (allBatches ?? [])
    .map((b) => b.invoice_date)
    .filter((d): d is string => Boolean(d))
    .sort();
  const priceCheck = new Map<string, { overcharged: number; top: number; rows: number }>();
  if (invoiceDates.length > 0) {
    const { data: comparison } = await supabase.rpc("price_comparison", {
      p_from: daysAgoIso(120, new Date(invoiceDates[0])),
      p_to: invoiceDates[invoiceDates.length - 1],
      p_company_ids: null,
    });
    const byBatch = new Map<string, PriceComparisonRow[]>();
    for (const raw of (comparison ?? []) as PriceComparisonRow[]) {
      const r = normalizeComparisonRow(raw);
      byBatch.set(r.batch_id, [...(byBatch.get(r.batch_id) ?? []), r]);
    }
    for (const [batchId, rows] of byBatch) {
      const open = rows.filter((r) => statusOf(r) === "open");
      priceCheck.set(batchId, {
        overcharged: computeTotals(rows).overcharged,
        top: open.length ? Math.min(...open.map((r) => r.priority)) : 5,
        rows: rows.length,
      });
    }
  }

  const toCheckCount = checkIds.length;
  const batches = showAll
    ? (allBatches ?? []).filter(
        (b) =>
          !scope.companyIds ||
          !b.company_id ||
          scope.companyIds.includes(b.company_id)
      )
    : allBatches;
  const tabHref = (t?: string) =>
    dashboardHref("/leveranciers/facturen", { companyIds: scope.companyIds, onlyCurrent: false }, t ? { tab: t } : {});

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

        {fromDashboard && !showAll && (
          <DashboardFilterBar
            title="Facturen ter controle"
            count={toCheckCount}
            scope={scope}
            menuRelevant={false}
            clearHref="/leveranciers/facturen"
          />
        )}

        {mailIdList.length > 0 && mailItems && (
          <Card className="border-warning/40">
            <CardContent className="space-y-2 p-4">
              <p className="flex items-center justify-between text-sm font-medium">
                <span>
                  {mailIdList.length} e-mailfactu{mailIdList.length === 1 ? "ur" : "ren"} te verwerken
                  <span className="ml-1 font-normal text-muted">(apart van de facturen ter controle)</span>
                </span>
                {mailIdList.length > mailItems.length && (
                  <Link href={mailHref} className="text-xs font-normal text-teal hover:underline">
                    Alle {mailIdList.length} bekijken →
                  </Link>
                )}
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
            href={tabHref()}
            className={`rounded-md px-3 py-1.5 ${!showAll ? "bg-teal text-white" : "bg-surface text-muted hover:text-foreground"}`}
          >
            Facturen ter controle ({toCheckCount})
          </Link>
          <Link
            href={tabHref("alles")}
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
                  <th className="px-5 py-3 font-medium">Prijscontrole</th>
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
                    <td className="px-5 py-3 text-xs">
                      <PriceCheckCell check={priceCheck.get(b.id)} />
                    </td>
                    <td className="px-5 py-3 text-muted">{b.status.replace(/_/g, " ")}</td>
                    <td className="px-5 py-3">
                      <DeleteInvoiceButton batchId={b.id} filename={b.original_filename ?? "deze factuur"} />
                    </td>
                  </tr>
                ))}
                {(!batches || batches.length === 0) && (
                  <tr>
                    <td colSpan={9} className="px-5 py-6 text-center text-muted">
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

function PriceCheckCell({
  check,
}: {
  check: { overcharged: number; top: number; rows: number } | undefined;
}) {
  if (!check) return <span className="text-muted">—</span>;
  if (check.top === 5) return <span className="text-success">klopt</span>;
  const meta = PRIORITY_META[check.top as 1 | 2 | 3 | 4];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn("h-2 w-2 rounded-full", meta.dot)} title={meta.label} />
      {check.overcharged > 0 ? (
        <span className="font-medium text-danger">{euro(check.overcharged)} te veel</span>
      ) : (
        <span className="text-muted">{meta.label}</span>
      )}
    </span>
  );
}

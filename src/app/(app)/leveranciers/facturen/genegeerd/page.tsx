"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import type { IgnoredInvoiceItem } from "@/lib/types/database";

interface Row extends IgnoredInvoiceItem {
  supplierName: string;
}

/**
 * Artikelen die bij een factuur of prijslijst automatisch worden
 * overgeslagen. Hier kun je ze weer terughalen.
 */
export default function GenegeerdeArtikelenPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("ignored_invoice_items")
      .select("*, suppliers(name)")
      .order("created_at", { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message);
        setRows(
          (data ?? []).map((r) => ({
            ...(r as IgnoredInvoiceItem),
            // @ts-expect-error -- geneste relatie, niet in het handmatige Database-type
            supplierName: r.suppliers?.name ?? "onbekend",
          }))
        );
        setLoading(false);
      });
  }, []);

  async function restore(row: Row) {
    if (
      !window.confirm(
        `"${row.description}" weer meenemen bij de volgende factuur van ${row.supplierName}?`
      )
    ) {
      return;
    }
    const supabase = createClient();
    const { error: deleteError, data } = await supabase
      .from("ignored_invoice_items")
      .delete()
      .eq("id", row.id)
      .select("id");
    if (deleteError || !data || data.length === 0) {
      window.alert("Terughalen mislukt" + (deleteError ? ": " + deleteError.message : "."));
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  }

  return (
    <>
      <Topbar title="Genegeerde artikelen" />
      <main className="max-w-4xl space-y-4 p-6">
        <p className="text-sm text-muted">
          Deze artikelen worden bij een nieuwe factuur of prijslijst van de genoemde leverancier
          automatisch overgeslagen. Haal een artikel terug als het toch weer verwerkt moet worden.
        </p>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Artikel</th>
                  <th className="px-5 py-3 font-medium">Artikelnr.</th>
                  <th className="px-5 py-3 font-medium">Leverancier</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-5 py-3 font-medium">{r.description}</td>
                    <td className="px-5 py-3 text-muted">{r.article_number ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">{r.supplierName}</td>
                    <td className="px-5 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => restore(r)}>
                        Weer meenemen
                      </Button>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted">
                      {error ? "Kan de lijst niet laden: " + error : "Er worden geen artikelen genegeerd."}
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted">Laden…</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Link href="/leveranciers/facturen" className="text-sm text-teal hover:underline">
          ← Terug naar facturen
        </Link>
      </main>
    </>
  );
}

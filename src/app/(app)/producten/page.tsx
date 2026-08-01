"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

interface ProductRow {
  id: string;
  name: string;
  base_unit: string;
  article_number: string | null;
  ean_code: string | null;
  is_active: boolean;
  pricePerBaseUnit: number | null;
  supplierName: string | null;
  validFrom: string | null;
}

export default function ProductenPage() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data: products, error: fetchError } = await supabase
        .from("products")
        .select("id, name, base_unit, article_number, ean_code, is_active")
        .order("name")
        .limit(200);

      if (cancelled) return;
      if (fetchError || !products) {
        setError(true);
        setLoading(false);
        return;
      }

      const productIds = products.map((p) => p.id);
      const { data: currentPrices } = productIds.length
        ? await supabase
            .from("supplier_products")
            .select(
              "product_id, purchase_price, packaging_unit_count, valid_from, suppliers(name)"
            )
            .in("product_id", productIds)
            .is("valid_to", null)
            .order("valid_from", { ascending: false })
        : { data: [] };

      const priceByProduct = new Map<
        string,
        { pricePerBaseUnit: number; supplierName: string; validFrom: string }
      >();
      for (const row of currentPrices ?? []) {
        if (priceByProduct.has(row.product_id)) continue;
        const pricePerBaseUnit =
          row.packaging_unit_count && row.packaging_unit_count > 0
            ? row.purchase_price / row.packaging_unit_count
            : row.purchase_price;
        // @ts-expect-error -- suppliers komt als geneste relatie terug, niet in het handmatige Database-type
        const supplierName: string = row.suppliers?.name ?? "onbekende leverancier";
        priceByProduct.set(row.product_id, {
          pricePerBaseUnit,
          supplierName,
          validFrom: row.valid_from,
        });
      }

      if (!cancelled) {
        setRows(
          products.map((p) => {
            const price = priceByProduct.get(p.id);
            return {
              id: p.id,
              name: p.name,
              base_unit: p.base_unit,
              article_number: p.article_number,
              ean_code: p.ean_code,
              is_active: p.is_active,
              pricePerBaseUnit: price?.pricePerBaseUnit ?? null,
              supplierName: price?.supplierName ?? null,
              validFrom: price?.validFrom ?? null,
            };
          })
        );
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filteredRows = q
    ? rows.filter((r) =>
        [r.name, r.supplierName, r.article_number, r.ean_code]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(q))
      )
    : rows;

  return (
    <>
      <Topbar title="Centrale productdatabase" />
      <main className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek op leverancier, ingrediënt of artikelnummer…"
              className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
            />
          </div>
          <Link href="/producten/nieuw">
            <Button>
              <Plus className="h-4 w-4" />
              Nieuw product
            </Button>
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Artikel</th>
                  <th className="px-5 py-3 font-medium">Leverancier</th>
                  <th className="px-5 py-3 font-medium">Eenheid</th>
                  <th className="px-5 py-3 font-medium">Actuele inkoopprijs</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-background">
                    <td className="px-5 py-3 font-medium">
                      <Link
                        href={`/producten/${p.id}/bewerken`}
                        className="hover:text-teal hover:underline"
                      >
                        {p.name}
                      </Link>
                      {p.article_number && (
                        <p className="text-xs text-muted">Art.nr. {p.article_number}</p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted">{p.supplierName ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">{p.base_unit}</td>
                    <td className="px-5 py-3 tabular">
                      {p.pricePerBaseUnit !== null ? (
                        <div>
                          <div className="text-foreground">
                            € {p.pricePerBaseUnit.toFixed(4)} / {p.base_unit}
                          </div>
                          {p.validFrom && (
                            <div className="text-xs text-muted">
                              sinds {new Date(p.validFrom).toLocaleDateString("nl-NL")}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted">Geen prijs bekend</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          p.is_active
                            ? "rounded-full bg-success/10 px-2 py-0.5 text-xs text-success"
                            : "rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted"
                        }
                      >
                        {p.is_active ? "Actief" : "Inactief"}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredRows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-muted">
                      {error
                        ? "Kan producten niet laden — controleer de Supabase-koppeling."
                        : q
                        ? "Geen producten gevonden voor deze zoekopdracht."
                        : "Nog geen producten in de centrale database. Voeg het eerste artikel toe."}
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

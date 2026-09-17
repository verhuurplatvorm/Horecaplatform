"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";

interface OrderRow {
  productId: string;
  name: string;
  needed: number;
  baseUnitName: string | null;
  packagingDescription: string | null;
  packagingUnitCount: number | null;
  packagesToOrder: number | null;
  orderedQuantity: number | null;
  supplierName: string | null;
  purchasePrice: number | null;
  lineTotal: number | null;
}

/**
 * Bestellijst: klapt het hele menu uit tot inkoopingrediënten, telt
 * gelijke ingrediënten bij elkaar op en rondt af naar hele
 * leveranciersverpakkingen.
 *
 * Het uitklappen gebeurt in de database (explode_menu_to_products), dus
 * conversies (stuk ↔ gram/ml) en subrecepten lopen daar al in mee. Voor
 * inkoop wordt bewust met BRUTO hoeveelheden gerekend: je koopt het hele
 * product, ook het deel dat je wegsnijdt.
 *
 * Voorraad speelt hier bewust geen rol — dit is puur de behoefte.
 */
export function MenuOrderList({ menuId }: { menuId: string }) {
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      const supabase = createClient();

      const { data: needs } = await supabase.rpc("explode_menu_to_products", {
        p_menu_id: menuId,
      });
      const list = (needs as { product_id: string; quantity_in_base: number }[] | null) ?? [];
      if (cancelled || list.length === 0) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }

      const ids = list.map((n) => n.product_id);
      const [{ data: products }, { data: prices }] = await Promise.all([
        supabase.from("products").select("id, name, custom_name, base_unit_id").in("id", ids),
        supabase
          .from("supplier_products")
          .select(
            "product_id, packaging_description, packaging_unit_count, purchase_price, valid_from, suppliers(name)"
          )
          .in("product_id", ids)
          .is("valid_to", null)
          .order("valid_from", { ascending: false }),
      ]);

      const unitIds = [
        ...new Set((products ?? []).map((p) => p.base_unit_id).filter(Boolean)),
      ] as string[];
      const { data: units } = unitIds.length
        ? await supabase.from("units").select("id, name").in("id", unitIds)
        : { data: [] };
      const unitName = new Map((units ?? []).map((u) => [u.id, u.name]));

      // Eerste (meest recente) actieve prijs per ingrediënt is leidend.
      const priceByProduct = new Map<string, (typeof prices extends null ? never : NonNullable<typeof prices>[number])>();
      for (const pr of prices ?? []) {
        if (!priceByProduct.has(pr.product_id)) priceByProduct.set(pr.product_id, pr);
      }
      const productById = new Map((products ?? []).map((p) => [p.id, p]));

      const out: OrderRow[] = list.map((n) => {
        const p = productById.get(n.product_id);
        const pr = priceByProduct.get(n.product_id);
        const packSize = pr?.packaging_unit_count ?? null;

        // Naar boven afronden op hele verpakkingen: je kunt geen halve
        // zak bestellen.
        const packages =
          packSize && packSize > 0 ? Math.ceil(n.quantity_in_base / packSize) : null;
        const ordered = packages !== null && packSize ? packages * packSize : null;

        return {
          productId: n.product_id,
          name: p?.custom_name?.trim() || p?.name || "onbekend ingrediënt",
          needed: n.quantity_in_base,
          baseUnitName: p?.base_unit_id ? unitName.get(p.base_unit_id) ?? null : null,
          packagingDescription: pr?.packaging_description ?? null,
          packagingUnitCount: packSize,
          packagesToOrder: packages,
          orderedQuantity: ordered,
          // @ts-expect-error -- suppliers komt als geneste relatie terug
          supplierName: pr?.suppliers?.name ?? null,
          purchasePrice: pr?.purchase_price ?? null,
          lineTotal:
            packages !== null && pr?.purchase_price != null
              ? packages * pr.purchase_price
              : null,
        };
      });

      if (!cancelled) {
        setRows(out.sort((a, b) => (a.supplierName ?? "").localeCompare(b.supplierName ?? "", "nl") || a.name.localeCompare(b.name, "nl")));
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [menuId, referenceCompanyId]);

  const total = rows.reduce((s, r) => s + (r.lineTotal ?? 0), 0);

  /** Per leverancier gegroepeerd exporteren — de basis voor een conceptbestelling. */
  function exportCsv() {
    const header = [
      "Leverancier","Ingrediënt","Benodigd","Eenheid","Verpakking",
      "Inhoud","Te bestellen","Besteld totaal","Inkoopprijs","Totaalbedrag",
    ];
    const lines = rows.map((r) => [
      r.supplierName ?? "geen leverancier", r.name,
      r.needed.toFixed(2), r.baseUnitName ?? "",
      r.packagingDescription ?? "", r.packagingUnitCount ?? "",
      r.packagesToOrder ?? "", r.orderedQuantity?.toFixed(2) ?? "",
      r.purchasePrice?.toFixed(2) ?? "", r.lineTotal?.toFixed(2) ?? "",
    ]);
    const csv = [header, ...lines]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "bestellijst.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Groeperen per leverancier, zodat er per leverancier besteld kan worden.
  const bySupplier = new Map<string, OrderRow[]>();
  for (const r of rows) {
    const key = r.supplierName ?? "Geen leverancier gekoppeld";
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key)!.push(r);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Bestellijst</CardTitle>
        {rows.length > 0 && (
          <Button variant="secondary" size="sm" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" />
            Exporteren per leverancier
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-muted">
            {loading
              ? "Ingrediëntbehoefte berekenen…"
              : "Nog niets te bestellen — voeg gerechten of ingrediënten toe aan dit menu."}
          </p>
        ) : (
          <>
            {[...bySupplier.entries()].map(([supplier, list]) => (
              <div key={supplier}>
                <p className="border-y border-border bg-background px-5 py-2 text-sm font-medium">
                  {supplier}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted">
                        <th className="px-4 py-2 font-medium">Ingrediënt</th>
                        <th className="px-4 py-2 font-medium">Benodigd</th>
                        <th className="px-4 py-2 font-medium">Verpakking</th>
                        <th className="px-4 py-2 font-medium">Te bestellen</th>
                        <th className="px-4 py-2 font-medium">Inkoopprijs</th>
                        <th className="px-4 py-2 font-medium">Totaal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => (
                        <tr key={r.productId} className="border-t border-border">
                          <td className="px-4 py-2 font-medium">{r.name}</td>
                          <td className="px-4 py-2 tabular">
                            {r.needed.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}{" "}
                            {r.baseUnitName}
                          </td>
                          <td className="px-4 py-2 text-muted">
                            {r.packagingUnitCount
                              ? `${r.packagingUnitCount} ${r.baseUnitName ?? ""}`
                              : "onbekend"}
                          </td>
                          <td className="px-4 py-2 tabular">
                            {r.packagesToOrder !== null ? (
                              <>
                                <span className="font-medium">
                                  {r.packagesToOrder}×
                                </span>{" "}
                                <span className="text-xs text-muted">
                                  = {r.orderedQuantity?.toLocaleString("nl-NL", {
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  {r.baseUnitName}
                                </span>
                              </>
                            ) : (
                              <span className="text-copper">verpakking onbekend</span>
                            )}
                          </td>
                          <td className="px-4 py-2 tabular text-muted">
                            {r.purchasePrice != null ? `€ ${r.purchasePrice.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-4 py-2 tabular font-medium">
                            {r.lineTotal != null ? `€ ${r.lineTotal.toFixed(2)}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border px-5 py-3">
              <span className="text-sm text-muted">
                {rows.length} ingrediënt(en) · bedragen zijn inkoop van hele verpakkingen
              </span>
              <span className="tabular text-lg font-semibold">€ {total.toFixed(2)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

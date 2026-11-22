"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface Need {
  halfproduct_id: string | null;
  product_id: string | null;
  quantity_in_base: number;
}

interface ProductInfo {
  name: string;
  baseUnitName: string | null;
  packagingUnitCount: number | null;
  supplierName: string | null;
  purchasePrice: number | null;
}

interface HalfproductInfo {
  id: string;
  name: string;
  needed: number;
  unitName: string | null;
  /** Ingrediënten als je het halfproduct moet maken */
  ingredients: { productId: string; quantity: number }[];
}

interface OrderRow {
  productId: string;
  name: string;
  needed: number;
  baseUnitName: string | null;
  packagingUnitCount: number | null;
  packagesToOrder: number | null;
  orderedQuantity: number | null;
  supplierName: string | null;
  purchasePrice: number | null;
  lineTotal: number | null;
  /** Halfproducten (niet in huis) waarvoor dit ingrediënt ook nodig is */
  forHalfproducts: string[];
}

const fmt = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 2 });

function storageKey(menuId: string) {
  return `bestellijst-niet-in-huis:${menuId}`;
}

function readOutOfStock(menuId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(menuId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/**
 * Bestellijst.
 *
 * Halfproducten liggen meestal op voorraad. Ze staan daarom bovenaan als
 * herinnering met de hoeveelheid die nodig is. Is een halfproduct niet in
 * huis, dan klik je het aan: zijn ingrediënten tellen dan mee in de
 * bestellijst (bij elkaar opgeteld met de rest). De keuze wordt per menu in
 * deze browser onthouden.
 *
 * De behoefte komt uit de database (get_event_menu_order_needs, migratie
 * 0136): omrekenen en partijgerechten lopen daar. Inkoop rekent BRUTO.
 */
export function MenuOrderList({
  menuId,
  showPrices = true,
}: {
  menuId: string;
  /** false voor rollen zonder financiële rechten (bv. Operator): geen inkoopprijzen. */
  showPrices?: boolean;
}) {
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const [needs, setNeeds] = useState<Need[]>([]);
  const [products, setProducts] = useState<Map<string, ProductInfo>>(new Map());
  const [halfMeta, setHalfMeta] = useState<
    Map<string, { name: string; unitName: string | null }>
  >(new Map());
  const [outOfStock, setOutOfStock] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  function toggleOutOfStock(id: string) {
    setOutOfStock((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(storageKey(menuId), JSON.stringify([...next]));
      } catch {
        // geen opslag beschikbaar: keuze geldt alleen voor dit scherm
      }
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      const supabase = createClient();

      const { data } = await supabase.rpc("get_event_menu_order_needs", {
        p_menu_id: menuId,
      });
      // Niet-gekozen opties komen met hoeveelheid 0 terug: niet bestellen.
      const list = ((data ?? []) as Need[])
        .map((n) => ({
          ...n,
          quantity_in_base: Number(n.quantity_in_base),
        }))
        .filter((n) => n.quantity_in_base > 0);
      if (cancelled) return;
      if (list.length === 0) {
        setOutOfStock(readOutOfStock(menuId));
        setNeeds([]);
        setLoading(false);
        return;
      }

      const productIds = [
        ...new Set(list.map((n) => n.product_id).filter(Boolean)),
      ] as string[];
      const halfIds = [
        ...new Set(
          list.filter((n) => !n.product_id && n.halfproduct_id).map((n) => n.halfproduct_id)
        ),
      ] as string[];

      const [{ data: prods }, { data: prices }, { data: halves }, { data: units }] =
        await Promise.all([
          productIds.length
            ? supabase
                .from("products")
                .select("id, name, custom_name, base_unit_id")
                .in("id", productIds)
            : Promise.resolve({ data: [] as { id: string; name: string; custom_name: string | null; base_unit_id: string | null }[] }),
          productIds.length
            ? supabase
                .from("supplier_products")
                .select(
                  "product_id, packaging_unit_count, purchase_price, valid_from, suppliers(name)"
                )
                .in("product_id", productIds)
                .is("valid_to", null)
                .order("valid_from", { ascending: false })
            : Promise.resolve({ data: [] }),
          halfIds.length
            ? supabase.from("recipes").select("id, name, base_unit_id").in("id", halfIds)
            : Promise.resolve({ data: [] as { id: string; name: string; base_unit_id: string | null }[] }),
          supabase.from("units").select("id, name"),
        ]);

      const unitName = new Map((units ?? []).map((u) => [u.id, u.name]));
      const priceByProduct = new Map<
        string,
        { packaging_unit_count: number | null; purchase_price: number | null; supplier: string | null }
      >();
      for (const pr of (prices ?? []) as unknown as {
        product_id: string;
        packaging_unit_count: number | null;
        purchase_price: number | null;
        suppliers: { name: string } | { name: string }[] | null;
      }[]) {
        if (priceByProduct.has(pr.product_id)) continue;
        const sup = Array.isArray(pr.suppliers) ? pr.suppliers[0] : pr.suppliers;
        priceByProduct.set(pr.product_id, {
          packaging_unit_count: pr.packaging_unit_count,
          purchase_price: pr.purchase_price,
          supplier: sup?.name ?? null,
        });
      }

      const productMap = new Map<string, ProductInfo>();
      for (const p of prods ?? []) {
        const pr = priceByProduct.get(p.id);
        productMap.set(p.id, {
          name: p.custom_name?.trim() || p.name,
          baseUnitName: p.base_unit_id ? unitName.get(p.base_unit_id) ?? null : null,
          packagingUnitCount: pr?.packaging_unit_count ?? null,
          supplierName: pr?.supplier ?? null,
          purchasePrice: pr?.purchase_price ?? null,
        });
      }
      const halfMap = new Map<string, { name: string; unitName: string | null }>();
      for (const h of halves ?? []) {
        halfMap.set(h.id, {
          name: h.name,
          unitName: h.base_unit_id ? unitName.get(h.base_unit_id) ?? null : null,
        });
      }

      if (!cancelled) {
        setOutOfStock(readOutOfStock(menuId));
        setNeeds(list);
        setProducts(productMap);
        setHalfMeta(halfMap);
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [menuId, referenceCompanyId]);

  const halfproducts: HalfproductInfo[] = useMemo(() => {
    const byId = new Map<string, HalfproductInfo>();
    for (const n of needs) {
      if (!n.halfproduct_id) continue;
      const meta = halfMeta.get(n.halfproduct_id);
      if (!byId.has(n.halfproduct_id)) {
        byId.set(n.halfproduct_id, {
          id: n.halfproduct_id,
          name: meta?.name ?? "onbekend halfproduct",
          needed: 0,
          unitName: meta?.unitName ?? null,
          ingredients: [],
        });
      }
      const h = byId.get(n.halfproduct_id)!;
      if (n.product_id) h.ingredients.push({ productId: n.product_id, quantity: n.quantity_in_base });
      else h.needed += n.quantity_in_base;
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "nl"));
  }, [needs, halfMeta]);

  // Ingrediënten: altijd nodig + alles van halfproducten die niet in huis zijn.
  const rows: OrderRow[] = useMemo(() => {
    const qty = new Map<string, number>();
    const forHalf = new Map<string, string[]>();
    for (const n of needs) {
      if (!n.product_id) continue;
      if (n.halfproduct_id && !outOfStock.has(n.halfproduct_id)) continue;
      qty.set(n.product_id, (qty.get(n.product_id) ?? 0) + n.quantity_in_base);
      if (n.halfproduct_id) {
        const name = halfMeta.get(n.halfproduct_id)?.name ?? "halfproduct";
        forHalf.set(n.product_id, [...(forHalf.get(n.product_id) ?? []), name]);
      }
    }
    const out: OrderRow[] = [];
    for (const [productId, needed] of qty) {
      if (!(needed > 0)) continue;
      const p = products.get(productId);
      const packSize = p?.packagingUnitCount ?? null;
      // Naar boven afronden op hele verpakkingen: je kunt geen halve zak bestellen.
      const packages = packSize && packSize > 0 ? Math.ceil(needed / packSize) : null;
      out.push({
        productId,
        name: p?.name ?? "onbekend ingrediënt",
        needed,
        baseUnitName: p?.baseUnitName ?? null,
        packagingUnitCount: packSize,
        packagesToOrder: packages,
        orderedQuantity: packages !== null && packSize ? packages * packSize : null,
        supplierName: p?.supplierName ?? null,
        purchasePrice: p?.purchasePrice ?? null,
        lineTotal:
          packages !== null && p?.purchasePrice != null ? packages * p.purchasePrice : null,
        forHalfproducts: forHalf.get(productId) ?? [],
      });
    }
    return out.sort(
      (a, b) =>
        (a.supplierName ?? "").localeCompare(b.supplierName ?? "", "nl") ||
        a.name.localeCompare(b.name, "nl")
    );
  }, [needs, products, halfMeta, outOfStock]);

  const total = rows.reduce((s, r) => s + (r.lineTotal ?? 0), 0);

  /** Per leverancier gegroepeerd exporteren — de basis voor een conceptbestelling. */
  function exportCsv() {
    const header = [
      "Leverancier","Ingrediënt","Benodigd","Eenheid",
      "Inhoud verpakking","Te bestellen","Besteld totaal",
      ...(showPrices ? ["Inkoopprijs", "Totaalbedrag"] : []),
    ];
    const lines = rows.map((r) => [
      r.supplierName ?? "geen leverancier", r.name,
      r.needed.toFixed(2), r.baseUnitName ?? "",
      r.packagingUnitCount ?? "",
      r.packagesToOrder ?? "", r.orderedQuantity?.toFixed(2) ?? "",
      ...(showPrices
        ? [r.purchasePrice?.toFixed(2) ?? "", r.lineTotal?.toFixed(2) ?? ""]
        : []),
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

  const bySupplier = new Map<string, OrderRow[]>();
  for (const r of rows) {
    const key = r.supplierName ?? "Geen leverancier gekoppeld";
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key)!.push(r);
  }

  const empty = rows.length === 0 && halfproducts.length === 0;

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
        {empty ? (
          <p className="px-5 py-8 text-center text-muted">
            {loading
              ? "Ingrediëntbehoefte berekenen…"
              : "Nog niets te bestellen — voeg gerechten of ingrediënten toe aan dit menu."}
          </p>
        ) : (
          <>
            {halfproducts.length > 0 && (
              <div>
                <div className="border-y border-border bg-background px-5 py-2">
                  <p className="text-sm font-medium">Halfproducten — check of ze in huis zijn</p>
                  <p className="text-xs text-muted">
                    Niet in huis? Klik op het halfproduct: dan komen de ingrediënten om het te
                    maken in de bestellijst.
                  </p>
                </div>
                <ul className="divide-y divide-border">
                  {halfproducts.map((h) => {
                    const missing = outOfStock.has(h.id);
                    const isOpen = open.has(h.id);
                    return (
                      <li key={h.id} className="px-5 py-2.5">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setOpen((prev) => {
                                const next = new Set(prev);
                                if (next.has(h.id)) next.delete(h.id);
                                else next.add(h.id);
                                return next;
                              })
                            }
                            className="text-muted hover:text-foreground"
                            aria-label={isOpen ? "Ingrediënten verbergen" : "Ingrediënten tonen"}
                          >
                            {isOpen ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/halfproducten/${h.id}/bewerken`}
                              className="font-medium hover:underline"
                            >
                              {h.name}
                            </Link>
                            <span className="ml-2 text-sm tabular text-muted">
                              {fmt(h.needed)} {h.unitName} nodig
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleOutOfStock(h.id)}
                            className={cn(
                              "whitespace-nowrap rounded-md border px-3 py-1 text-xs font-medium",
                              missing
                                ? "border-copper bg-copper/10 text-copper"
                                : "border-border text-muted hover:text-foreground"
                            )}
                          >
                            {missing ? "Niet in huis — ingrediënten besteld" : "In huis"}
                          </button>
                        </div>
                        {isOpen && (
                          <ul className="ml-7 mt-2 space-y-0.5 text-xs text-muted">
                            {h.ingredients.length === 0 && <li>geen ingrediënten gevonden</li>}
                            {h.ingredients
                              .map((i) => ({ ...i, p: products.get(i.productId) }))
                              .sort((a, b) => (a.p?.name ?? "").localeCompare(b.p?.name ?? "", "nl"))
                              .map((i) => (
                                <li key={i.productId} className="flex justify-between gap-4">
                                  <span>{i.p?.name ?? "onbekend ingrediënt"}</span>
                                  <span className="tabular">
                                    {fmt(i.quantity)} {i.p?.baseUnitName}
                                  </span>
                                </li>
                              ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

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
                        {showPrices && (
                          <>
                            <th className="px-4 py-2 font-medium">Inkoopprijs</th>
                            <th className="px-4 py-2 font-medium">Totaal</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => (
                        <tr key={r.productId} className="border-t border-border">
                          <td className="px-4 py-2">
                            <span className="font-medium">{r.name}</span>
                            {r.forHalfproducts.length > 0 && (
                              <span className="block text-xs text-muted">
                                incl. voor {[...new Set(r.forHalfproducts)].join(", ")}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 tabular">
                            {fmt(r.needed)} {r.baseUnitName}
                          </td>
                          <td className="px-4 py-2 text-muted">
                            {r.packagingUnitCount
                              ? `${fmt(r.packagingUnitCount)} ${r.baseUnitName ?? ""}`
                              : "onbekend"}
                          </td>
                          <td className="px-4 py-2 tabular">
                            {r.packagesToOrder !== null ? (
                              <>
                                <span className="font-medium">{r.packagesToOrder}×</span>{" "}
                                <span className="text-xs text-muted">
                                  = {fmt(r.orderedQuantity ?? 0)} {r.baseUnitName}
                                </span>
                              </>
                            ) : (
                              <span className="text-copper">verpakking onbekend</span>
                            )}
                          </td>
                          {showPrices && (
                            <>
                              <td className="px-4 py-2 tabular text-muted">
                                {r.purchasePrice != null ? `€ ${r.purchasePrice.toFixed(2)}` : "—"}
                              </td>
                              <td className="px-4 py-2 tabular font-medium">
                                {r.lineTotal != null ? `€ ${r.lineTotal.toFixed(2)}` : "—"}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border px-5 py-3">
              <span className="text-sm text-muted">
                {rows.length} ingrediënt(en)
                {outOfStock.size > 0 &&
                  ` · incl. ${halfproducts.filter((h) => outOfStock.has(h.id)).length} halfproduct(en) niet in huis`}
                {showPrices && " · bedragen zijn inkoop van hele verpakkingen"}
              </span>
              {showPrices && (
                <span className="tabular text-lg font-semibold">€ {total.toFixed(2)}</span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Columns3, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { EventMenuOrderMark } from "@/lib/types/database";

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
  /** Basisvoorraad: altijd in huis. */
  alwaysInStock: boolean;
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
  alwaysInStock: boolean;
}

const fmt = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 2 });

/** Kolommen die je aan/uit kunt zetten (keuze per apparaat onthouden). */
const COLUMNS = [
  { key: "benodigd", label: "Benodigd" },
  { key: "verpakking", label: "Verpakking" },
  { key: "bestellen", label: "Te bestellen" },
  { key: "prijs", label: "Inkoopprijs", financial: true },
  { key: "totaal", label: "Totaal", financial: true },
  { key: "besteld", label: "Besteld door" },
] as const;
type ColumnKey = (typeof COLUMNS)[number]["key"];
const COLUMNS_KEY = "bestellijst:kolommen";
const HIDE_DONE_KEY = "bestellijst:verberg-besteld";

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // geen opslag: keuze geldt alleen voor dit scherm
  }
}

interface Mark extends EventMenuOrderMark {
  byName: string | null;
}
const markKey = (kind: Mark["kind"], id: string) => `${kind}:${id}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });

/**
 * Bestellijst.
 *
 * Halfproducten liggen meestal op voorraad. Ze staan daarom bovenaan als
 * herinnering met de hoeveelheid die nodig is. Is een halfproduct niet in
 * huis, dan klik je het aan: zijn ingrediënten tellen dan mee in de
 * bestellijst (bij elkaar opgeteld met de rest).
 *
 * "Besteld" en "niet in huis" staan in de database (event_menu_order_marks),
 * zodat collega's zien wat er al besteld is, door wie en wanneer.
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
  const [marks, setMarks] = useState<Map<string, Mark>>(new Map());
  const [markError, setMarkError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [shownCols, setShownCols] = useState<ColumnKey[]>(() =>
    readLocal<ColumnKey[]>(COLUMNS_KEY, COLUMNS.map((c) => c.key)),
  );
  const [hideDone, setHideDone] = useState<boolean>(() => readLocal<boolean>(HIDE_DONE_KEY, false));
  const [colMenu, setColMenu] = useState(false);
  const show = (k: ColumnKey) =>
    shownCols.includes(k) && (showPrices || !COLUMNS.find((c) => c.key === k && "financial" in c));

  const outOfStock = useMemo(
    () => new Set([...marks.values()].filter((m) => m.kind === "niet_in_huis").map((m) => m.item_id)),
    [marks],
  );

  // Afvinkstatus ophalen (gedeeld met collega's).
  async function loadMarks() {
    const supabase = createClient();
    const { data } = await supabase.from("event_menu_order_marks").select("*").eq("menu_id", menuId);
    const list = (data as EventMenuOrderMark[]) ?? [];
    const ids = [...new Set(list.map((m) => m.marked_by).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: ppl } = await supabase.from("user_profiles").select("id, full_name").in("id", ids);
      for (const u of ppl ?? []) names.set(u.id, u.full_name);
    }
    return new Map(
      list.map((m) => [markKey(m.kind, m.item_id), { ...m, byName: m.marked_by ? names.get(m.marked_by) ?? null : null }]),
    );
  }
  useEffect(() => {
    let cancelled = false;
    void loadMarks().then((m) => {
      if (!cancelled) setMarks(m);
    });
    // Elke minuut verversen, zodat je ziet wat een collega net heeft afgevinkt.
    const t = setInterval(() => {
      void loadMarks().then((m) => {
        if (!cancelled) setMarks(m);
      });
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuId]);

  async function setMark(kind: Mark["kind"], items: { id: string; packages?: number | null }[], on: boolean) {
    const supabase = createClient();
    setMarkError(null);
    // Direct tonen; daarna opslaan.
    setMarks((prev) => {
      const next = new Map(prev);
      for (const it of items) {
        if (on)
          next.set(markKey(kind, it.id), {
            menu_id: menuId,
            item_id: it.id,
            kind,
            packages: it.packages ?? null,
            marked_by: null,
            marked_at: new Date().toISOString(),
            byName: "jij",
          });
        else next.delete(markKey(kind, it.id));
      }
      return next;
    });
    const { error } = on
      ? await supabase.from("event_menu_order_marks").upsert(
          items.map((it) => ({ menu_id: menuId, item_id: it.id, kind, packages: it.packages ?? null })),
          { onConflict: "menu_id,item_id,kind" },
        )
      : await supabase
          .from("event_menu_order_marks")
          .delete()
          .eq("menu_id", menuId)
          .eq("kind", kind)
          .in("item_id", items.map((it) => it.id));
    if (error) setMarkError("Opslaan mislukt: " + error.message);
    setMarks(await loadMarks());
  }

  function toggleOutOfStock(id: string) {
    void setMark("niet_in_huis", [{ id }], !outOfStock.has(id));
  }

  function toggleCol(k: ColumnKey) {
    setShownCols((prev) => {
      const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
      writeLocal(COLUMNS_KEY, next);
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
                .select("id, name, custom_name, base_unit_id, always_in_stock")
                .in("id", productIds)
            : Promise.resolve({ data: [] as { id: string; name: string; custom_name: string | null; base_unit_id: string | null; always_in_stock: boolean }[] }),
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
          alwaysInStock: !!p.always_in_stock,
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
        alwaysInStock: p?.alwaysInStock ?? false,
      });
    }
    return out.sort(
      (a, b) =>
        (a.supplierName ?? "").localeCompare(b.supplierName ?? "", "nl") ||
        a.name.localeCompare(b.name, "nl")
    );
  }, [needs, products, halfMeta, outOfStock]);

  // Basisvoorraad en "in huis" hoeven niet besteld: tellen niet mee.
  const isInHouse = (r: OrderRow) => r.alwaysInStock || marks.has(markKey("in_huis", r.productId));
  const total = rows.filter((r) => !isInHouse(r)).reduce((s, r) => s + (r.lineTotal ?? 0), 0);

  /** Ingrediënt als basisvoorraad (altijd in huis) markeren, voor alle bestellijsten. */
  async function setAlwaysInStock(productId: string, on: boolean) {
    setMarkError(null);
    setProducts((prev) => {
      const next = new Map(prev);
      const p = next.get(productId);
      if (p) next.set(productId, { ...p, alwaysInStock: on });
      return next;
    });
    const { error } = await createClient().from("products").update({ always_in_stock: on }).eq("id", productId);
    if (error) {
      setMarkError("Opslaan mislukt (rechten op ingrediënten nodig): " + error.message);
      setProducts((prev) => {
        const next = new Map(prev);
        const p = next.get(productId);
        if (p) next.set(productId, { ...p, alwaysInStock: !on });
        return next;
      });
    }
  }

  /** Per leverancier gegroepeerd exporteren — de basis voor een conceptbestelling. */
  function exportCsv() {
    const header = [
      "Leverancier","Ingrediënt","Benodigd","Eenheid",
      "Inhoud verpakking","Te bestellen","Besteld totaal",
      ...(showPrices ? ["Inkoopprijs", "Totaalbedrag"] : []),
      "Status", "Besteld door", "Besteld op",
    ];
    const lines = rows.map((r) => [
      r.supplierName ?? "geen leverancier", r.name,
      r.needed.toFixed(2), r.baseUnitName ?? "",
      r.packagingUnitCount ?? "",
      r.packagesToOrder ?? "", r.orderedQuantity?.toFixed(2) ?? "",
      ...(showPrices
        ? [r.purchasePrice?.toFixed(2) ?? "", r.lineTotal?.toFixed(2) ?? ""]
        : []),
      r.alwaysInStock
        ? "altijd in huis"
        : marks.has(markKey("in_huis", r.productId))
          ? "in huis"
          : marks.has(markKey("besteld", r.productId))
            ? "besteld"
            : "open",
      marks.get(markKey("besteld", r.productId))?.byName ?? "",
      (() => {
        const m = marks.get(markKey("besteld", r.productId));
        return m ? when(m.marked_at) : "";
      })(),
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
  const basisRows = rows.filter((r) => r.alwaysInStock);
  for (const r of rows) {
    if (r.alwaysInStock) continue;
    const key = r.supplierName ?? "Geen leverancier gekoppeld";
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key)!.push(r);
  }

  const empty = rows.length === 0 && halfproducts.length === 0;
  const toArrange = rows.filter((r) => !r.alwaysInStock);
  const isDone = (r: OrderRow) => marks.has(markKey("besteld", r.productId)) || marks.has(markKey("in_huis", r.productId));
  const orderedCount = toArrange.filter(isDone).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>
          Bestellijst
          {rows.length > 0 && (
            <span
              className={cn(
                "ml-3 text-sm font-normal",
                orderedCount === toArrange.length ? "text-teal" : "text-muted",
              )}
            >
              {orderedCount} van {toArrange.length} geregeld (besteld of in huis)
            </span>
          )}
        </CardTitle>
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm text-muted">
              <input
                type="checkbox"
                checked={hideDone}
                onChange={(e) => {
                  setHideDone(e.target.checked);
                  writeLocal(HIDE_DONE_KEY, e.target.checked);
                }}
              />
              Bestelde verbergen
            </label>
            <div className="relative">
              <Button variant="secondary" size="sm" onClick={() => setColMenu((v) => !v)}>
                <Columns3 className="h-3.5 w-3.5" />
                Kolommen
              </Button>
              {colMenu && (
                <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-border bg-surface p-2 shadow-lg">
                  {COLUMNS.filter((c) => showPrices || !("financial" in c)).map((c) => (
                    <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-background">
                      <input type="checkbox" checked={shownCols.includes(c.key)} onChange={() => toggleCol(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5" />
              Exporteren per leverancier
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        {markError && <p className="px-5 text-sm text-danger">{markError}</p>}
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
                            {missing && (() => {
                              const mk = marks.get(markKey("niet_in_huis", h.id));
                              return mk ? (
                                <span className="ml-2 text-xs text-copper">
                                  niet in huis volgens {mk.byName ?? "collega"} · {when(mk.marked_at)}
                                </span>
                              ) : null;
                            })()}
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
                            {missing ? "Niet in huis — ingrediënten op de lijst" : "In huis"}
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

            {[...bySupplier.entries()].map(([supplier, list]) => {
              const done = list.filter(isDone);
              const allDone = done.length === list.length;
              const visible = hideDone ? list.filter((r) => !isDone(r)) : list;
              return (
              <div key={supplier}>
                <div className="flex flex-wrap items-center gap-3 border-y border-border bg-background px-5 py-2">
                  <p className="text-sm font-medium">{supplier}</p>
                  <span className={cn("text-xs", allDone ? "text-teal" : "text-muted")}>
                    {done.length}/{list.length} geregeld
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void setMark(
                        "besteld",
                        list.map((r) => ({ id: r.productId, packages: r.packagesToOrder })),
                        !allDone,
                      )
                    }
                    className="ml-auto rounded-md border border-border px-3 py-1 text-xs hover:bg-surface"
                  >
                    {allDone ? "Alles weer open" : "Alles van deze leverancier besteld"}
                  </button>
                </div>
                {visible.length === 0 ? (
                  <p className="px-5 py-2 text-xs text-teal">Alles geregeld.</p>
                ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted">
                        <th className="w-12 px-4 py-2 font-medium">Besteld</th>
                        <th className="px-4 py-2 font-medium">Ingrediënt</th>
                        {show("benodigd") && <th className="px-4 py-2 font-medium">Benodigd</th>}
                        {show("verpakking") && <th className="px-4 py-2 font-medium">Verpakking</th>}
                        {show("bestellen") && <th className="px-4 py-2 font-medium">Te bestellen</th>}
                        {show("prijs") && <th className="px-4 py-2 font-medium">Inkoopprijs</th>}
                        {show("totaal") && <th className="px-4 py-2 font-medium">Totaal</th>}
                        {show("besteld") && <th className="px-4 py-2 font-medium">Besteld door</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((r) => {
                        const m = marks.get(markKey("besteld", r.productId));
                        const inHuis = marks.get(markKey("in_huis", r.productId));
                        // Na het bestellen meer/minder nodig (bv. gasten gewijzigd)?
                        const changed =
                          m && m.packages !== null && r.packagesToOrder !== null && Number(m.packages) !== r.packagesToOrder;
                        return (
                        <tr key={r.productId} className={cn("border-t border-border", (m || inHuis) && "bg-teal/5")}>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void setMark("besteld", [{ id: r.productId, packages: r.packagesToOrder }], !m)}
                              className={cn(
                                "flex h-8 w-8 items-center justify-center rounded-md border-2",
                                m ? "border-teal bg-teal text-white" : "border-border bg-surface hover:border-teal",
                              )}
                              aria-label={m ? "Besteld — klik om terug te zetten" : "Afvinken als besteld"}
                            >
                              {m && <Check className="h-5 w-5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => void setMark("in_huis", [{ id: r.productId }], !inHuis)}
                              className={cn(
                                "h-8 whitespace-nowrap rounded-md border px-2 text-xs",
                                inHuis ? "border-teal bg-teal/10 font-medium text-teal" : "border-border text-muted hover:text-foreground",
                              )}
                              title="Deze keer in huis: hoeft niet besteld"
                            >
                              in huis
                            </button>
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <span className={cn("font-medium", (m || inHuis) && "text-muted line-through decoration-teal/50")}>{r.name}</span>
                            {inHuis && (
                              <span className="ml-2 text-xs text-teal">
                                in huis · {inHuis.byName ?? "collega"}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => void setAlwaysInStock(r.productId, true)}
                              className="ml-2 text-xs text-muted underline decoration-dotted hover:text-teal"
                              title="Basisvoorraad: staat voortaan in elke bestellijst bij 'altijd in huis'"
                            >
                              altijd in huis
                            </button>
                            {r.forHalfproducts.length > 0 && (
                              <span className="block text-xs text-muted">
                                incl. voor {[...new Set(r.forHalfproducts)].join(", ")}
                              </span>
                            )}
                            {changed && (
                              <span className="block text-xs text-copper">
                                Besteld: {Number(m!.packages)}× — nu nodig: {r.packagesToOrder}×
                              </span>
                            )}
                          </td>
                          {show("benodigd") && (
                          <td className="px-4 py-2 tabular">
                            {fmt(r.needed)} {r.baseUnitName}
                          </td>
                          )}
                          {show("verpakking") && (
                          <td className="px-4 py-2 text-muted">
                            {r.packagingUnitCount
                              ? `${fmt(r.packagingUnitCount)} ${r.baseUnitName ?? ""}`
                              : "onbekend"}
                          </td>
                          )}
                          {show("bestellen") && (
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
                          )}
                          {show("prijs") && (
                            <td className="px-4 py-2 tabular text-muted">
                              {r.purchasePrice != null ? `€ ${r.purchasePrice.toFixed(2)}` : "—"}
                            </td>
                          )}
                          {show("totaal") && (
                            <td className="px-4 py-2 tabular font-medium">
                              {r.lineTotal != null ? `€ ${r.lineTotal.toFixed(2)}` : "—"}
                            </td>
                          )}
                          {show("besteld") && (
                            <td className="px-4 py-2 text-xs text-muted">
                              {m ? (
                                <>
                                  {m.byName ?? "onbekend"}
                                  <span className="block">{when(m.marked_at)}</span>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                          )}
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                )}
              </div>
              );
            })}
            {basisRows.length > 0 && (
              <details className="border-t border-border">
                <summary className="cursor-pointer bg-background px-5 py-2 text-sm font-medium">
                  Basisvoorraad — altijd in huis ({basisRows.length})
                  <span className="ml-2 text-xs font-normal text-muted">hoeft niet besteld; telt niet mee in het bedrag</span>
                </summary>
                <ul className="divide-y divide-border">
                  {basisRows.map((r) => (
                    <li key={r.productId} className="flex flex-wrap items-center gap-3 px-5 py-2 text-sm">
                      <span className="flex-1">{r.name}</span>
                      <span className="tabular text-muted">
                        {fmt(r.needed)} {r.baseUnitName}
                      </span>
                      <button
                        type="button"
                        onClick={() => void setAlwaysInStock(r.productId, false)}
                        className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
                      >
                        geen basis meer
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex items-center justify-between border-t border-border px-5 py-3">
              <span className="text-sm text-muted">
                {rows.length} ingrediënt(en)
                {outOfStock.size > 0 &&
                  ` · incl. ${halfproducts.filter((h) => outOfStock.has(h.id)).length} halfproduct(en) niet in huis`}
                {showPrices && " · bedrag = te bestellen (excl. in huis en basisvoorraad), hele verpakkingen"}
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

"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileDown,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import {
  NO_STATION,
  aggregateHalfproducts,
  aggregateIngredients,
  chooseArticle,
  dishesInStations,
  formatQuantity,
  inStations,
  packSizeBase,
  packsNeeded,
  possibleDuplicates,
  sharedWithoutOwnStation,
  suggestStation,
  type KitchenRow,
  type SupplierArticle,
} from "@/lib/kitchen-lists/kitchen-lists";
import type { KitchenStation, MenuCard } from "@/lib/types/database";

type ListKind =
  "ingredienten" | "bestelapp" | "halfproducten" | "aanwezigheid" | "alles";
type SortKind = "partie" | "leverancier" | "productgroep" | "alfabet";

const LISTS: { key: ListKind; label: string }[] = [
  { key: "ingredienten", label: "Ingrediëntenlijst" },
  { key: "bestelapp", label: "Bestelapp-lijst" },
  { key: "halfproducten", label: "Halfproductenlijst" },
  { key: "aanwezigheid", label: "Aanwezigheidslijst" },
  { key: "alles", label: "Alles gecombineerd" },
];

interface RecipeInfo {
  id: string;
  name: string;
  recipe_kind: "gerecht" | "halfproduct";
  status: string;
  category: string | null;
  station_id?: string | null;
  yield_quantity: number | null;
  yield_unit: string | null;
}

interface ProductInfo {
  id: string;
  name: string;
  custom_name: string | null;
  product_group: string | null;
  base_unit: string | null;
  preferred_supplier_id: string | null;
}

interface Problem {
  key: string;
  text: string;
  href?: string;
  label: string;
}

const CHUNK = 200;

async function inChunks<T>(
  ids: string[],
  fn: (chunk: string[]) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await fn(ids.slice(i, i + CHUNK));
    out.push(...(data ?? []));
  }
  return out;
}

function Box({ checked }: { checked?: boolean }) {
  return (
    <span className="inline-block h-3.5 w-3.5 border border-black align-middle">
      {checked ? "✓" : ""}
    </span>
  );
}

export function KitchenLists({ companyId }: { companyId: string }) {
  const { companies } = useCompanyScope();
  const company = companies.find((c) => c.id === companyId);
  const companyName = company?.trade_name || company?.name || "";
  // Operator: alleen bekijken en afdrukken; partie en voorkeursleverancier
  // niet wijzigen (database weigert dat ook).
  const { isOperator: readOnly } = usePermissions();

  // ---------- keuzes ----------
  const [cards, setCards] = useState<MenuCard[]>([]);
  const [cardIds, setCardIds] = useState<string[]>([]);
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [list, setList] = useState<ListKind>("ingredienten");
  const [sort, setSort] = useState<SortKind>("partie");
  const [withQty, setWithQty] = useState(false);
  const [portions, setPortions] = useState<Record<string, number>>({});

  // ---------- gegevens ----------
  const [rows, setRows] = useState<KitchenRow[] | null>(null);
  const [recipes, setRecipes] = useState<Map<string, RecipeInfo>>(new Map());
  const [products, setProducts] = useState<Map<string, ProductInfo>>(new Map());
  const [articles, setArticles] = useState<Map<string, SupplierArticle[]>>(
    new Map(),
  );
  const [appChecks, setAppChecks] = useState<
    Map<string, "ja" | "nee" | "onbekend">
  >(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(true);
  const [showStations, setShowStations] = useState(false);
  const [openDish, setOpenDish] = useState<string | null>(null);
  const [openHp, setOpenHp] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Menukaarten + parties
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      supabase.from("menu_cards").select("*").order("name"),
      supabase
        .from("kitchen_stations")
        .select("*")
        .eq("is_active", true)
        .order("sort_order"),
    ]).then(([c, s]) => {
      if (cancelled) return;
      const list = ((c.data as MenuCard[]) ?? []).filter(
        (m) => !m.company_id || m.company_id === companyId,
      );
      setCards(list);
      const own = list.filter(
        (m) => m.status === "actief" && m.company_id === companyId,
      );
      const def =
        own.length > 0 ? own : list.filter((m) => m.status === "actief");
      setCardIds(def.map((m) => m.id));
      setStations((s.data as KitchenStation[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // De receptboom ophalen (opnieuw bij andere kaart of porties).
  const portionsArg = useMemo(() => {
    if (!withQty) return null;
    const p = Object.fromEntries(
      Object.entries(portions).filter(([, v]) => v > 0),
    );
    return p;
  }, [withQty, portions]);

  const load = useCallback(async () => {
    if (cardIds.length === 0) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc("kitchen_list", {
      p_card_ids: cardIds,
      p_portions: portionsArg,
    });
    if (err) {
      setLoading(false);
      setError(err.message);
      return;
    }
    const r = (data as KitchenRow[]) ?? [];

    const recipeIds = [
      ...new Set(
        r
          .flatMap((x) => [x.dish_id, x.recipe_id, x.sub_recipe_id ?? ""])
          .filter(Boolean),
      ),
    ];
    const productIds = [
      ...new Set(r.map((x) => x.product_id).filter(Boolean) as string[]),
    ];

    const [rec, prod, sp, checks] = await Promise.all([
      inChunks<RecipeInfo>(recipeIds, (ids) =>
        supabase
          .from("recipes")
          .select(
            "id, name, recipe_kind, status, category, station_id, yield_quantity, yield_unit",
          )
          .in("id", ids),
      ),
      inChunks<ProductInfo>(productIds, (ids) =>
        supabase
          .from("products")
          .select(
            "id, name, custom_name, product_group, base_unit, preferred_supplier_id",
          )
          .in("id", ids),
      ),
      inChunks<{
        product_id: string;
        supplier_id: string;
        supplier_article_code: string | null;
        packaging_description: string | null;
        purchase_price: number | null;
        price_per_base_unit: number | null;
        valid_from: string | null;
        suppliers: { name: string } | null;
      }>(
        productIds,
        (ids) =>
          supabase
            .from("supplier_products")
            .select(
              "product_id, supplier_id, supplier_article_code, packaging_description, purchase_price, price_per_base_unit, valid_from, suppliers(name)",
            )
            .in("product_id", ids)
            .is("valid_to", null)
            .limit(5000) as unknown as PromiseLike<{ data: never[] | null }>,
      ),
      supabase
        .from("order_app_checks")
        .select("product_id, supplier_id, status")
        .eq("company_id", companyId)
        .limit(10000),
    ]);

    const artMap = new Map<string, SupplierArticle[]>();
    for (const a of sp) {
      const list = artMap.get(a.product_id) ?? [];
      list.push({
        supplier_id: a.supplier_id,
        supplier_name: a.suppliers?.name ?? "?",
        supplier_article_code: a.supplier_article_code,
        packaging_description: a.packaging_description,
        purchase_price: a.purchase_price,
        price_per_base_unit: a.price_per_base_unit,
        valid_from: a.valid_from,
      });
      artMap.set(a.product_id, list);
    }
    const chk = new Map<string, "ja" | "nee" | "onbekend">();
    for (const c of checks.data ?? []) {
      chk.set(
        `${c.product_id}:${c.supplier_id ?? ""}`,
        c.status as "ja" | "nee" | "onbekend",
      );
    }

    setRows(r);
    setRecipes(new Map(rec.map((x) => [x.id, x])));
    setProducts(new Map(prod.map((x) => [x.id, x])));
    setArticles(artMap);
    setAppChecks(chk);
    setLoading(false);
  }, [cardIds, portionsArg, companyId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), withQty ? 400 : 0);
    return () => clearTimeout(t);
  }, [load, withQty, reload]);

  // ---------- afgeleid ----------
  const stationName = useCallback(
    (key: string | null | undefined) => {
      if (!key || key === NO_STATION) return "Niet ingedeeld";
      return stations.find((s) => s.id === key)?.name ?? "?";
    },
    [stations],
  );
  const recipeName = (id: string) => recipes.get(id)?.name ?? "…";
  const productName = (id: string) => {
    const p = products.get(id);
    return p ? p.custom_name || p.name : "…";
  };

  const allRows = useMemo(() => rows ?? [], [rows]);
  const dishIds = useMemo(
    () => [...new Set(allRows.map((r) => r.dish_id))],
    [allRows],
  );
  const dishStation = useMemo(
    () => new Map(dishIds.map((d) => [d, recipes.get(d)?.station_id ?? null])),
    [dishIds, recipes],
  );

  const ingredients = useMemo(
    () => aggregateIngredients(allRows, selected, withQty),
    [allRows, selected, withQty],
  );
  const halfproducts = useMemo(
    () => aggregateHalfproducts(allRows, selected, withQty),
    [allRows, selected, withQty],
  );
  const dishes = useMemo(
    () => [...dishesInStations(allRows, dishStation, selected)],
    [allRows, dishStation, selected],
  );

  const articleFor = useCallback(
    (productId: string) =>
      chooseArticle(
        articles.get(productId) ?? [],
        products.get(productId)?.preferred_supplier_id ?? null,
      ),
    [articles, products],
  );

  // Ingrediëntenregels, gesorteerd/gegroepeerd.
  const ingredientRows = useMemo(() => {
    const list = [...ingredients.values()].map((a) => {
      const p = products.get(a.productId);
      const art = articleFor(a.productId);
      return {
        agg: a,
        name: p ? p.custom_name || p.name : "…",
        unit: p?.base_unit ?? "",
        group: p?.product_group ?? "",
        art,
        supplier: art.article?.supplier_name ?? "",
        station: [...a.stations].map(stationName).sort().join(", "),
      };
    });
    const groupOf = (x: (typeof list)[number]) =>
      sort === "partie"
        ? x.station
        : sort === "leverancier"
          ? x.supplier || "Geen leverancier"
          : sort === "productgroep"
            ? x.group || "Overig"
            : "";
    return list
      .map((x) => ({ ...x, groupKey: groupOf(x) }))
      .sort(
        (a, b) =>
          a.groupKey.localeCompare(b.groupKey, "nl") ||
          a.name.localeCompare(b.name, "nl"),
      );
  }, [ingredients, products, articleFor, stationName, sort]);

  // ---------- controle nodig ----------
  const problems = useMemo(() => {
    const out: Problem[] = [];
    const seen = new Set<string>();
    const add = (p: Problem) => {
      if (seen.has(p.key)) return;
      seen.add(p.key);
      out.push(p);
    };
    const recipeHref = (id: string) =>
      recipes.get(id)?.recipe_kind === "halfproduct"
        ? `/halfproducten/${id}/bewerken`
        : `/recepturen/${id}/bewerken`;
    for (const r of allRows) {
      if (!inStations(r.station_id, selected) && r.kind !== "geen_receptuur")
        continue;
      if (!r.problem) continue;
      const where = recipeName(r.recipe_id);
      const what =
        r.kind === "product"
          ? productName(r.product_id ?? "")
          : r.kind === "halfproduct"
            ? recipeName(r.sub_recipe_id ?? "")
            : r.kind === "ongekoppeld"
              ? `"${r.unmatched_name ?? "?"}"`
              : "";
      add({
        key: `${r.problem}:${r.recipe_id}:${r.line_id ?? ""}`,
        text:
          r.kind === "geen_receptuur"
            ? `${where}: gerecht zonder receptuur`
            : `${where}: ${what} — ${r.problem}`,
        href: recipeHref(
          r.kind === "halfproduct" && r.problem.startsWith("halfproduct")
            ? (r.sub_recipe_id ?? r.recipe_id)
            : r.recipe_id,
        ),
        label: r.problem,
      });
    }
    for (const a of ingredients.values()) {
      const art = articleFor(a.productId);
      if (!art.article)
        add({
          key: `nolev:${a.productId}`,
          text: `${productName(a.productId)}: geen leverancier`,
          href: `/producten/${a.productId}/bewerken`,
          label: "geen leverancier",
        });
      else if (!art.article.supplier_article_code)
        add({
          key: `noart:${a.productId}`,
          text: `${productName(a.productId)}: geen artikelnummer (${art.article.supplier_name})`,
          href: `/producten/${a.productId}/bewerken`,
          label: "geen artikelnummer",
        });
      if (art.article && !packSizeBase(art.article))
        add({
          key: `nopack:${a.productId}`,
          text: `${productName(a.productId)}: verpakking onbekend`,
          href: `/producten/${a.productId}/bewerken`,
          label: "verpakking onbekend",
        });
      if (art.others > 0 && !art.preferred)
        add({
          key: `pref:${a.productId}`,
          text: `${productName(a.productId)}: ${art.others + 1} leveranciers, geen vaste voorkeur`,
          href: `/producten/${a.productId}/bewerken`,
          label: "geen voorkeursleverancier",
        });
    }
    const dup = possibleDuplicates(
      [...ingredients.keys()].map((id) => ({ id, name: productName(id) })),
    );
    for (const ids of dup)
      add({
        key: `dup:${ids.join(",")}`,
        text: `Mogelijk dubbel: ${ids.map(productName).join(" / ")}`,
        href: `/producten/${ids[0]}/bewerken`,
        label: "mogelijk dubbel ingrediënt",
      });
    for (const d of dishes)
      if (!dishStation.get(d))
        add({
          key: `nostation:${d}`,
          text: `${recipeName(d)}: geen partie`,
          label: "gerecht zonder partie",
        });
    const own = new Map(
      [...recipes.values()].map((r) => [r.id, r.station_id ?? null]),
    );
    for (const hp of sharedWithoutOwnStation(allRows, own))
      if (halfproducts.has(hp))
        add({
          key: `shared:${hp}`,
          text: `${recipeName(hp)}: gedeeld door meerdere parties — kies wie het maakt`,
          href: `/halfproducten/${hp}/bewerken`,
          label: "gedeeld halfproduct zonder partie",
        });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    allRows,
    selected,
    ingredients,
    halfproducts,
    dishes,
    dishStation,
    recipes,
    products,
    articleFor,
  ]);

  const problemCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of problems) m.set(p.label, (m.get(p.label) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [problems]);

  // ---------- acties ----------
  async function setStation(recipeIds: string[], stationId: string | null) {
    setError(null);
    const { error: err } = await createClient().rpc("set_recipe_station", {
      p_recipe_ids: recipeIds,
      p_station_id: stationId,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setNotice(
      recipeIds.length > 1
        ? `${recipeIds.length} recepten ingedeeld.`
        : "Partie opgeslagen.",
    );
    setReload((n) => n + 1);
  }

  async function setLineStation(lineId: string, stationId: string | null) {
    const { error: err } = await createClient().rpc("set_recipe_line_station", {
      p_line_id: lineId,
      p_station_id: stationId,
    });
    if (err) setError(err.message);
    else setReload((n) => n + 1);
  }

  async function setPreferred(productId: string, supplierId: string) {
    const { error: err } = await createClient()
      .from("products")
      .update({ preferred_supplier_id: supplierId || null })
      .eq("id", productId);
    if (err) {
      setError(err.message);
      return;
    }
    setProducts((m) => {
      const n = new Map(m);
      const p = n.get(productId);
      if (p)
        n.set(productId, { ...p, preferred_supplier_id: supplierId || null });
      return n;
    });
  }

  async function setAppCheck(
    productId: string,
    supplierId: string | null,
    status: "ja" | "nee" | "onbekend",
  ) {
    const supabase = createClient();
    let q = supabase
      .from("order_app_checks")
      .select("id")
      .eq("company_id", companyId)
      .eq("product_id", productId);
    q = supplierId
      ? q.eq("supplier_id", supplierId)
      : q.is("supplier_id", null);
    const { data: existing } = await q.maybeSingle();
    const { error: err } = existing
      ? await supabase
          .from("order_app_checks")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
      : await supabase
          .from("order_app_checks")
          .insert({
            company_id: companyId,
            product_id: productId,
            supplier_id: supplierId,
            status,
          });
    if (err) {
      setError(err.message);
      return;
    }
    setAppChecks((m) =>
      new Map(m).set(`${productId}:${supplierId ?? ""}`, status),
    );
  }

  // Partie-voorstellen voor gerechten zonder partie.
  const suggestions = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of dishIds) {
      const r = recipes.get(d);
      if (!r || r.station_id) continue;
      const name = suggestStation(r.name, r.category);
      const st = name ? stations.find((s) => s.name === name) : undefined;
      if (st) m.set(d, st.id);
    }
    return m;
  }, [dishIds, recipes, stations]);

  function toggleStation(key: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  // ---------- weergave helpers ----------
  const cardNames = cards
    .filter((c) => cardIds.includes(c.id))
    .map((c) => c.name)
    .join(" + ");
  const stationLabel =
    selected.size === 0
      ? "Alle parties"
      : [...selected].map(stationName).join(" + ");
  const today = new Date().toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const hasNoStation = allRows.some((r) => !r.station_id);

  const show = (k: ListKind) => list === k || list === "alles";

  const sortedDishes = [...dishes].sort((a, b) =>
    recipeName(a).localeCompare(recipeName(b), "nl"),
  );
  const sortedHps = [...halfproducts.values()].sort((a, b) =>
    sort === "partie"
      ? [...a.stations]
          .map(stationName)
          .join()
          .localeCompare([...b.stations].map(stationName).join(), "nl") ||
        recipeName(a.recipeId).localeCompare(recipeName(b.recipeId), "nl")
      : recipeName(a.recipeId).localeCompare(recipeName(b.recipeId), "nl"),
  );

  const qtyCell = (q: number | null, unit: string, incomplete: boolean) =>
    withQty ? (
      <td className="px-2 py-1 text-right tabular whitespace-nowrap">
        {formatQuantity(q, unit)}
        {incomplete && <span className="text-copper print:text-black"> *</span>}
      </td>
    ) : null;

  const groupHeader = (label: string, cols: number) =>
    sort === "alfabet" ? null : (
      <tr className="kl-group">
        <td
          colSpan={cols}
          className="bg-background px-2 pt-2 pb-0.5 text-xs font-bold uppercase tracking-wide"
        >
          {label}
        </td>
      </tr>
    );

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 print:max-w-none print:p-0">
      {/* -------- 3 keuzes -------- */}
      <div className="space-y-3 rounded-xl border border-border bg-surface p-4 print:hidden">
        <div>
          <p className="mb-1.5 text-sm font-semibold text-foreground">
            1. Menukaart
          </p>
          <div className="flex flex-wrap gap-2">
            {cards.map((c) => {
              const on = cardIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() =>
                    setCardIds((ids) =>
                      on ? ids.filter((x) => x !== c.id) : [...ids, c.id],
                    )
                  }
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm",
                    on
                      ? "border-teal bg-teal/10 font-medium text-teal"
                      : "border-border text-muted hover:text-foreground",
                  )}
                >
                  {on && <Check className="mr-1 inline h-3.5 w-3.5" />}
                  {c.name}
                  {c.status !== "actief" && (
                    <span className="ml-1 text-xs">({c.status})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-foreground">
            2. Partie
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className={cn(
                "rounded-lg border-2 px-4 py-2 text-sm font-medium",
                selected.size === 0
                  ? "border-teal bg-teal/10 text-teal"
                  : "border-border text-foreground",
              )}
            >
              Alle parties
            </button>
            {stations.map((s) => (
              <label
                key={s.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-medium",
                  selected.has(s.id)
                    ? "border-teal bg-teal/10 text-teal"
                    : "border-border text-foreground",
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggleStation(s.id)}
                />
                {s.name}
              </label>
            ))}
            {hasNoStation && (
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed px-4 py-2 text-sm",
                  selected.has(NO_STATION)
                    ? "border-copper bg-copper/10 text-copper"
                    : "border-border text-muted",
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has(NO_STATION)}
                  onChange={() => toggleStation(NO_STATION)}
                />
                Niet ingedeeld
              </label>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="mb-1.5 text-sm font-semibold text-foreground">
              3. Lijst
            </p>
            <select
              value={list}
              onChange={(e) => setList(e.target.value as ListKind)}
              className="input h-11! min-w-56"
            >
              {LISTS.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1.5 text-xs text-muted">Sorteren op</p>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKind)}
              className="input h-11!"
            >
              <option value="partie">Partie</option>
              <option value="leverancier">Leverancier</option>
              <option value="productgroep">Productgroep</option>
              <option value="alfabet">Alfabet</option>
            </select>
          </div>
          <div>
            <p className="mb-1.5 text-xs text-muted">Lijsttype</p>
            <select
              value={withQty ? "qty" : "plain"}
              onChange={(e) => setWithQty(e.target.value === "qty")}
              className="input h-11!"
            >
              <option value="plain">Alleen producten</option>
              <option value="qty">Met berekende hoeveelheden</option>
            </select>
          </div>
          <button
            onClick={() => window.print()}
            disabled={!rows || rows.length === 0}
            className="ml-auto flex h-11 items-center gap-2 rounded-lg bg-teal px-5 font-semibold text-white hover:bg-teal-light disabled:opacity-40"
          >
            <FileDown className="h-5 w-5" /> PDF maken
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger print:hidden">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md bg-teal/10 px-3 py-2 text-sm text-teal print:hidden">
          {notice}
        </p>
      )}

      {/* -------- porties -------- */}
      {withQty && (
        <div className="rounded-xl border border-border bg-surface p-4 print:hidden">
          <p className="mb-1 text-sm font-semibold text-foreground">
            Verwacht aantal porties
          </p>
          <p className="mb-3 text-xs text-muted">
            Alleen gerechten met porties worden berekend, inclusief alle
            halfproducten (via de opbrengst). Bruto hoeveelheden; afronding naar
            verpakkingen alleen als de verpakking bekend is.
          </p>
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {sortedDishes.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm">
                <input
                  type="number"
                  min={0}
                  value={portions[d] ?? ""}
                  onChange={(e) =>
                    setPortions((p) => ({
                      ...p,
                      [d]: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  className="input h-8! w-20! text-right"
                  placeholder="0"
                />
                <span className="truncate">{recipeName(d)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* -------- controle nodig -------- */}
      {rows && problems.length > 0 && (
        <div className="rounded-xl border border-copper/40 bg-copper/5 print:hidden">
          <button
            onClick={() => setShowProblems((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
          >
            <TriangleAlert className="h-4 w-4 text-copper" />
            <span className="font-semibold text-copper">
              Controle nodig ({problems.length})
            </span>
            <span className="truncate text-xs text-muted">
              {problemCounts.map(([l, n]) => `${n}× ${l}`).join(" · ")}
            </span>
            {showProblems ? (
              <ChevronDown className="ml-auto h-4 w-4" />
            ) : (
              <ChevronRight className="ml-auto h-4 w-4" />
            )}
          </button>
          {showProblems && (
            <ul className="max-h-64 overflow-y-auto border-t border-copper/20 px-4 py-2 text-sm">
              {problems.map((p) => (
                <li key={p.key} className="py-0.5">
                  {p.href ? (
                    <Link href={p.href} className="hover:underline">
                      {p.text}
                    </Link>
                  ) : (
                    p.text
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* -------- partie-indeling (niet voor operators: alleen bekijken) -------- */}
      {rows && dishIds.length > 0 && !readOnly && (
        <div className="rounded-xl border border-border bg-surface print:hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <button
              onClick={() => setShowStations((v) => !v)}
              className="flex items-center gap-2 font-semibold text-foreground"
            >
              {showStations ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Partie-indeling gerechten
            </button>
            <span className="text-xs text-muted">
              {dishIds.filter((d) => !dishStation.get(d)).length} zonder partie
              · {suggestions.size} voorstellen
            </span>
            {suggestions.size > 0 && (
              <button
                onClick={async () => {
                  const byStation = new Map<string, string[]>();
                  for (const [d, s] of suggestions)
                    byStation.set(s, [...(byStation.get(s) ?? []), d]);
                  for (const [s, ids] of byStation) await setStation(ids, s);
                }}
                className="ml-auto rounded-md border border-teal px-3 py-1 text-sm text-teal hover:bg-teal/10"
              >
                Alle {suggestions.size} voorstellen bevestigen
              </button>
            )}
          </div>
          {showStations && (
            <div className="border-t border-border">
              <table className="w-full text-sm">
                <tbody>
                  {[...dishIds]
                    .sort(
                      (a, b) =>
                        (recipes.get(a)?.category ?? "").localeCompare(
                          recipes.get(b)?.category ?? "",
                          "nl",
                        ) || recipeName(a).localeCompare(recipeName(b), "nl"),
                    )
                    .map((d) => {
                      const r = recipes.get(d);
                      const sug = suggestions.get(d);
                      const direct = allRows.filter(
                        (x) => x.dish_id === d && x.depth === 0 && x.line_id,
                      );
                      return (
                        <Fragment key={d}>
                          <tr className="border-t border-border">
                            <td className="px-4 py-1.5">
                              <button
                                onClick={() =>
                                  setOpenDish(openDish === d ? null : d)
                                }
                                className="flex items-center gap-1 text-left"
                              >
                                {openDish === d ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                                <span className="font-medium text-foreground">
                                  {r?.name}
                                </span>
                              </button>
                            </td>
                            <td className="px-2 py-1.5 text-xs text-muted">
                              {r?.category}
                            </td>
                            <td className="px-2 py-1.5">
                              <select
                                value={r?.station_id ?? ""}
                                onChange={(e) =>
                                  void setStation([d], e.target.value || null)
                                }
                                disabled={readOnly}
                                className="input h-8! w-44!"
                              >
                                <option value="">— geen —</option>
                                {stations.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-1.5 text-xs">
                              {sug && (
                                <button
                                  onClick={() => void setStation([d], sug)}
                                  className="rounded border border-dashed border-teal px-2 py-0.5 text-teal"
                                >
                                  voorstel: {stationName(sug)} ✓
                                </button>
                              )}
                            </td>
                          </tr>
                          {openDish === d && (
                            <tr>
                              <td
                                colSpan={4}
                                className="bg-background px-8 py-2"
                              >
                                <p className="mb-1 text-xs text-muted">
                                  Onderdelen van dit gerecht. Kies alleen een
                                  andere partie als een andere partie dit
                                  onderdeel maakt (bv. garnituur door
                                  Entremetier).
                                </p>
                                <table className="w-full text-sm">
                                  <tbody>
                                    {direct.map((x) => (
                                      <tr key={x.line_id!}>
                                        <td className="py-0.5 pr-2">
                                          {x.kind === "halfproduct"
                                            ? `${recipeName(x.sub_recipe_id!)} (halfproduct)`
                                            : x.kind === "product"
                                              ? productName(x.product_id!)
                                              : `"${x.unmatched_name}"`}
                                        </td>
                                        <td className="py-0.5 pr-2 text-xs text-muted">
                                          {stationName(x.station_id)}
                                          {x.station_source === "halfproduct" &&
                                            " (eigen partie halfproduct)"}
                                        </td>
                                        <td className="py-0.5">
                                          <select
                                            disabled={readOnly}
                                            value={
                                              x.station_source === "regel"
                                                ? (x.station_id ?? "")
                                                : ""
                                            }
                                            onChange={(e) =>
                                              void setLineStation(
                                                x.line_id!,
                                                e.target.value || null,
                                              )
                                            }
                                            className="input h-7! w-48! text-xs!"
                                          >
                                            <option value="">
                                              zelfde als gerecht
                                            </option>
                                            {stations.map((s) => (
                                              <option key={s.id} value={s.id}>
                                                {s.name}
                                              </option>
                                            ))}
                                          </select>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* -------- voorbeeld / PDF -------- */}
      <div className="kl-print rounded-xl border border-border bg-white p-4 text-black print:rounded-none print:border-0 print:p-0">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-black pb-1">
          <h2 className="text-lg font-bold">
            {LISTS.find((l) => l.key === list)?.label} — {stationLabel}
          </h2>
          <p className="text-xs">
            <strong>{companyName}</strong> · {cardNames || "geen menukaart"} ·{" "}
            {today}
            {withQty && " · met hoeveelheden"}
          </p>
        </div>
        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted print:hidden">
            <RefreshCw className="h-4 w-4 animate-spin" /> Lijst opbouwen…
          </p>
        )}
        {rows && rows.length === 0 && !loading && (
          <p className="text-sm text-muted">
            Geen gerechten gevonden. Kies een menukaart.
          </p>
        )}
        {withQty && rows && (
          <p className="mb-2 text-[10px]">
            * niet volledig berekend — zie Controle nodig.
          </p>
        )}

        {rows && rows.length > 0 && (
          <div className="space-y-5">
            {/* A. Ingrediëntenlijst */}
            {show("ingredienten") && (
              <section>
                {list === "alles" && (
                  <h3 className="kl-h3">
                    Ingrediënten ({ingredientRows.length})
                  </h3>
                )}
                <table className="kl-table">
                  <thead>
                    <tr>
                      <th>Ingrediënt</th>
                      <th>Eenheid</th>
                      {withQty && <th className="text-right">Nodig</th>}
                      <th>Leverancier</th>
                      {sort !== "partie" && <th>Partie</th>}
                      <th className="w-16 text-center">Aanwezig</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ingredientRows.map((x, i) => (
                      <Fragment key={x.agg.productId}>
                        {(i === 0 ||
                          ingredientRows[i - 1].groupKey !== x.groupKey) &&
                          groupHeader(x.groupKey, withQty ? 6 : 5)}
                        <tr>
                          <td>
                            {x.name}
                            <span className="kl-sub">
                              {" "}
                              —{" "}
                              {[...x.agg.halfproducts]
                                .map(recipeName)
                                .slice(0, 3)
                                .join(", ") ||
                                [...x.agg.dishes]
                                  .map(recipeName)
                                  .slice(0, 2)
                                  .join(", ")}
                            </span>
                          </td>
                          <td>{x.unit}</td>
                          {qtyCell(x.agg.quantity, x.unit, x.agg.incomplete)}
                          <td>
                            {x.supplier || "—"}
                            {x.art.others > 0 && (
                              <span className="kl-sub"> (+{x.art.others})</span>
                            )}
                          </td>
                          {sort !== "partie" && <td>{x.station}</td>}
                          <td className="text-center">
                            <Box />
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* B. Bestelapp-lijst */}
            {show("bestelapp") && (
              <section className={cn(list === "alles" && "kl-break")}>
                {list === "alles" && <h3 className="kl-h3">Bestelapp-lijst</h3>}
                <p className="mb-1 text-[10px] print:hidden">
                  Er is geen koppeling met de bestelapp: vink per artikel af of
                  het erin staat. Bij meerdere leveranciers kun je hier de vaste
                  voorkeursleverancier kiezen.
                </p>
                <table className="kl-table">
                  <thead>
                    <tr>
                      <th>Ingrediënt</th>
                      <th>Leverancier</th>
                      <th>Art.nr.</th>
                      <th>Besteleenheid</th>
                      <th>Verpakking</th>
                      {withQty && <th className="text-right">Nodig</th>}
                      <th>Partie</th>
                      <th className="text-center">In bestelapp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ingredientRows.map((x, i) => {
                      const a = x.art.article;
                      const pack = packSizeBase(a);
                      const packs = withQty
                        ? packsNeeded(x.agg.quantity, pack)
                        : null;
                      const key = `${x.agg.productId}:${a?.supplier_id ?? ""}`;
                      const status = appChecks.get(key) ?? "onbekend";
                      const all = articles.get(x.agg.productId) ?? [];
                      const supplierIds = [
                        ...new Set(all.map((s) => s.supplier_id)),
                      ];
                      return (
                        <Fragment key={x.agg.productId}>
                          {(i === 0 ||
                            ingredientRows[i - 1].groupKey !== x.groupKey) &&
                            groupHeader(x.groupKey, withQty ? 8 : 7)}
                          <tr>
                            <td>{x.name}</td>
                            <td>
                              {supplierIds.length > 1 ? (
                                <>
                                  <select
                                    disabled={readOnly}
                                    value={
                                      products.get(x.agg.productId)
                                        ?.preferred_supplier_id ?? ""
                                    }
                                    onChange={(e) =>
                                      void setPreferred(
                                        x.agg.productId,
                                        e.target.value,
                                      )
                                    }
                                    className="h-6 rounded border border-border bg-white text-xs print:hidden"
                                  >
                                    <option value="">
                                      {a?.supplier_name} (geen voorkeur)
                                    </option>
                                    {supplierIds.map((sid) => (
                                      <option key={sid} value={sid}>
                                        {
                                          all.find((s) => s.supplier_id === sid)
                                            ?.supplier_name
                                        }{" "}
                                        ★
                                      </option>
                                    ))}
                                  </select>
                                  <span className="hidden print:inline">
                                    {a?.supplier_name}
                                  </span>
                                </>
                              ) : (
                                (a?.supplier_name ?? "—")
                              )}
                            </td>
                            <td>{a?.supplier_article_code ?? "—"}</td>
                            <td>{a?.packaging_description ?? "—"}</td>
                            <td className="whitespace-nowrap">
                              {pack ? formatQuantity(pack, x.unit) : "onbekend"}
                            </td>
                            {withQty && (
                              <td className="text-right whitespace-nowrap">
                                {formatQuantity(x.agg.quantity, x.unit)}
                                {packs != null && (
                                  <span className="kl-sub"> ≈ {packs}×</span>
                                )}
                              </td>
                            )}
                            <td>{x.station}</td>
                            <td className="text-center whitespace-nowrap">
                              <span className="print:hidden">
                                <select
                                  value={status}
                                  onChange={(e) =>
                                    void setAppCheck(
                                      x.agg.productId,
                                      a?.supplier_id ?? null,
                                      e.target.value as
                                        "ja" | "nee" | "onbekend",
                                    )
                                  }
                                  className={cn(
                                    "h-6 rounded border text-xs",
                                    status === "ja"
                                      ? "border-teal text-teal"
                                      : status === "nee"
                                        ? "border-danger text-danger"
                                        : "border-border",
                                  )}
                                >
                                  <option value="onbekend">onbekend</option>
                                  <option value="ja">ja</option>
                                  <option value="nee">nee</option>
                                </select>
                              </span>
                              <span className="hidden print:inline">
                                {status === "onbekend" ? (
                                  <>
                                    <Box /> ja <Box /> nee
                                  </>
                                ) : (
                                  status
                                )}
                              </span>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            )}

            {/* C. Halfproductenlijst */}
            {show("halfproducten") && (
              <section className={cn(list === "alles" && "kl-break")}>
                {list === "alles" && (
                  <h3 className="kl-h3">Halfproducten ({sortedHps.length})</h3>
                )}
                <table className="kl-table">
                  <thead>
                    <tr>
                      <th>Halfproduct</th>
                      <th>Gebruikt bij</th>
                      <th>Maakt</th>
                      {withQty && <th className="text-right">Nodig</th>}
                      <th className="w-16 text-center">Aanwezig</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHps.map((h) => {
                      const r = recipes.get(h.recipeId);
                      const lines = allRows.filter(
                        (x) => x.recipe_id === h.recipeId,
                      );
                      const uniqueLines = [
                        ...new Map(lines.map((l) => [l.line_id, l])).values(),
                      ];
                      return (
                        <Fragment key={h.recipeId}>
                          <tr>
                            <td>
                              <button
                                onClick={() =>
                                  setOpenHp(
                                    openHp === h.recipeId ? null : h.recipeId,
                                  )
                                }
                                className="text-left font-medium print:font-normal"
                              >
                                <span className="print:hidden">
                                  {openHp === h.recipeId ? "▾ " : "▸ "}
                                </span>
                                {r?.name}
                              </button>
                              {r?.status === "concept" && (
                                <span className="kl-sub"> (concept)</span>
                              )}
                            </td>
                            <td className="kl-sub-cell">
                              {[...h.dishes].map(recipeName).join(", ")}
                            </td>
                            <td className="whitespace-nowrap">
                              <span className="print:hidden">
                                <select
                                  disabled={readOnly}
                                  value={r?.station_id ?? ""}
                                  onChange={(e) =>
                                    void setStation(
                                      [h.recipeId],
                                      e.target.value || null,
                                    )
                                  }
                                  className="h-6 rounded border border-border bg-white text-xs"
                                >
                                  <option value="">
                                    {[...h.stations]
                                      .map(stationName)
                                      .join(", ")}{" "}
                                    (geërfd)
                                  </option>
                                  {stations.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </select>
                              </span>
                              <span className="hidden print:inline">
                                {[...h.stations].map(stationName).join(", ")}
                              </span>
                            </td>
                            {qtyCell(
                              h.quantity,
                              r?.yield_unit ?? "",
                              h.incomplete,
                            )}
                            <td className="text-center">
                              <Box />
                            </td>
                          </tr>
                          {openHp === h.recipeId && (
                            <tr className="print:hidden">
                              <td
                                colSpan={withQty ? 5 : 4}
                                className="bg-background pl-6 text-xs"
                              >
                                {uniqueLines.map((l) => (
                                  <span
                                    key={l.line_id ?? l.recipe_id}
                                    className="mr-3 inline-block"
                                  >
                                    {l.kind === "product"
                                      ? productName(l.product_id!)
                                      : l.kind === "halfproduct"
                                        ? `${recipeName(l.sub_recipe_id!)} (HP)`
                                        : `"${l.unmatched_name}"`}{" "}
                                    <span className="text-muted">
                                      {l.line_quantity ?? ""}{" "}
                                      {l.line_unit ?? ""}
                                    </span>
                                  </span>
                                ))}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            )}

            {/* D. Aanwezigheidslijst */}
            {show("aanwezigheid") && (
              <section className={cn(list === "alles" && "kl-break")}>
                {list === "alles" && (
                  <h3 className="kl-h3">Aanwezigheidslijst</h3>
                )}
                <table className="kl-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Type</th>
                      <th>Partie</th>
                      <th className="w-16 text-center">Aanwezig</th>
                      <th className="w-24 text-center">Bestellen/maken</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupHeader("Halfproducten (zelf maken)", 5)}
                    {sortedHps.map((h) => (
                      <tr key={`h${h.recipeId}`}>
                        <td>{recipeName(h.recipeId)}</td>
                        <td>Halfproduct</td>
                        <td>{[...h.stations].map(stationName).join(", ")}</td>
                        <td className="text-center">
                          <Box />
                        </td>
                        <td className="text-center">
                          <Box />
                        </td>
                      </tr>
                    ))}
                    {groupHeader("Inkoopproducten", 5)}
                    {ingredientRows.map((x) => (
                      <tr key={`p${x.agg.productId}`}>
                        <td>{x.name}</td>
                        <td>Inkoop</td>
                        <td>{x.station}</td>
                        <td className="text-center">
                          <Box />
                        </td>
                        <td className="text-center">
                          <Box />
                        </td>
                      </tr>
                    ))}
                    {groupHeader("Eindproducten (gerechten)", 5)}
                    {sortedDishes.map((d) => (
                      <tr key={`d${d}`}>
                        <td>{recipeName(d)}</td>
                        <td>Gerecht</td>
                        <td>{stationName(dishStation.get(d))}</td>
                        <td className="text-center">
                          <Box />
                        </td>
                        <td className="text-center">
                          <Box />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        )}
      </div>

      <style>{`
        .kl-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .kl-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; border-bottom: 1px solid #000; padding: 2px 6px; }
        .kl-table td { border-bottom: 1px solid #ddd; padding: 2px 6px; vertical-align: top; }
        .kl-sub { color: #666; font-size: 10px; }
        .kl-sub-cell { color: #444; font-size: 10px; }
        .kl-h3 { font-weight: 700; font-size: 14px; margin: 0 0 4px; }
        @media print {
          @page { size: A4; margin: 10mm; }
          body * { visibility: hidden; }
          .kl-print, .kl-print * { visibility: visible; }
          .kl-print { position: absolute; left: 0; top: 0; width: 100%; }
          .kl-table thead { display: table-header-group; }
          .kl-table tr { break-inside: avoid; }
          .kl-table { font-size: 10.5px; }
          .kl-break { break-before: page; }
        }
      `}</style>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, CookingPot, History, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Balk "Recent geopend": de 5 laatst geopende gerechten, halfproducten en
 * ingrediënten van de ingelogde gebruiker (tabel recent_items, per gebruiker
 * via RLS). Items die niet meer bestaan of niet zichtbaar zijn (rechten,
 * bedrijf) vallen er vanzelf uit.
 */

type Kind = "gerecht" | "halfproduct" | "ingredient";
interface RecentItem {
  key: string;
  type: "recipe" | "product";
  id: string;
  name: string;
  kind: Kind;
  href: string;
}

const MAX = 5;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const OPEN_PATTERNS: { re: RegExp; type: "recipe" | "product" }[] = [
  { re: new RegExp(`^/recepturen/(${UUID})(/|$)`, "i"), type: "recipe" },
  { re: new RegExp(`^/halfproducten/(${UUID})(/|$)`, "i"), type: "recipe" },
  { re: new RegExp(`^/producten/(${UUID})(/|$)`, "i"), type: "product" },
];
// Keuken- en inkooppagina's waar de balk zichtbaar is.
const SHOW_ON = [
  "/operator",
  "/recepturen",
  "/halfproducten",
  "/producten",
  "/menukaarten",
  "/menus",
  "/stickers",
  "/keukenlijsten",
  "/afval",
  "/leveranciers",
  "/verkoopproducten",
  "/prijsvergelijking",
  "/voorraad",
  "/partijgerechten",
];

const ICON: Record<Kind, typeof Package> = {
  gerecht: BookOpen,
  halfproduct: CookingPot,
  ingredient: Package,
};
const KIND_LABEL: Record<Kind, string> = {
  gerecht: "Gerecht",
  halfproduct: "Halfproduct",
  ingredient: "Ingrediënt",
};

function openedFrom(
  pathname: string,
): { type: "recipe" | "product"; id: string } | null {
  for (const p of OPEN_PATTERNS) {
    const m = pathname.match(p.re);
    if (m) return { type: p.type, id: m[1].toLowerCase() };
  }
  return null;
}

export function RecentBar() {
  const pathname = usePathname() ?? "";
  const [items, setItems] = useState<RecentItem[]>([]);
  const visible = SHOW_ON.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const opened = openedFrom(pathname);
      if (opened) {
        // Nieuw of opnieuw geopend → vooraan (opened_at = nu).
        await supabase
          .from("recent_items")
          .upsert(
            {
              item_type: opened.type,
              item_id: opened.id,
              opened_at: new Date().toISOString(),
            },
            { onConflict: "user_id,item_type,item_id" },
          );
      }
      if (!visible) return;
      const { data: rows } = await supabase
        .from("recent_items")
        .select("item_type, item_id")
        .order("opened_at", { ascending: false })
        .limit(MAX * 3);
      const list = (rows ?? []) as {
        item_type: "recipe" | "product";
        item_id: string;
      }[];
      const recipeIds = list
        .filter((r) => r.item_type === "recipe")
        .map((r) => r.item_id);
      const productIds = list
        .filter((r) => r.item_type === "product")
        .map((r) => r.item_id);
      const [{ data: recipes }, { data: products }] = await Promise.all([
        recipeIds.length
          ? supabase
              .from("recipes")
              .select("id, name, recipe_kind")
              .in("id", recipeIds)
          : Promise.resolve({
              data: [] as { id: string; name: string; recipe_kind: string }[],
            }),
        productIds.length
          ? supabase
              .from("products")
              .select("id, name, custom_name")
              .in("id", productIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                name: string;
                custom_name: string | null;
              }[],
            }),
      ]);
      const recipeMap = new Map(
        (recipes ?? []).map((r) => [r.id as string, r]),
      );
      const productMap = new Map(
        (products ?? []).map((p) => [p.id as string, p]),
      );
      const result: RecentItem[] = [];
      const gone: { item_type: "recipe" | "product"; item_id: string }[] = [];
      for (const r of list) {
        if (r.item_type === "recipe") {
          const rec = recipeMap.get(r.item_id);
          if (!rec) {
            gone.push(r);
            continue;
          }
          const half = rec.recipe_kind === "halfproduct";
          result.push({
            key: `r:${rec.id}`,
            type: "recipe",
            id: rec.id,
            name: rec.name,
            kind: half ? "halfproduct" : "gerecht",
            href: half
              ? `/halfproducten/${rec.id}/bewerken`
              : `/recepturen/${rec.id}/bewerken`,
          });
        } else {
          const prod = productMap.get(r.item_id);
          if (!prod) {
            gone.push(r);
            continue;
          }
          result.push({
            key: `p:${prod.id}`,
            type: "product",
            id: prod.id,
            name:
              (prod.custom_name as string | null)?.trim() ||
              (prod.name as string),
            kind: "ingredient",
            href: `/producten/${prod.id}/bewerken`,
          });
        }
      }
      if (!cancelled) setItems(result.slice(0, MAX));
      // Opruimen: niet meer bestaand/zichtbaar, en alles voorbij de 5 nieuwste.
      const stale = [
        ...gone,
        ...result.slice(MAX).map((i) => ({ item_type: i.type, item_id: i.id })),
      ];
      for (const s of stale) {
        await supabase
          .from("recent_items")
          .delete()
          .eq("item_type", s.item_type)
          .eq("item_id", s.item_id);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [pathname, visible]);

  if (!visible || items.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-border bg-surface px-4 py-1.5 text-sm print:hidden md:px-6">
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
        <History className="h-3.5 w-3.5" />
        Recent
      </span>
      {items.map((i) => {
        const Icon = ICON[i.kind];
        const current = openedFrom(pathname)?.id === i.id;
        return (
          <Link
            key={i.key}
            href={i.href}
            title={`${KIND_LABEL[i.kind]}: ${i.name}`}
            className={`flex max-w-[14rem] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 ${
              current
                ? "border-teal bg-teal/10 text-teal"
                : "border-border bg-background text-foreground hover:border-teal/50"
            }`}
          >
            <Icon
              className={`h-3.5 w-3.5 shrink-0 ${i.kind === "ingredient" ? "text-muted" : "text-teal"}`}
            />
            <span className="truncate">{i.name}</span>
          </Link>
        );
      })}
    </div>
  );
}

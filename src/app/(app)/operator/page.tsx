"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ClipboardList,
  CookingPot,
  Factory,
  Package,
  Printer,
  Search,
  SprayCan,
  Trash2,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Operator-startscherm: rustig en eenvoudig. Eén zoekveld voor gerechten,
 * halfproducten en ingrediënten (alleen bekijken) en grote knoppen naar
 * stickers, keukenlijsten en de andere keukentaken.
 */

type Kind = "gerecht" | "halfproduct" | "ingredient";
type Filter = "alles" | Kind;
interface Hit {
  id: string;
  name: string;
  kind: Kind;
  sub: string | null;
  href: string;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "alles", label: "Alles" },
  { key: "gerecht", label: "Gerechten" },
  { key: "halfproduct", label: "Halfproducten" },
  { key: "ingredient", label: "Ingrediënten" },
];

const KIND: Record<
  Kind,
  { label: string; icon: typeof Package; className: string }
> = {
  gerecht: {
    label: "Gerecht",
    icon: BookOpen,
    className: "bg-copper/15 text-copper",
  },
  halfproduct: {
    label: "Halfproduct",
    icon: CookingPot,
    className: "bg-teal/15 text-teal",
  },
  ingredient: {
    label: "Ingrediënt",
    icon: Package,
    className: "border border-border text-foreground",
  },
};

function words(term: string): string[] {
  return term
    .toLowerCase()
    .replace(/[%_,()]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
}

function score(name: string, term: string): number {
  const n = name.toLowerCase();
  const t = term.toLowerCase().trim();
  if (!t) return 0;
  if (n === t) return 0;
  if (n.startsWith(t)) return 1;
  if (n.split(/[\s\-/(]+/).some((w) => w.startsWith(t))) return 2;
  return 3;
}

export default function OperatorPage() {
  const { can } = usePermissions();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("alles");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const term = q.trim();
  const browsing = term.length < 2 && filter !== "alles";
  const active = term.length >= 2 || browsing;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setBusy(true);
      const supabase = createClient();
      const ws = words(term.length >= 2 ? term : "");
      const wantRecipes =
        filter === "alles" || filter === "gerecht" || filter === "halfproduct";
      const wantProducts = filter === "alles" || filter === "ingredient";
      const limit = browsing ? 200 : 40;

      let rq = supabase
        .from("recipes")
        .select("id, name, recipe_kind, category")
        .neq("status", "vervallen");
      if (filter === "gerecht" || filter === "halfproduct")
        rq = rq.eq("recipe_kind", filter);
      let pq = supabase
        .from("products")
        .select("id, name, custom_name, product_group")
        .eq("is_active", true)
        .in("item_category", ["food", "onbekend"]);
      let cq = supabase
        .from("products")
        .select("id, name, custom_name, product_group")
        .eq("is_active", true)
        .in("item_category", ["food", "onbekend"]);
      for (const w of ws) {
        rq = rq.ilike("name", `%${w}%`);
        pq = pq.ilike("name", `%${w}%`);
        cq = cq.ilike("custom_name", `%${w}%`);
      }
      const [r, p, c] = await Promise.all([
        wantRecipes
          ? rq.order("name").limit(limit)
          : Promise.resolve({ data: [] }),
        wantProducts
          ? pq.order("name").limit(limit)
          : Promise.resolve({ data: [] }),
        wantProducts && ws.length > 0
          ? cq.order("name").limit(20)
          : Promise.resolve({ data: [] }),
      ]);
      if (cancelled) return;
      const out: Hit[] = [];
      for (const x of (r.data ?? []) as {
        id: string;
        name: string;
        recipe_kind: string;
        category: string | null;
      }[]) {
        const half = x.recipe_kind === "halfproduct";
        out.push({
          id: x.id,
          name: x.name,
          kind: half ? "halfproduct" : "gerecht",
          sub: x.category,
          href: half
            ? `/halfproducten/${x.id}/bewerken`
            : `/recepturen/${x.id}/bewerken`,
        });
      }
      const seen = new Set<string>();
      for (const x of [
        ...((p.data ?? []) as never[]),
        ...((c.data ?? []) as never[]),
      ] as {
        id: string;
        name: string;
        custom_name: string | null;
        product_group: string | null;
      }[]) {
        if (seen.has(x.id)) continue;
        seen.add(x.id);
        out.push({
          id: x.id,
          name: x.custom_name?.trim() || x.name,
          kind: "ingredient",
          sub: x.product_group,
          href: `/producten/${x.id}/bewerken`,
        });
      }
      out.sort(
        (a, b) =>
          score(a.name, term) - score(b.name, term) ||
          a.name.localeCompare(b.name, "nl"),
      );
      setHits(out.slice(0, limit));
      setBusy(false);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, filter, active, browsing]);

  const tiles = [
    {
      href: "/stickers",
      label: "Sticker afdrukken",
      icon: Printer,
      show: can("stickers").canView,
    },
    {
      href: "/keukenlijsten",
      label: "Keukenlijsten",
      icon: ClipboardList,
      show: can("recepturen").canView,
    },
    {
      href: "/voorraad",
      label: "Producties",
      icon: Factory,
      show: can("producties").canView,
    },
    {
      href: "/haccp/vandaag",
      label: "Schoonmaak",
      icon: SprayCan,
      show: can("haccp").canView,
    },
    {
      href: "/afval",
      label: "Afval",
      icon: Trash2,
      show: can("afval").canView,
    },
  ].filter((t) => t.show);

  return (
    <>
      <Topbar title="Keuken" />
      <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-muted" />
            <input
              ref={inputRef}
              type="search"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Zoek gerecht, halfproduct of ingrediënt…"
              className="input h-16! pl-14! text-xl!"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-medium",
                  filter === f.key
                    ? "border-teal bg-teal text-white"
                    : "border-border bg-surface text-foreground hover:border-teal/50",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {active ? (
          <section className="overflow-hidden rounded-lg border border-border bg-surface">
            {busy && hits.length === 0 && (
              <p className="px-4 py-6 text-center text-muted">Zoeken…</p>
            )}
            {!busy && hits.length === 0 && (
              <p className="px-4 py-6 text-center text-muted">
                Niets gevonden.
              </p>
            )}
            <ul className="divide-y divide-border">
              {hits.map((h) => {
                const k = KIND[h.kind];
                return (
                  <li key={`${h.kind}:${h.id}`}>
                    <Link
                      href={h.href}
                      className="flex items-center gap-3 px-4 py-3.5 hover:bg-background"
                    >
                      <k.icon className="h-5 w-5 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-lg font-medium text-foreground">
                          {h.name}
                        </span>
                        {h.sub && (
                          <span className="block truncate text-xs text-muted">
                            {h.sub}
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-3 py-1 text-xs font-medium",
                          k.className,
                        )}
                      >
                        {k.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {tiles.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface p-6 text-center text-lg font-medium text-foreground shadow-sm hover:border-teal hover:bg-teal/5"
              >
                <t.icon className="h-9 w-9 text-teal" />
                {t.label}
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

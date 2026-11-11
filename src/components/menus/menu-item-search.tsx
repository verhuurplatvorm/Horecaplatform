"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export interface MenuItemHit {
  kind: "gerecht" | "halfproduct" | "ingrediënt";
  id: string;
  name: string;
  baseUnitId: string | null;
}

/**
 * Zoeken in bestaande gerechten, halfproducten en ingrediënten.
 * Losse zoekopdrachten per tabel (geen .or() met vrije tekst).
 */
export function MenuItemSearch({
  onPick,
  placeholder = "Zoek gerecht, halfproduct of ingrediënt…",
  autoFocus,
  initial = "",
}: {
  onPick: (hit: MenuItemHit) => void;
  placeholder?: string;
  autoFocus?: boolean;
  initial?: string;
}) {
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<MenuItemHit[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const supabase = createClient();
      const like = `%${term.replace(/[%_]/g, "")}%`;
      const [r, p, pc] = await Promise.all([
        supabase
          .from("recipes")
          .select("id, name, recipe_kind, base_unit_id")
          .ilike("name", like)
          .neq("status", "vervallen")
          .order("name")
          .limit(12),
        supabase
          .from("products")
          .select("id, name, custom_name, base_unit_id")
          .ilike("name", like)
          .eq("is_active", true)
          .order("name")
          .limit(10),
        supabase
          .from("products")
          .select("id, name, custom_name, base_unit_id")
          .ilike("custom_name", like)
          .eq("is_active", true)
          .order("name")
          .limit(6),
      ]);
      if (cancelled) return;
      const seen = new Set<string>();
      const list: MenuItemHit[] = [
        ...(r.data ?? []).map((x) => ({
          kind: (x.recipe_kind === "halfproduct"
            ? "halfproduct"
            : "gerecht") as MenuItemHit["kind"],
          id: x.id as string,
          name: x.name as string,
          baseUnitId: (x.base_unit_id as string | null) ?? null,
        })),
        ...[...(p.data ?? []), ...(pc.data ?? [])].map((x) => ({
          kind: "ingrediënt" as const,
          id: x.id as string,
          name: ((x.custom_name as string | null) || x.name) as string,
          baseUnitId: (x.base_unit_id as string | null) ?? null,
        })),
      ].filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
      setHits(list);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
      <input
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="input h-8! pl-7! text-sm"
      />
      {open && q.trim().length >= 2 && hits.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-64 w-full min-w-72 overflow-y-auto rounded-md border border-border bg-background shadow-lg">
          {hits.map((h) => (
            <button
              key={`${h.kind}:${h.id}`}
              type="button"
              onClick={() => {
                onPick(h);
                setOpen(false);
                setQ("");
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface"
            >
              <span className="truncate">{h.name}</span>
              <span className="shrink-0 text-xs text-muted">{h.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

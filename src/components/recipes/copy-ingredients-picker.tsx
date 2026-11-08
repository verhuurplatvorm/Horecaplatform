"use client";

import { useEffect, useState } from "react";
import { Copy, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Zoek een ander gerecht of halfproduct en kopieer de ingrediënten
 * (bv. Caesar salade kip → Caesar salade gamba's).
 */
export function CopyIngredientsPicker({
  currentId,
  onPick,
  onClose,
}: {
  currentId?: string;
  onPick: (recipeId: string, recipeName: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; recipe_kind: string }[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim().replace(/[%_]/g, "");
    const timer = window.setTimeout(async () => {
      if (q.length < 2) {
        if (!cancelled) setResults([]);
        return;
      }
      const { data } = await createClient()
        .from("recipes")
        .select("id, name, recipe_kind")
        .ilike("name", `%${q}%`)
        .order("name")
        .limit(15);
      if (!cancelled) setResults((data ?? []).filter((r) => r.id !== currentId));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, currentId]);

  return (
    <div className="space-y-2 rounded-md border border-teal/40 bg-teal/5 p-3">
      <div className="flex items-center gap-2">
        <Copy className="h-4 w-4 text-teal" />
        <span className="text-sm font-medium">Ingrediënten kopiëren van ander gerecht of halfproduct</span>
        <button type="button" onClick={onClose} className="ml-auto text-muted hover:text-foreground" aria-label="Sluiten">
          <X className="h-4 w-4" />
        </button>
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Zoek bv. Caesar salade…"
        className="input"
      />
      {results.length > 0 && (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={async () => {
                  setBusyId(r.id);
                  try {
                    await onPick(r.id, r.name);
                  } finally {
                    setBusyId(null);
                  }
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-teal/5 disabled:opacity-50"
              >
                <span>{r.name}</span>
                <span className="text-xs text-muted">
                  {busyId === r.id ? "Kopiëren…" : r.recipe_kind === "halfproduct" ? "halfproduct" : "gerecht"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">
        De regels worden toegevoegd onder de huidige ingrediënten. Pas daarna aan wat anders is (bv. kip → gamba&apos;s).
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { RecipeSuggestion } from "@/app/api/recipes/suggest/route";

/**
 * Onder het naamveld:
 * - toont bestaande halfproducten/gerechten met een gelijkende naam
 *   (voorkomt dubbele stamgegevens);
 * - knop "Recept voorstellen": Claude stelt ingrediënten, opbrengst en
 *   bereiding voor; het formulier koppelt de regels aan echte ingrediënten.
 */
export function RecipeSuggestPanel({
  name,
  kind,
  currentId,
  onApply,
}: {
  name: string;
  kind: "halfproduct" | "gerecht";
  currentId?: string;
  onApply: (s: RecipeSuggestion) => Promise<void> | void;
}) {
  const [similar, setSimilar] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Gelijkende namen zoeken (licht vertraagd tijdens het typen).
  useEffect(() => {
    const words = name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .sort((a, b) => b.length - a.length)
      .slice(0, 2);
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (words.length === 0) {
        if (!cancelled) setSimilar([]);
        return;
      }
      const supabase = createClient();
      // Per woord een aparte zoekopdracht (geen .or() met vrije invoer).
      const results = await Promise.all(
        words.map((w) =>
          supabase
            .from("recipes")
            .select("id, name")
            .eq("recipe_kind", kind)
            .ilike("name", `%${w.replace(/[%_]/g, "")}%`)
            .limit(8)
        )
      );
      if (cancelled) return;
      const seen = new Map<string, string>();
      for (const r of results) for (const row of r.data ?? []) seen.set(row.id, row.name);
      setSimilar(
        [...seen.entries()]
          .filter(([id]) => id !== currentId)
          .map(([id, n]) => ({ id, name: n }))
          .slice(0, 6)
      );
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [name, kind, currentId]);

  async function suggest() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/recipes/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Voorstel mislukt.");
      await onApply(body.suggestion as RecipeSuggestion);
      setNote(
        "Voorstel toegevoegd. Controleer de ingrediënten (oranje = nog kiezen), hoeveelheden en opbrengst vóór je opslaat." +
          (body.suggestion.note ? ` Tip: ${body.suggestion.note}` : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voorstel mislukt.");
    } finally {
      setBusy(false);
    }
  }

  const base = kind === "halfproduct" ? "/halfproducten" : "/recepturen";

  return (
    <div className="space-y-2 sm:col-span-2 lg:col-span-4">
      {similar.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-copper/40 bg-copper/5 px-3 py-2 text-sm">
          <TriangleAlert className="h-4 w-4 shrink-0 text-copper" />
          <span className="text-copper">Bestaat misschien al:</span>
          {similar.map((s) => (
            <Link
              key={s.id}
              href={`${base}/${s.id}/bewerken`}
              target="_blank"
              className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs hover:border-teal hover:text-teal"
            >
              {s.name}
            </Link>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={suggest}
          disabled={busy || name.trim().length < 3}
          className="flex items-center gap-1.5 rounded-md border border-teal/40 bg-teal/5 px-3 py-1.5 text-sm font-medium text-teal hover:bg-teal/10 disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {busy ? "Recept wordt voorgesteld…" : "Recept voorstellen"}
        </button>
        <span className="text-xs text-muted">
          Claude stelt ingrediënten, opbrengst en bereiding voor op basis van de naam.
        </span>
      </div>
      {note && <p className="text-xs text-success">{note}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

interface Revision {
  id: string;
  version: number;
  snapshot: Record<string, unknown>;
  changed_at: string;
  change_note: string | null;
  changed_by: string | null;
}

interface Change {
  field: string;
  from: string;
  to: string;
}

/** Velden waarvan een wijziging de moeite van het tonen waard is. */
const TRACKED: { key: string; label: string }[] = [
  { key: "name", label: "Naam" },
  { key: "yield_quantity", label: "Opbrengst" },
  { key: "waste_percentage", label: "Productieverlies %" },
  { key: "margin_free_costs", label: "Overige kosten" },
  { key: "status", label: "Status" },
  { key: "shelf_life_days", label: "Houdbaarheid (dagen)" },
  { key: "storage_method", label: "Bewaarmethode" },
  { key: "labour_minutes_kitchen", label: "Arbeid keuken (min)" },
  { key: "labour_minutes_other", label: "Overige arbeid (min)" },
];

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "leeg";
  return String(v);
}

/**
 * Historie van dit recept/halfproduct, opgebouwd uit de bestaande
 * recipe_revisions-momentopnames. Elke versie wordt vergeleken met de
 * vorige, zodat je ziet wát er veranderd is in plaats van een blok JSON.
 *
 * Momentopnames worden nooit herschreven: een latere wijziging verandert
 * dus niet met terugwerkende kracht wat er toen gold.
 */
export function RecipeHistory({ recipeId }: { recipeId: string }) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data } = await supabase
        .from("recipe_revisions")
        .select("id, version, snapshot, changed_at, change_note, changed_by")
        .eq("recipe_id", recipeId)
        .order("version", { ascending: false });
      if (cancelled) return;

      const revs = (data as Revision[]) ?? [];
      const ids = [...new Set(revs.map((r) => r.changed_by).filter(Boolean))] as string[];
      if (ids.length) {
        const { data: users } = await supabase
          .from("user_profiles")
          .select("id, full_name")
          .in("id", ids);
        setUserNames(new Map((users ?? []).map((u) => [u.id, u.full_name])));
      }
      setRevisions(revs);
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  /** Verschillen tussen deze versie en de vorige (chronologisch gezien). */
  function diff(index: number): Change[] {
    const current = revisions[index]?.snapshot ?? {};
    const previous = revisions[index + 1]?.snapshot;
    if (!previous) return [];
    const out: Change[] = [];
    for (const f of TRACKED) {
      const a = previous[f.key];
      const b = current[f.key];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        out.push({ field: f.label, from: show(a), to: show(b) });
      }
    }
    // Ingrediëntregels: alleen het aantal vergelijken, de details staan al
    // in de momentopname zelf.
    const aLines = Array.isArray(previous.ingredients) ? previous.ingredients.length : null;
    const bLines = Array.isArray(current.ingredients) ? current.ingredients.length : null;
    if (aLines !== null && bLines !== null && aLines !== bLines) {
      out.push({
        field: "Aantal ingrediëntregels",
        from: String(aLines),
        to: String(bLines),
      });
    }
    return out;
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Versie</th>
                <th className="px-5 py-3 font-medium">Datum/tijd</th>
                <th className="px-5 py-3 font-medium">Door</th>
                <th className="px-5 py-3 font-medium">Wijzigingen</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((r, i) => {
                const changes = diff(i);
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-5 py-3 tabular font-medium">v{r.version}</td>
                    <td className="px-5 py-3 text-muted">
                      {new Date(r.changed_at).toLocaleString("nl-NL")}
                    </td>
                    <td className="px-5 py-3">
                      {r.changed_by ? userNames.get(r.changed_by) ?? "onbekend" : "systeem"}
                    </td>
                    <td className="px-5 py-3">
                      {r.change_note && (
                        <p className="mb-1 text-muted">{r.change_note}</p>
                      )}
                      {changes.length === 0 ? (
                        <span className="text-muted">
                          {i === revisions.length - 1
                            ? "eerste vastgelegde versie"
                            : "geen gevolgde velden gewijzigd"}
                        </span>
                      ) : (
                        <ul className="space-y-0.5">
                          {changes.map((c) => (
                            <li key={c.field}>
                              <span className="text-muted">{c.field}:</span>{" "}
                              <span className="line-through text-muted">{c.from}</span>{" "}
                              → <span className="font-medium">{c.to}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
              {revisions.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted">
                    {loading
                      ? "Historie laden…"
                      : "Nog geen versies vastgelegd voor dit recept."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

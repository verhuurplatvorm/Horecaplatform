"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Ingrediënten van één recept, doorgerekend voor de werklijst:
 * per vorm (schaal/bak), voor een kleinere laatste vorm en in totaal.
 *
 * De factoren komen uit de database (event_line_plan, migratie 0124):
 *   per vorm = recept × per_container
 *   totaal   = recept × recipe_factor
 * Hier wordt alleen vermenigvuldigd, niet opnieuw gerekend.
 */

interface Line {
  id: string;
  name: string;
  href: string | null;
  quantity: number;
  unitKey: string | null;
  unitText: string;
  factorToBase: number | null;
  dimension: string | null;
  preparation: string | null;
  isOptional: boolean;
}

export interface BreakdownColumn {
  label: string;
  factor: number;
}

/** Netjes tonen: 4.500 g wordt 4,5 kg, 1.200 ml wordt 1,2 l. */
export function formatAmount(
  qty: number,
  unitKey: string | null,
  factorToBase: number | null,
  dimension: string | null,
  unitText: string,
): string {
  const nl = (n: number, d: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: d });
  if (!unitKey || factorToBase == null) return `${nl(qty, 2)} ${unitText}`.trim();
  const base = qty * factorToBase;
  if (dimension === "gewicht") {
    return base >= 1000 ? `${nl(base / 1000, 2)} kg` : `${nl(base, base < 10 ? 1 : 0)} g`;
  }
  if (dimension === "inhoud") {
    return base >= 1000 ? `${nl(base / 1000, 2)} l` : `${nl(base, base < 10 ? 1 : 0)} ml`;
  }
  return `${nl(base, 1)} ${unitKey}`;
}

export function RecipeBreakdown({
  recipeId,
  columns,
  note,
}: {
  recipeId: string;
  columns: BreakdownColumn[];
  note?: string | null;
}) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [recipe, setRecipe] = useState<{ kind: string; preparation: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const [{ data: r }, { data: ings }, { data: units }] = await Promise.all([
        supabase.from("recipes").select("recipe_kind, preparation").eq("id", recipeId).maybeSingle(),
        supabase
          .from("recipe_ingredients")
          .select(
            "id, product_id, sub_recipe_id, unmatched_name, quantity, unit, unit_id, is_optional, preparation, sort_order",
          )
          .eq("recipe_id", recipeId)
          .order("sort_order"),
        supabase.from("units").select("id, key, factor_to_base, dimension"),
      ]);
      const rows = ings ?? [];
      const productIds = rows.map((i) => i.product_id).filter((x): x is string => !!x);
      const subIds = rows.map((i) => i.sub_recipe_id).filter((x): x is string => !!x);
      const [{ data: prods }, { data: subs }] = await Promise.all([
        productIds.length
          ? supabase.from("products").select("id, name, custom_name").in("id", productIds)
          : Promise.resolve({ data: [] as { id: string; name: string; custom_name: string | null }[] }),
        subIds.length
          ? supabase.from("recipes").select("id, name, recipe_kind").in("id", subIds)
          : Promise.resolve({ data: [] as { id: string; name: string; recipe_kind: string }[] }),
      ]);
      const unitById = new Map((units ?? []).map((u) => [u.id, u]));
      const prodById = new Map((prods ?? []).map((p) => [p.id, p]));
      const subById = new Map((subs ?? []).map((s) => [s.id, s]));

      const out: Line[] = rows.map((i) => {
        const u = i.unit_id ? unitById.get(i.unit_id) : undefined;
        let name = i.unmatched_name ?? "onbekend ingrediënt";
        let href: string | null = null;
        if (i.product_id) {
          const p = prodById.get(i.product_id);
          name = p?.custom_name?.trim() || p?.name || name;
          href = `/producten/${i.product_id}/bewerken`;
        } else if (i.sub_recipe_id) {
          const s = subById.get(i.sub_recipe_id);
          name = s?.name ?? name;
          href =
            s?.recipe_kind === "halfproduct"
              ? `/halfproducten/${i.sub_recipe_id}/bewerken`
              : `/recepturen/${i.sub_recipe_id}/bewerken`;
        }
        return {
          id: i.id,
          name,
          href,
          quantity: Number(i.quantity),
          unitKey: u?.key ?? null,
          unitText: i.unit ?? "",
          factorToBase: u ? Number(u.factor_to_base) : null,
          dimension: u?.dimension ?? null,
          preparation: i.preparation,
          isOptional: i.is_optional,
        };
      });
      if (!cancelled) {
        setLines(out);
        setRecipe(r ? { kind: r.recipe_kind, preparation: r.preparation } : null);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  const recipeHref =
    recipe?.kind === "halfproduct"
      ? `/halfproducten/${recipeId}/bewerken`
      : `/recepturen/${recipeId}/bewerken`;

  return (
    <div className="mt-2 rounded-md border border-border bg-background">
      {lines === null ? (
        <p className="px-3 py-3 text-sm text-muted">Ingrediënten laden…</p>
      ) : lines.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted">Dit recept heeft geen ingrediënten.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-medium">Ingrediënt</th>
                {columns.map((c) => (
                  <th key={c.label} className="px-3 py-2 text-right font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-1.5">
                    {l.href ? (
                      <Link href={l.href} className="hover:underline">
                        {l.name}
                      </Link>
                    ) : (
                      l.name
                    )}
                    {l.preparation && <span className="ml-1 text-xs text-muted">({l.preparation})</span>}
                    {l.isOptional && <span className="ml-1 text-xs text-muted">optioneel</span>}
                  </td>
                  {columns.map((c, idx) => (
                    <td
                      key={c.label}
                      className={
                        "tabular whitespace-nowrap px-3 py-1.5 text-right" +
                        (idx === columns.length - 1 ? " font-medium" : "")
                      }
                    >
                      {formatAmount(l.quantity * c.factor, l.unitKey, l.factorToBase, l.dimension, l.unitText)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(note || recipe?.preparation) && (
        <div className="space-y-1 border-t border-border px-3 py-2 text-xs text-muted">
          {note && <p>{note}</p>}
          {recipe?.preparation && (
            <p className="whitespace-pre-line">
              <span className="font-medium text-foreground">Bereiding: </span>
              {recipe.preparation}
            </p>
          )}
        </div>
      )}
      <div className="border-t border-border px-3 py-2 print:hidden">
        <Link href={recipeHref} className="inline-flex items-center gap-1 text-sm text-teal hover:underline">
          <ExternalLink className="h-3.5 w-3.5" />
          Recept openen
        </Link>
      </div>
    </div>
  );
}

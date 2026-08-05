"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

interface UsageRow {
  recipeId: string;
  recipeName: string;
  recipeKind: "gerecht" | "halfproduct";
  quantity: number;
  unitName: string | null;
  status: string;
}

export function UsedInOverview({ recipeId }: { recipeId: string }) {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data } = await supabase
        .from("recipe_ingredients")
        .select("quantity, unit_id, recipes!recipe_ingredients_recipe_id_fkey(id, name, recipe_kind, status)")
        .eq("sub_recipe_id", recipeId);

      if (cancelled) return;

      const unitIds = [...new Set((data ?? []).map((r) => r.unit_id).filter(Boolean))] as string[];
      const { data: units } = unitIds.length
        ? await supabase.from("units").select("id, name").in("id", unitIds)
        : { data: [] };
      const unitNameById = new Map((units ?? []).map((u) => [u.id, u.name]));

      const usage: UsageRow[] = (data ?? [])
        .filter((r) => r.recipes)
        .map((r) => ({
          // @ts-expect-error -- geneste relatie
          recipeId: r.recipes.id,
          // @ts-expect-error -- geneste relatie
          recipeName: r.recipes.name,
          // @ts-expect-error -- geneste relatie
          recipeKind: r.recipes.recipe_kind,
          // @ts-expect-error -- geneste relatie
          status: r.recipes.status,
          quantity: r.quantity,
          unitName: r.unit_id ? unitNameById.get(r.unit_id) ?? null : null,
        }));

      setRows(usage);
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gebruikt in</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Naam</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Gebruikte hoeveelheid</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-5 py-3 font-medium">
                  <Link
                    href={
                      r.recipeKind === "gerecht"
                        ? `/recepturen/${r.recipeId}/bewerken`
                        : `/halfproducten/${r.recipeId}/bewerken`
                    }
                    className="hover:text-teal hover:underline"
                  >
                    {r.recipeName}
                  </Link>
                </td>
                <td className="px-5 py-3 text-muted">
                  {r.recipeKind === "gerecht" ? "Gerecht" : "Halfproduct"}
                </td>
                <td className="px-5 py-3 tabular">
                  {r.quantity} {r.unitName ?? ""}
                </td>
                <td className="px-5 py-3 text-muted">{r.status}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-muted">
                  Dit halfproduct wordt nog nergens als ingrediënt gebruikt.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

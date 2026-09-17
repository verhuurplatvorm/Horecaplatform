"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";

interface UsageRow {
  recipeId: string;
  recipeName: string;
  kind: "gerecht" | "halfproduct";
  quantity: number;
  unitName: string | null;
  lineCost: number | null;
  recipeCost: number | null;
  category: string | null;
}

/**
 * Waar wordt dit ingrediënt gebruikt? Toont per recept/halfproduct de
 * gebruikte hoeveelheid en — voor wie de rechten heeft — wat die regel
 * bijdraagt aan de kostprijs van dat recept. De kostprijs komt uit
 * dezelfde centrale functies als de rest van het platform, dus de
 * bedragen kloppen met wat je op het recept zelf ziet.
 */
export function ProductUsageTab({ productId }: { productId: string }) {
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const { can } = usePermissions();
  const canViewFinancial = can("producten").canViewFinancial;

  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data: lines } = await supabase
        .from("recipe_ingredients")
        .select("recipe_id, quantity, unit_id")
        .eq("product_id", productId);

      if (!lines || lines.length === 0) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }

      const recipeIds = [...new Set(lines.map((l) => l.recipe_id))];
      const [{ data: recipes }, { data: units }] = await Promise.all([
        supabase
          .from("recipes")
          .select("id, name, recipe_kind, category")
          .in("id", recipeIds),
        supabase.from("units").select("id, name"),
      ]);
      const recipeById = new Map((recipes ?? []).map((r) => [r.id, r]));
      const unitById = new Map((units ?? []).map((u) => [u.id, u.name]));

      const out: UsageRow[] = [];
      for (const line of lines) {
        const r = recipeById.get(line.recipe_id);
        if (!r) continue;

        let lineCost: number | null = null;
        let recipeCost: number | null = null;
        if (canViewFinancial && referenceCompanyId) {
          const [{ data: breakdown }, { data: total }] = await Promise.all([
            supabase.rpc("get_recipe_cost_breakdown", {
              p_recipe_id: line.recipe_id,
              p_company_id: referenceCompanyId,
            }),
            supabase.rpc("calculate_recipe_cost", {
              p_recipe_id: line.recipe_id,
              p_company_id: referenceCompanyId,
            }),
          ]);
          recipeCost = (total as number | null) ?? null;
          const match = (breakdown as { product_id: string | null; line_cost: number | null }[] | null)
            ?.find((b) => b.product_id === productId);
          lineCost = match?.line_cost ?? null;
        }

        out.push({
          recipeId: r.id,
          recipeName: r.name,
          kind: r.recipe_kind as "gerecht" | "halfproduct",
          quantity: line.quantity,
          unitName: line.unit_id ? unitById.get(line.unit_id) ?? null : null,
          lineCost,
          recipeCost,
          category: r.category,
        });
      }

      if (!cancelled) {
        setRows(out.sort((a, b) => a.recipeName.localeCompare(b.recipeName, "nl")));
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [productId, referenceCompanyId, canViewFinancial]);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Recept / halfproduct</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Map</th>
                <th className="px-5 py-3 font-medium">Gebruikte hoeveelheid</th>
                {canViewFinancial && (
                  <>
                    <th className="px-5 py-3 font-medium">Kostprijsbijdrage</th>
                    <th className="px-5 py-3 font-medium">Aandeel in recept</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const share =
                  r.lineCost !== null && r.recipeCost && r.recipeCost > 0
                    ? (r.lineCost / r.recipeCost) * 100
                    : null;
                const href =
                  r.kind === "halfproduct"
                    ? `/halfproducten/${r.recipeId}/bewerken`
                    : `/recepturen/${r.recipeId}/bewerken`;
                return (
                  <tr key={`${r.recipeId}-${i}`} className="border-t border-border">
                    <td className="px-5 py-3 font-medium">
                      <Link href={href} className="hover:text-teal hover:underline">
                        {r.recipeName}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {r.kind === "halfproduct" ? "Halfproduct" : "Gerecht"}
                    </td>
                    <td className="px-5 py-3 text-muted">{r.category ?? "—"}</td>
                    <td className="px-5 py-3 tabular">
                      {r.quantity} {r.unitName ?? ""}
                    </td>
                    {canViewFinancial && (
                      <>
                        <td className="px-5 py-3 tabular">
                          {r.lineCost !== null ? `€ ${r.lineCost.toFixed(4)}` : "—"}
                        </td>
                        <td className="px-5 py-3 tabular text-muted">
                          {share !== null ? `${share.toFixed(1)}%` : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={canViewFinancial ? 6 : 4} className="px-5 py-8 text-center text-muted">
                    {loading
                      ? "Gebruik opzoeken…"
                      : "Dit ingrediënt wordt nog niet in een recept of halfproduct gebruikt."}
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

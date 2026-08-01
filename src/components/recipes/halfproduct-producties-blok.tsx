"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import type { ProductionLabel, StockMovement } from "@/lib/types/database";

interface ProductionRow {
  movement: StockMovement;
  cost: number | null;
  producedBy: string | null;
}

export function ProductiesBlok({
  recipeId,
  unitName,
}: {
  recipeId: string;
  unitName: string | null;
}) {
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const [rows, setRows] = useState<ProductionRow[]>([]);
  const [loading, setLoading] = useState(() => Boolean(referenceCompanyId));

  useEffect(() => {
    if (!referenceCompanyId) {
      return;
    }
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data: movements } = await supabase
        .from("stock_movements")
        .select("*")
        .eq("recipe_id", recipeId)
        .eq("company_id", referenceCompanyId as string)
        .eq("movement_type", "productie")
        .order("created_at", { ascending: false })
        .limit(5);
      if (cancelled || !movements || movements.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const movementIds = movements.map((m) => m.id);
      const [{ data: labels }, { data: userProfiles }] = await Promise.all([
        supabase
          .from("production_labels")
          .select("*")
          .in("stock_movement_id", movementIds)
          .order("printed_at", { ascending: false }),
        supabase.from("user_profiles").select("id, full_name"),
      ]);
      const latestLabelByMovement = new Map<string, ProductionLabel>();
      for (const l of (labels as ProductionLabel[]) ?? []) {
        if (!latestLabelByMovement.has(l.stock_movement_id)) {
          latestLabelByMovement.set(l.stock_movement_id, l);
        }
      }
      const userNameById = new Map((userProfiles ?? []).map((u) => [u.id, u.full_name]));

      const result = await Promise.all(
        (movements as StockMovement[]).map(async (m) => {
          const asofDate = m.created_at.slice(0, 10);
          const { data: costAsof } = await supabase.rpc("calculate_recipe_cost_asof", {
            p_recipe_id: recipeId,
            p_company_id: referenceCompanyId as string,
            p_asof_date: asofDate,
          });
          const label = latestLabelByMovement.get(m.id);
          const producedByNames = label
            ? [
                ...(label.produced_by_user_ids ?? []).map(
                  (id: string) => userNameById.get(id) ?? null
                ),
                ...(label.produced_by_manual_names ?? []),
              ].filter(Boolean)
            : [];
          return {
            movement: m,
            cost: costAsof !== null && costAsof !== undefined ? costAsof : null,
            producedBy: producedByNames.length > 0 ? producedByNames.join(", ") : null,
          };
        })
      );

      if (!cancelled) {
        setRows(result);
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [recipeId, referenceCompanyId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Producties</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Productiedatum</th>
              <th className="px-5 py-3 font-medium">Hoeveelheid</th>
              <th className="px-5 py-3 font-medium">Kostprijs</th>
              <th className="px-5 py-3 font-medium">Medewerker</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ movement, cost, producedBy }) => (
              <tr key={movement.id} className="border-t border-border">
                <td className="px-5 py-3">
                  {new Date(movement.created_at).toLocaleString("nl-NL")}
                </td>
                <td className="px-5 py-3 tabular">
                  {movement.quantity_change} {unitName ?? ""}
                </td>
                <td className="px-5 py-3 tabular text-muted">
                  {cost !== null ? `€ ${cost.toFixed(2)}` : "—"}
                </td>
                <td className="px-5 py-3 text-muted">{producedBy ?? "—"}</td>
                <td className="px-5 py-3">
                  <Link href={`/halfproducten/${recipeId}/sticker/nieuw?movementId=${movement.id}`}>
                    <Button size="sm" variant="secondary">
                      <Printer className="h-3.5 w-3.5" />
                      Sticker opnieuw afdrukken
                    </Button>
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-muted">
                  {referenceCompanyId
                    ? "Nog geen producties geregistreerd."
                    : "Selecteer een bedrijf via de bedrijfsselector rechtsboven."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function ProductieWidget({
  recipeId,
  standardYield,
  unitName,
}: {
  recipeId: string;
  standardYield: number | null;
  unitName: string | null;
}) {
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const [quantity, setQuantity] = useState(standardYield?.toString() ?? "");
  const [baseCost, setBaseCost] = useState<number | null>(null);

  useEffect(() => {
    if (!referenceCompanyId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .rpc("calculate_recipe_cost", { p_recipe_id: recipeId, p_company_id: referenceCompanyId })
      .then(({ data }) => {
        if (!cancelled) setBaseCost(data ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [recipeId, referenceCompanyId]);

  const scale =
    standardYield && Number(quantity) > 0 ? Number(quantity) / standardYield : 1;
  const scaledCost = baseCost !== null ? baseCost * scale : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Productie starten</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">
          Standaard {standardYield ?? "—"} {unitName ?? ""}. Pas de hoeveelheid aan om
          evenredig te herberekenen.
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-foreground">
              Te produceren hoeveelheid ({unitName ?? "eenheid"})
            </label>
            <input
              type="number"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="input"
            />
          </div>
          <div className="pb-2 text-sm text-muted">
            {scaledCost !== null ? (
              <>
                Kostprijs: <span className="font-medium text-foreground">€ {scaledCost.toFixed(2)}</span>
                {scale !== 1 && ` (×${scale.toFixed(2)})`}
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
        <Link href={`/halfproducten/${recipeId}/sticker/nieuw?quantity=${quantity}`}>
          <Button type="button" disabled={!Number(quantity)}>
            <Printer className="h-4 w-4" />
            Registreren & sticker afdrukken
          </Button>
        </Link>
      </CardContent>

      <style jsx>{`
        .input {
          display: block;
          width: 100%;
          height: 2.5rem;
          border-radius: 0.375rem;
          border: 1px solid var(--border);
          background: var(--surface);
          padding: 0 0.75rem;
          font-size: 0.875rem;
        }
      `}</style>
    </Card>
  );
}

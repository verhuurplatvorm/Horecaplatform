"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Printer, TriangleAlert } from "lucide-react";
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

interface BreakdownLine {
  sort_order: number;
  ingredient_name: string | null;
  quantity: number;
  unit_name: string | null;
  line_cost: number | null;
}

/**
 * Het volledige "Productie"-onderdeel van de halfproduct-pagina:
 * schaalbaar receptoverzicht bovenaan, productiegeschiedenis in het
 * midden, en de invoer om een nieuwe productie te starten onderaan. Eén
 * component omdat het receptoverzicht en de invoer dezelfde
 * (schaal)hoeveelheid delen.
 */
export function HalfproductProductieSectie({
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
  const [producedBy, setProducedBy] = useState("");
  const [breakdown, setBreakdown] = useState<BreakdownLine[]>([]);
  const [productionRows, setProductionRows] = useState<ProductionRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(() => Boolean(referenceCompanyId));

  const scale = standardYield && Number(quantity) > 0 ? Number(quantity) / standardYield : 1;

  // Kostprijs per ingrediëntregel (ongeschaald — de weergave schaalt zelf).
  useEffect(() => {
    if (!referenceCompanyId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .rpc("get_recipe_cost_breakdown", {
        p_recipe_id: recipeId,
        p_company_id: referenceCompanyId,
      })
      .then(({ data }) => {
        if (!cancelled) setBreakdown((data as BreakdownLine[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [recipeId, referenceCompanyId]);

  // Productiegeschiedenis.
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
        setProductionRows([]);
        setLoadingHistory(false);
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
          let cost = m.cost_at_production;
          if (cost === null || cost === undefined) {
            const asofDate = m.created_at.slice(0, 10);
            const { data: costAsof } = await supabase.rpc("calculate_recipe_cost_asof", {
              p_recipe_id: recipeId,
              p_company_id: referenceCompanyId as string,
              p_asof_date: asofDate,
            });
            cost = costAsof ?? null;
          }
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
            cost,
            producedBy:
              m.produced_by ??
              (producedByNames.length > 0 ? producedByNames.join(", ") : null),
          };
        })
      );

      if (!cancelled) {
        setProductionRows(result);
        setLoadingHistory(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [recipeId, referenceCompanyId]);

  const totalScaledCost = useMemo(
    () => breakdown.reduce((sum, l) => sum + (l.line_cost ?? 0) * scale, 0),
    [breakdown, scale]
  );

  const stickerHref = `/halfproducten/${recipeId}/sticker/nieuw?quantity=${quantity}&producedBy=${encodeURIComponent(
    producedBy
  )}`;

  return (
    <div className="space-y-4">
      {/* Receptoverzicht — bovenaan, schaalt automatisch mee met de
          productiehoeveelheid hieronder. */}
      <Card>
        <CardHeader>
          <CardTitle>Receptoverzicht</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Ingrediënt</th>
                <th className="px-5 py-3 font-medium">Hoeveelheid</th>
                <th className="px-5 py-3 font-medium">Eenheid</th>
                <th className="px-5 py-3 font-medium">Kostprijs</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((line) => (
                <tr key={line.sort_order} className="border-t border-border">
                  <td className="px-5 py-3 font-medium">{line.ingredient_name ?? "—"}</td>
                  <td className="px-5 py-3 tabular">
                    {(line.quantity * scale).toLocaleString("nl-NL", { maximumFractionDigits: 3 })}
                  </td>
                  <td className="px-5 py-3 text-muted">{line.unit_name ?? "—"}</td>
                  <td className="px-5 py-3 tabular text-muted">
                    {line.line_cost !== null ? `€ ${(line.line_cost * scale).toFixed(4)}` : "—"}
                  </td>
                </tr>
              ))}
              {breakdown.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-center text-muted">
                    {referenceCompanyId
                      ? "Nog geen ingrediënten toegevoegd."
                      : "Selecteer een bedrijf via de bedrijfsselector rechtsboven."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {breakdown.length > 0 && (
            <div className="flex justify-end border-t border-border px-5 py-3 text-sm">
              <span className="text-muted">Totale receptkostprijs:&nbsp;</span>
              <span className="font-semibold text-foreground">€ {totalScaledCost.toFixed(2)}</span>
              {scale !== 1 && <span className="ml-1 text-muted">(×{scale.toFixed(2)})</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Productiegeschiedenis */}
      <Card>
        <CardHeader>
          <CardTitle>Producties</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Batchnummer</th>
                <th className="px-5 py-3 font-medium">Productiedatum</th>
                <th className="px-5 py-3 font-medium">Hoeveelheid</th>
                <th className="px-5 py-3 font-medium">Kostprijs</th>
                <th className="px-5 py-3 font-medium">Producent</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {productionRows.map(({ movement, cost, producedBy: rowProducedBy }) => (
                <tr key={movement.id} className="border-t border-border">
                  <td className="px-5 py-3 font-mono text-xs">{movement.batch_number ?? "—"}</td>
                  <td className="px-5 py-3">
                    {new Date(movement.created_at).toLocaleString("nl-NL")}
                  </td>
                  <td className="px-5 py-3 tabular">
                    {movement.quantity_change} {unitName ?? ""}
                  </td>
                  <td className="px-5 py-3 tabular text-muted">
                    {cost !== null ? `€ ${cost.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-5 py-3 text-muted">{rowProducedBy ?? "—"}</td>
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
              {productionRows.length === 0 && !loadingHistory && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-muted">
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

      {/* Productie starten — onderaan dit blok. */}
      <Card>
        <CardHeader>
          <CardTitle>Productie starten</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted">
            Standaard {standardYield ?? "—"} {unitName ?? ""}. Pas de hoeveelheid aan om het
            receptoverzicht hierboven evenredig te herberekenen.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
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
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                Naam producent <span className="text-danger">*</span>
              </label>
              <input
                required
                value={producedBy}
                onChange={(e) => setProducedBy(e.target.value)}
                className="input"
              />
            </div>
            <div className="flex items-end pb-2 text-sm text-muted">
              Kostprijs: <span className="ml-1 font-medium text-foreground">€ {totalScaledCost.toFixed(2)}</span>
            </div>
          </div>
          {!producedBy.trim() && (
            <p className="flex items-center gap-1 text-xs text-copper">
              <TriangleAlert className="h-3.5 w-3.5" />
              Naam producent is verplicht voordat je kunt registreren.
            </p>
          )}
          <Link href={stickerHref}>
            <Button type="button" disabled={!Number(quantity) || !producedBy.trim()}>
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
    </div>
  );
}

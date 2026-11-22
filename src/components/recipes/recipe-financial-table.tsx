"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface BreakdownRow {
  sort_order: number;
  ingredient_name: string | null;
  quantity: number;
  unit_name: string | null;
  line_cost: number | null;
  quantity_in_recipe_unit: number | null;
  conversion_missing: boolean | null;
  product_id: string | null;
  conversion_note: string | null;
  applied_loss_pct: number | null;
}

interface Extra {
  articleNumber: string | null;
  supplierName: string | null;
  pricePerBaseUnit: number | null;
  baseUnitName: string | null;
  previousPrice: number | null;
  currentPrice: number | null;
}

/**
 * Financieel overzicht van een recept/halfproduct: per regel wat het
 * kost en hoe zwaar het meeweegt, met daaronder de opbouw naar de
 * kostprijs per basiseenheid.
 *
 * Alle bedragen komen uit get_recipe_cost_breakdown en
 * calculate_recipe_cost — dezelfde centrale functies als de rest van het
 * platform, inclusief de stuk-conversie en netto bruikbaar gewicht. Hier
 * wordt dus niets opnieuw uitgerekend.
 */
export function RecipeFinancialTable({
  recipeId,
  yieldQuantity,
  baseUnitName,
  wastePercentage,
  marginFreeCosts,
  labourCost,
}: {
  recipeId: string;
  yieldQuantity: number | null;
  baseUnitName: string | null;
  wastePercentage: number | null;
  marginFreeCosts: number | null;
  labourCost: number;
}) {
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;

  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [extras, setExtras] = useState<Map<string, Extra>>(new Map());
  const [totalCost, setTotalCost] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!referenceCompanyId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const [{ data: breakdown }, { data: total }] = await Promise.all([
        supabase.rpc("get_recipe_cost_breakdown", {
          p_recipe_id: recipeId,
          p_company_id: referenceCompanyId,
        }),
        supabase.rpc("calculate_recipe_cost", {
          p_recipe_id: recipeId,
          p_company_id: referenceCompanyId,
        }),
      ]);
      if (cancelled) return;

      const list = (breakdown as BreakdownRow[]) ?? [];
      setRows(list);
      setTotalCost((total as number | null) ?? null);

      // Artikelnummer, leverancier, huidige prijs en vorige prijs per
      // ingrediënt erbij halen voor de kolommen die niet uit de
      // kostprijsfunctie komen.
      const productIds = list.map((r) => r.product_id).filter(Boolean) as string[];
      if (productIds.length) {
        const [{ data: products }, { data: prices }, { data: history }] = await Promise.all([
          supabase
            .from("products")
            .select("id, article_number, base_unit_id")
            .in("id", productIds),
          supabase
            .from("supplier_products")
            .select("product_id, price_per_base_unit, purchase_price, suppliers(name)")
            .in("product_id", productIds)
            .is("valid_to", null),
          supabase
            .from("price_change_history")
            .select("product_id, old_purchase_price, new_purchase_price, valid_from")
            .in("product_id", productIds)
            .not("old_purchase_price", "is", null)
            .order("valid_from", { ascending: false }),
        ]);

        const unitIds = [
          ...new Set((products ?? []).map((p) => p.base_unit_id).filter(Boolean)),
        ] as string[];
        const { data: units } = unitIds.length
          ? await supabase.from("units").select("id, name").in("id", unitIds)
          : { data: [] };
        const unitName = new Map((units ?? []).map((u) => [u.id, u.name]));

        const map = new Map<string, Extra>();
        for (const p of products ?? []) {
          map.set(p.id, {
            articleNumber: p.article_number,
            supplierName: null,
            pricePerBaseUnit: null,
            baseUnitName: p.base_unit_id ? unitName.get(p.base_unit_id) ?? null : null,
            previousPrice: null,
            currentPrice: null,
          });
        }
        for (const pr of prices ?? []) {
          const e = map.get(pr.product_id);
          if (!e) continue;
          e.pricePerBaseUnit = pr.price_per_base_unit;
          e.currentPrice = pr.purchase_price;
          // @ts-expect-error -- suppliers komt als geneste relatie terug
          e.supplierName = pr.suppliers?.name ?? null;
        }
        for (const h of history ?? []) {
          const e = map.get(h.product_id);
          if (e && e.previousPrice === null) e.previousPrice = h.old_purchase_price;
        }
        if (!cancelled) setExtras(map);
      }
      if (!cancelled) setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [recipeId, referenceCompanyId]);

  const ingredientCost = rows.reduce((sum, r) => sum + (r.line_cost ?? 0), 0);
  const wasteAmount = ingredientCost * ((wastePercentage ?? 0) / 100);
  const productionCost = (totalCost ?? ingredientCost) + labourCost;
  const costPerUnit =
    yieldQuantity && yieldQuantity > 0 ? productionCost / yieldQuantity : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Kostprijs per ingrediënt</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Ingrediënt</th>
                  <th className="px-3 py-2 font-medium">Artikelnr.</th>
                  <th className="px-3 py-2 font-medium">Leverancier</th>
                  <th className="px-3 py-2 font-medium">Hoeveelheid</th>
                  <th className="px-3 py-2 font-medium">Omgerekend</th>
                  <th className="px-3 py-2 font-medium">Verlies %</th>
                  <th className="px-3 py-2 font-medium">Prijs/eenheid</th>
                  <th className="px-3 py-2 font-medium">Kostprijs</th>
                  <th className="px-3 py-2 font-medium">Aandeel</th>
                  <th className="px-3 py-2 font-medium">Prijswijziging</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const e = r.product_id ? extras.get(r.product_id) : undefined;
                  const share =
                    r.line_cost !== null && ingredientCost > 0
                      ? (r.line_cost / ingredientCost) * 100
                      : null;
                  const delta =
                    e?.currentPrice != null && e?.previousPrice != null && e.previousPrice > 0
                      ? ((e.currentPrice - e.previousPrice) / e.previousPrice) * 100
                      : null;
                  return (
                    <tr key={`${r.sort_order}-${i}`} className="border-t border-border">
                      <td className="px-3 py-2 tabular text-muted">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">
                        {r.ingredient_name ?? "—"}
                        {r.conversion_note && (
                          <span className="ml-1 text-xs font-normal text-teal">
                            ({r.conversion_note})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted">{e?.articleNumber ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">{e?.supplierName ?? "—"}</td>
                      <td className="px-3 py-2 tabular">
                        {r.quantity} {r.unit_name ?? ""}
                      </td>
                      <td className="px-3 py-2 tabular text-muted">
                        {r.quantity_in_recipe_unit !== null
                          ? `${r.quantity_in_recipe_unit.toLocaleString("nl-NL", {
                              maximumFractionDigits: 2,
                            })} ${baseUnitName ?? ""}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 tabular text-muted">
                        {r.applied_loss_pct ? `${r.applied_loss_pct}%` : "—"}
                      </td>
                      <td className="px-3 py-2 tabular">
                        {e?.pricePerBaseUnit != null
                          ? `€ ${e.pricePerBaseUnit.toFixed(4)} / ${e.baseUnitName ?? ""}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 tabular font-medium">
                        {r.line_cost !== null ? `€ ${r.line_cost.toFixed(4)}` : "—"}
                      </td>
                      <td className="px-3 py-2 tabular text-muted">
                        {share !== null ? `${share.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 tabular">
                        {delta !== null ? (
                          <span className={cn(delta > 0 ? "text-danger" : "text-success")}>
                            {delta > 0 ? "+" : ""}
                            {delta.toFixed(1)}%
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-muted">
                      {loading ? "Kostprijs berekenen…" : "Nog geen ingrediënten."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Opbouw productiekostprijs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Line label={`Aantal ingrediënten`} value={String(rows.length)} />
          <Line label="Ingrediëntkosten" value={`€ ${ingredientCost.toFixed(2)}`} />
          {(wastePercentage ?? 0) > 0 && (
            <Line
              label={`Productieverlies (${wastePercentage}%)`}
              value={`€ ${wasteAmount.toFixed(2)}`}
            />
          )}
          {(marginFreeCosts ?? 0) > 0 && (
            <Line label="Overige kosten" value={`€ ${(marginFreeCosts ?? 0).toFixed(2)}`} />
          )}
          {labourCost > 0 && (
            <Line label="Arbeidskosten" value={`€ ${labourCost.toFixed(2)}`} />
          )}
          <div className="border-t border-border pt-2">
            <Line
              label="Totale productiekostprijs"
              value={`€ ${productionCost.toFixed(2)}`}
              strong
            />
          </div>
          <Line
            label="Totale opbrengst"
            value={
              yieldQuantity ? `${yieldQuantity} ${baseUnitName ?? ""}` : "niet ingevuld"
            }
          />
          {costPerUnit !== null ? (
            <p className="rounded-md bg-teal/5 p-3">
              <strong>€ {productionCost.toFixed(2)}</strong> totale kosten ÷{" "}
              <strong>
                {yieldQuantity} {baseUnitName}
              </strong>{" "}
              opbrengst ={" "}
              <strong>
                € {costPerUnit.toFixed(4)} per {baseUnitName}
              </strong>
            </p>
          ) : (
            <p className="rounded-md bg-copper/10 p-3 text-copper">
              Vul een opbrengst in bij Algemeen om de kostprijs per eenheid te kunnen
              berekenen.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? "font-medium text-foreground" : "text-muted"}>{label}</span>
      <span className={cn("tabular", strong && "font-semibold text-foreground")}>{value}</span>
    </div>
  );
}

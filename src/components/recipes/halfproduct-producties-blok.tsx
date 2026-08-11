"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Printer, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import type { ProductionLabel, StockMovement, UserProfile } from "@/lib/types/database";

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
  quantity_in_recipe_unit: number | null;
}

/**
 * Het volledige "Productie"-onderdeel van de halfproduct-pagina.
 * Bovenaan de pagina: een module "Ingrediënten" met de te produceren
 * hoeveelheid, de verplichte producentkeuze en het schaalbare
 * receptoverzicht — vanhieruit wordt ook direct geregistreerd en de
 * sticker afgedrukt. "Producties" (de geschiedenis) is puur naslagwerk
 * en staat daarom onderaan de pagina.
 */
export function HalfproductIngredientenModule({
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

  // Schalen gebeurt intern altijd in de basiseenheid van het recept
  // (ml/gram) — dat is ook wat registratie en voorraadboekingen
  // verwachten. Getoond aan de gebruiker wordt de handzamere grotere
  // eenheid (liter/kilo) wanneer die van toepassing is; "stuk" en
  // andere eenheden blijven ongewijzigd.
  const LARGER_UNIT: Record<string, { name: string; factor: number }> = {
    milliliter: { name: "liter", factor: 1000 },
    gram: { name: "kilogram", factor: 1000 },
  };
  const largerUnit = unitName ? LARGER_UNIT[unitName] : null;
  const displayUnitName = largerUnit?.name ?? unitName;
  const displayFactor = largerUnit?.factor ?? 1;

  const [displayQuantity, setDisplayQuantity] = useState(
    standardYield ? (standardYield / displayFactor).toString() : ""
  );
  // De echte, door registratie/voorraad gebruikte hoeveelheid — altijd
  // in de basiseenheid van het recept. Afgerond op 6 decimalen om
  // drijvendekomma-restjes (bv. 0,1 × 1000 = 100,00000000000001) te
  // voorkomen in wat naar registratie/sticker doorgaat.
  const quantity = (
    Math.round(Number(displayQuantity || "0") * displayFactor * 1e6) / 1e6
  ).toString();
  const [producedByUserId, setProducedByUserId] = useState("");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [breakdown, setBreakdown] = useState<BreakdownLine[]>([]);

  const scale = standardYield && Number(quantity) > 0 ? Number(quantity) / standardYield : 1;

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("user_profiles")
      .select("*")
      .eq("is_active", true)
      .order("full_name")
      .then(({ data }) => setUsers((data as UserProfile[]) ?? []));
  }, []);

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

  const totalScaledCost = useMemo(
    () => breakdown.reduce((sum, l) => sum + (l.line_cost ?? 0) * scale, 0),
    [breakdown, scale]
  );

  const linesWithConvertedQty = breakdown.filter((l) => l.quantity_in_recipe_unit !== null);
  const totalScaledQuantity = useMemo(
    () =>
      linesWithConvertedQty.reduce((sum, l) => sum + (l.quantity_in_recipe_unit ?? 0) * scale, 0),
    [linesWithConvertedQty, scale]
  );

  const producedByName = users.find((u) => u.id === producedByUserId)?.full_name ?? "";

  const stickerHref = `/halfproducten/${recipeId}/sticker/nieuw?quantity=${quantity}&producedBy=${encodeURIComponent(
    producedByName
  )}`;

  const canRegister = Boolean(Number(quantity)) && Boolean(producedByUserId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ingrediënten</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Gewenste productiehoeveelheid ({displayUnitName ?? "eenheid"})
            </label>
            <input
              type="number"
              step="any"
              value={displayQuantity}
              onChange={(e) => setDisplayQuantity(e.target.value)}
              className="input"
            />
            <p className="mt-1 text-xs text-muted">
              Standaard {standardYield ? standardYield / displayFactor : "—"}{" "}
              {displayUnitName ?? ""}. Ingrediënten en kostprijs herberekenen automatisch
              evenredig.
            </p>
            {!standardYield && (
              <p className="mt-1 flex items-center gap-1 text-xs text-copper">
                <TriangleAlert className="h-3.5 w-3.5" />
                Er is nog geen &quot;Opbrengst&quot; ingevuld bij Basisgegevens hieronder —
                zonder dat kan er niet geschaald worden en blijven de hoeveelheden
                hierboven altijd gelijk aan het basisrecept.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Producent <span className="text-danger">*</span>
            </label>
            <select
              required
              value={producedByUserId}
              onChange={(e) => setProducedByUserId(e.target.value)}
              className="input"
            >
              <option value="">Kies producent…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </select>
            {!producedByUserId && (
              <p className="mt-1 flex items-center gap-1 text-xs text-copper">
                <TriangleAlert className="h-3.5 w-3.5" />
                Verplicht voordat je kunt registreren of een sticker afdrukken.
              </p>
            )}
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-2 py-3 font-medium">Ingrediënt</th>
              <th className="px-2 py-3 font-medium">Hoeveelheid</th>
              <th className="px-2 py-3 font-medium">Eenheid</th>
              <th className="px-2 py-3 font-medium">Kostprijs</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((line) => (
              <tr key={line.sort_order} className="border-t border-border">
                <td className="px-2 py-3 font-medium">{line.ingredient_name ?? "—"}</td>
                <td className="px-2 py-3 tabular">
                  {(line.quantity * scale).toLocaleString("nl-NL", { maximumFractionDigits: 3 })}
                </td>
                <td className="px-2 py-3 text-muted">{line.unit_name ?? "—"}</td>
                <td className="px-2 py-3 tabular text-muted">
                  {line.line_cost !== null ? `€ ${(line.line_cost * scale).toFixed(4)}` : "—"}
                </td>
              </tr>
            ))}
            {breakdown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-6 text-center text-muted">
                  {referenceCompanyId
                    ? "Nog geen ingrediënten toegevoegd."
                    : "Selecteer een bedrijf via de bedrijfsselector rechtsboven."}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {breakdown.length > 0 && (
          <div className="flex items-center justify-between border-t border-border pt-3">
            <div className="text-sm">
              <span className="text-muted">Totale hoeveelheid:&nbsp;</span>
              <span className="font-semibold text-foreground">
                {(totalScaledQuantity / displayFactor).toLocaleString("nl-NL", {
                  maximumFractionDigits: 3,
                })}{" "}
                {displayUnitName ?? ""}
              </span>
              {linesWithConvertedQty.length < breakdown.length && (
                <span className="ml-1 text-xs text-muted">
                  ({breakdown.length - linesWithConvertedQty.length} ingrediënt(en) met
                  afwijkende eenheid niet meegeteld)
                </span>
              )}
              <span className="mx-2 text-muted">·</span>
              <span className="text-muted">Totale kostprijs:&nbsp;</span>
              <span className="font-semibold text-foreground">€ {totalScaledCost.toFixed(2)}</span>
              {scale !== 1 && <span className="ml-1 text-muted">(×{scale.toFixed(2)})</span>}
            </div>
            <Link href={canRegister ? stickerHref : "#"} aria-disabled={!canRegister}>
              <Button type="button" disabled={!canRegister}>
                <Printer className="h-4 w-4" />
                Registreren & sticker afdrukken
              </Button>
            </Link>
          </div>
        )}
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

/** Producties-geschiedenis — puur naslagwerk, staat daarom onderaan de pagina. */
export function ProductiesGeschiedenis({
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
    if (!referenceCompanyId) return;
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
        .limit(10);
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
              <th className="px-5 py-3 font-medium">Batchnummer</th>
              <th className="px-5 py-3 font-medium">Productiedatum</th>
              <th className="px-5 py-3 font-medium">Hoeveelheid</th>
              <th className="px-5 py-3 font-medium">Kostprijs</th>
              <th className="px-5 py-3 font-medium">Producent</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ movement, cost, producedBy }) => (
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
  );
}

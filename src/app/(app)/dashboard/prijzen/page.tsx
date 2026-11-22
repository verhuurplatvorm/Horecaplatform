"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TrendingDown, TrendingUp, TriangleAlert, X } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import { withReturnTo } from "@/lib/use-return-navigation";
import { cn } from "@/lib/utils";
import {
  aggregateImpact,
  describeCause,
  normalizeImpactRow,
  type ImpactRow,
  type RecipeImpact,
} from "@/lib/price-impact";

const FOODCOST_NORM = 33;
const PERIODS = [
  { value: 7, label: "Laatste 7 dagen" },
  { value: 30, label: "Laatste 30 dagen" },
  { value: 90, label: "Laatste kwartaal" },
  { value: 365, label: "Laatste jaar" },
];

/** Netto prijswijziging van een ingrediënt voor het gekozen bedrijf (company_price_changes). */
interface IngredientChange {
  product_id: string;
  product_name: string;
  supplier_name: string | null;
  changed_on: string;
  old_price: number;
  new_price: number;
  delta_pct: number;
  change_count: number;
}

/**
 * Prijsontwikkeling: welke ingrediënten zijn duurder/goedkoper geworden en
 * welke halfproducten en gerechten raakt dat — ook via onderliggende
 * halfproducten. Prijzen en kostprijzen gelden voor het gekozen bedrijf en
 * komen uit de bestaande kostprijsberekening (migratie 0150).
 */
export default function PrijzenDashboardPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canViewFinancial = can("leveranciers").canViewFinancial;
  const { activeCompanyIds, companies, loading: scopeLoading } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const referenceCompanyName = companies.find((c) => c.id === referenceCompanyId)?.name;

  const [periodDays, setPeriodDays] = useState(30);
  const [data, setData] = useState<{ key: string; changes: IngredientChange[]; impact: ImpactRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);

  const asofDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - periodDays);
    return d.toISOString().slice(0, 10);
  }, [periodDays]);
  const key = `${referenceCompanyId}|${asofDate}`;

  useEffect(() => {
    if (scopeLoading || !referenceCompanyId) return;
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      supabase.rpc("company_price_changes", { p_company_id: referenceCompanyId, p_from: asofDate }),
      supabase.rpc("price_change_impact", { p_company_id: referenceCompanyId, p_from: asofDate }),
    ]).then(([c, i]) => {
      if (cancelled) return;
      if (c.error || i.error) {
        setError((c.error ?? i.error)!.message);
        return;
      }
      setError(null);
      setData({
        key,
        changes: ((c.data ?? []) as IngredientChange[]).map((x) => ({
          ...x,
          old_price: Number(x.old_price),
          new_price: Number(x.new_price),
          delta_pct: Number(x.delta_pct),
        })),
        impact: ((i.data ?? []) as ImpactRow[]).map(normalizeImpactRow),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [referenceCompanyId, scopeLoading, asofDate, key]);

  const loading = data?.key !== key;
  const changes = useMemo(() => (loading ? [] : data!.changes), [data, loading]);
  const impactRows = useMemo(() => (loading ? [] : data!.impact), [data, loading]);
  // Een gekozen ingrediënt dat in deze periode niet meer voorkomt telt niet.
  const activeProduct = selectedProduct && changes.some((c) => c.product_id === selectedProduct) ? selectedProduct : null;
  const impact = useMemo(() => aggregateImpact(impactRows, activeProduct), [impactRows, activeProduct]);
  const gerechten = impact.filter((r) => r.kind === "gerecht");
  const halfproducten = impact.filter((r) => r.kind === "halfproduct");
  const opKaart = gerechten.filter((r) => r.activeCards.length > 0);
  const bovenNorm = gerechten.filter((r) => r.newFoodcostPct !== null && r.newFoodcostPct > FOODCOST_NORM);

  const stijgers = changes.filter((c) => c.delta_pct > 0).sort((a, b) => b.delta_pct - a.delta_pct);
  const dalers = changes.filter((c) => c.delta_pct < 0).sort((a, b) => a.delta_pct - b.delta_pct);
  const affectedCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of impactRows) if (r.recipe_kind === "gerecht") m.set(r.product_id, (m.get(r.product_id) ?? 0) + 1);
    return m;
  }, [impactRows]);
  const selectedName = changes.find((c) => c.product_id === activeProduct)?.product_name;

  return (
    <>
      <Topbar title="Prijsontwikkeling" />
      <main className="space-y-6 p-6">
        {!permsLoading && !canViewFinancial && (
          <p className="rounded-md bg-copper/10 p-3 text-sm text-copper">
            Je rol heeft geen toegang tot financiële gegevens. Dit scherm toont kostprijzen, marges en
            foodcost en is daarom afgeschermd.
          </p>
        )}
        {(permsLoading || canViewFinancial) &&
          (!referenceCompanyId ? (
            <p className="text-sm text-muted">Selecteer een bedrijf via de bedrijfsselector rechtsboven.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted">
                  Prijzen voor <strong className="text-foreground">{referenceCompanyName}</strong>, vergeleken
                  met de prijs van vóór de eerste wijziging in de periode.
                </p>
                <select
                  value={periodDays}
                  onChange={(e) => setPeriodDays(Number(e.target.value))}
                  className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                >
                  {PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <SummaryCard label="Ingrediënten duurder" value={stijgers.length} tone="bad" />
                <SummaryCard label="Ingrediënten goedkoper" value={dalers.length} tone="good" />
                <SummaryCard label="Halfproducten geraakt" value={halfproducten.length} />
                <SummaryCard label="Gerechten geraakt" value={gerechten.length} />
                <SummaryCard
                  label="Waarvan op actieve kaart"
                  value={opKaart.length}
                  tone={opKaart.length > 0 ? "bad" : undefined}
                />
                <SummaryCard
                  label={`Boven ${FOODCOST_NORM}% foodcost`}
                  value={bovenNorm.length}
                  tone={bovenNorm.length > 0 ? "bad" : "good"}
                />
                <SummaryCard
                  label="Grootste stijger"
                  value={stijgers[0] ? `+${stijgers[0].delta_pct.toFixed(0)}%` : "—"}
                  sub={stijgers[0]?.product_name}
                  tone="bad"
                />
                <SummaryCard
                  label="Grootste daler"
                  value={dalers[0] ? `${dalers[0].delta_pct.toFixed(0)}%` : "—"}
                  sub={dalers[0]?.product_name}
                  tone="good"
                />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <ChangeTable
                  title="Duurder geworden — ingrediënten"
                  rows={stijgers}
                  selected={activeProduct}
                  affected={affectedCount}
                  onSelect={setSelectedProduct}
                />
                <ChangeTable
                  title="Goedkoper geworden — ingrediënten"
                  rows={dalers}
                  selected={activeProduct}
                  affected={affectedCount}
                  onSelect={setSelectedProduct}
                />
              </div>

              {selectedName && (
                <div className="flex items-center gap-2 rounded-md border border-teal/30 bg-teal/5 px-4 py-2 text-sm">
                  Gevolgen van de prijswijziging van <strong>{selectedName}</strong>
                  <button
                    type="button"
                    onClick={() => setSelectedProduct(null)}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-teal hover:underline"
                  >
                    <X className="h-3.5 w-3.5" /> Alle wijzigingen tonen
                  </button>
                </div>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Gerechten — kostprijs per portie</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ImpactTable rows={gerechten} basePath="/recepturen" showFoodcost loading={loading} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Halfproducten — kostprijs per productie</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ImpactTable rows={halfproducten} basePath="/halfproducten" loading={loading} />
                </CardContent>
              </Card>
              <p className="text-xs text-muted">
                Oude en nieuwe kostprijs komen uit dezelfde kostprijsberekening als de rest van Culilogic,
                met alleen de gewijzigde ingrediëntprijs(zen) op oud of nieuw gezet. Gerechten op een actieve
                menukaart van {referenceCompanyName} staan bovenaan. Partijgerechten tonen de kostprijs per vorm.
              </p>
            </>
          ))}
      </main>
    </>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "good" | "bad";
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
        <p
          className={cn(
            "tabular text-2xl font-semibold",
            tone === "bad" ? "text-danger" : tone === "good" ? "text-success" : "text-foreground",
          )}
        >
          {value}
        </p>
        {sub && <p className="truncate text-xs text-muted">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ChangeTable({
  title,
  rows,
  selected,
  affected,
  onSelect,
}: {
  title: string;
  rows: IngredientChange[];
  selected: string | null;
  affected: Map<string, number>;
  onSelect: (id: string | null) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((c) => {
                const n = affected.get(c.product_id) ?? 0;
                const isSel = selected === c.product_id;
                return (
                  <tr
                    key={c.product_id}
                    onClick={() => onSelect(isSel ? null : c.product_id)}
                    className={cn("cursor-pointer border-t border-border hover:bg-background", isSel && "bg-teal/5")}
                    title="Toon welke halfproducten en gerechten deze prijswijziging raakt"
                  >
                    <td className="px-5 py-2.5">
                      <span className="font-medium">{c.product_name}</span>
                      <p className="text-xs text-muted">
                        {c.supplier_name ?? "—"} · {new Date(c.changed_on).toLocaleDateString("nl-NL")}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular text-xs">
                      <span className="text-muted">{perKgOrBase(c.old_price)}</span> → {perKgOrBase(c.new_price)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          "flex items-center justify-end gap-1 tabular",
                          c.delta_pct > 0 ? "text-danger" : "text-success",
                        )}
                      >
                        {c.delta_pct > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                        {c.delta_pct > 0 ? "+" : ""}
                        {c.delta_pct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-xs text-muted">
                      {n > 0 ? `${n} gerecht${n === 1 ? "" : "en"} →` : "geen gerechten"}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className="px-5 py-6 text-center text-muted">Geen wijzigingen</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** Prijs per basiseenheid compact: kleine bedragen (g/ml) als € per 1000. */
function perKgOrBase(p: number): string {
  return p < 0.1 ? `€ ${(p * 1000).toFixed(2)}/1000` : `€ ${p.toFixed(4)}`;
}

function ImpactTable({
  rows,
  basePath,
  showFoodcost,
  loading,
}: {
  rows: RecipeImpact[];
  basePath: string;
  showFoodcost?: boolean;
  loading: boolean;
}) {
  const cols = showFoodcost ? 6 : 5;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-5 py-3 font-medium">Naam</th>
            <th className="px-5 py-3 font-medium">Geraakt door</th>
            <th className="px-5 py-3 text-right font-medium">Oud</th>
            <th className="px-5 py-3 text-right font-medium">Nieuw</th>
            <th className="px-5 py-3 text-right font-medium">Verschil</th>
            {showFoodcost && <th className="px-5 py-3 text-right font-medium">Foodcost</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.recipeId} className="border-t border-border align-top">
              <td className="px-5 py-3">
                <Link
                  href={withReturnTo(`${basePath}/${r.recipeId}/bewerken`)}
                  className="font-medium hover:text-teal hover:underline"
                >
                  {r.name}
                </Link>
                {r.perForm && <span className="ml-1 text-xs text-muted">(per vorm)</span>}
                {r.activeCards.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {r.activeCards.map((c) => (
                      <span key={c} className="rounded bg-copper/10 px-1.5 text-xs text-copper">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-5 py-3 text-xs text-muted">
                {r.causes.map((c) => (
                  <div key={c.productId}>{describeCause(c)}</div>
                ))}
              </td>
              <td className="px-5 py-3 text-right tabular text-muted">€ {r.oldCost.toFixed(2)}</td>
              <td className="px-5 py-3 text-right tabular">€ {r.newCost.toFixed(2)}</td>
              <td className="px-5 py-3">
                <span
                  className={cn(
                    "flex items-center justify-end gap-1 tabular",
                    r.delta > 0 ? "text-danger" : "text-success",
                  )}
                >
                  {r.delta > 0 ? "+" : "−"}€ {Math.abs(r.delta).toFixed(2)}
                  {r.deltaPct !== null && (
                    <span className="text-xs">
                      ({r.deltaPct > 0 ? "+" : ""}
                      {r.deltaPct.toFixed(1)}%)
                    </span>
                  )}
                </span>
              </td>
              {showFoodcost && (
                <td className="px-5 py-3 text-right tabular">
                  {r.newFoodcostPct !== null ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        r.newFoodcostPct > FOODCOST_NORM ? "text-copper" : "text-success",
                      )}
                    >
                      {r.newFoodcostPct > FOODCOST_NORM && <TriangleAlert className="h-3.5 w-3.5" />}
                      {r.oldFoodcostPct !== null && (
                        <span className="text-xs text-muted">{r.oldFoodcostPct.toFixed(1)}% →</span>
                      )}
                      {r.newFoodcostPct.toFixed(1)}%
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols} className="px-5 py-6 text-center text-muted">
                {loading ? "Bezig met rekenen…" : "Geen kostprijswijzigingen in deze periode."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

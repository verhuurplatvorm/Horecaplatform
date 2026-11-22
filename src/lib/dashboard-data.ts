import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  DashboardAgreedDeviationRow,
  DashboardMarginProblemRow,
  DashboardPriceAlertRow,
} from "@/lib/types/database";
import type { DashboardScope } from "@/lib/dashboard-links";

/**
 * Gedeelde ophaalfuncties voor dashboard én bestemmingspagina's. Beide
 * roepen precies dezelfde databasefunctie aan met dezelfde filters, zodat
 * de teller op het dashboard gelijk is aan de lijst na het doorklikken.
 */

type Client = SupabaseClient<Database>;

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function fetchMarginProblems(supabase: Client, scope: DashboardScope): Promise<DashboardMarginProblemRow[]> {
  const { data, error } = await supabase.rpc("dashboard_margin_problem_rows", {
    p_company_ids: scope.companyIds,
    p_only_current: scope.onlyCurrent,
    p_category: scope.category ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as DashboardMarginProblemRow[])
    .map((r) => ({
      ...r,
      cost_price: Number(r.cost_price),
      sales_price: Number(r.sales_price),
      foodcost_pct: Number(r.foodcost_pct),
      margin_pct: Number(r.margin_pct),
      norm_pct: Number(r.norm_pct),
    }))
    .sort((a, b) => b.foodcost_pct - a.foodcost_pct);
}

export interface PriceAlerts {
  alerts: DashboardPriceAlertRow[];
  agreed: DashboardAgreedDeviationRow[];
}

/** Prijsalarmen + afwijkingen van afgesproken prijzen, met leveranciersfilter. */
export async function fetchPriceAlerts(supabase: Client, scope: DashboardScope): Promise<PriceAlerts> {
  const args = {
    p_company_ids: scope.companyIds,
    p_only_current: scope.onlyCurrent,
    p_days: scope.days ?? 30,
  };
  const [a, d] = await Promise.all([
    supabase.rpc("dashboard_price_alert_rows", args),
    supabase.rpc("dashboard_agreed_deviation_rows", args),
  ]);
  if (a.error) throw a.error;
  if (d.error) throw d.error;
  return filterAlertsBySupplier(
    {
      alerts: ((a.data ?? []) as DashboardPriceAlertRow[]).map((r) => ({
        ...r,
        old_price: Number(r.old_price),
        new_price: Number(r.new_price),
        difference_eur: Number(r.difference_eur),
        difference_pct: Number(r.difference_pct),
      })),
      agreed: ((d.data ?? []) as DashboardAgreedDeviationRow[]).map((r) => ({
        ...r,
        invoice_price: Number(r.invoice_price),
        ref_price: Number(r.ref_price),
        diff_pct: num(r.diff_pct),
        impact: num(r.impact),
      })),
    },
    scope.supplierName ?? null,
  );
}

export function filterAlertsBySupplier(p: PriceAlerts, supplierName: string | null): PriceAlerts {
  if (!supplierName) return sortAlerts(p);
  return sortAlerts({
    alerts: p.alerts.filter((r) => r.supplier_name === supplierName),
    agreed: p.agreed.filter((r) => r.supplier_name === supplierName),
  });
}

function sortAlerts(p: PriceAlerts): PriceAlerts {
  return {
    alerts: [...p.alerts].sort((a, b) => Math.abs(b.difference_pct) - Math.abs(a.difference_pct)),
    agreed: [...p.agreed].sort((a, b) => b.invoice_date.localeCompare(a.invoice_date)),
  };
}

/** Teller "Prijsalarmen" = alarmen uit prijswijzigingen + afwijkingen op facturen. */
export function priceAlertCount(p: PriceAlerts): number {
  return p.alerts.length + p.agreed.length;
}

/** Zelfde normalisatie als dashboard_counts.unmatched_names. */
export function unmatchedNameKey(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function countUnmatchedNames(lines: { name: string | null }[]): number {
  return new Set(lines.map((l) => unmatchedNameKey(l.name))).size;
}

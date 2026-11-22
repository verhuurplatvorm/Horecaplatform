import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { toCostStatus, type CostStatus } from "@/lib/costing/status";

/**
 * Kostprijzen van veel recepten in één keer (database-functie
 * calculate_recipe_costs, zelfde rekenregels als calculate_recipe_cost).
 * In blokken van 400 om de aanvraag klein te houden.
 */
export async function fetchRecipeCosts(
  supabase: SupabaseClient<Database>,
  companyId: string,
  recipeIds: string[],
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  const unique = [...new Set(recipeIds.filter(Boolean))];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 400) chunks.push(unique.slice(i, i + 400));
  await Promise.all(
    chunks.map(async (ids) => {
      const { data } = await supabase.rpc("calculate_recipe_costs", {
        p_company_id: companyId,
        p_recipe_ids: ids,
      });
      for (const row of (data ?? []) as { recipe_id: string; cost: number | null }[]) {
        result.set(row.recipe_id, row.cost === null ? null : Number(row.cost));
      }
    }),
  );
  return result;
}

/**
 * Status "Kostprijs onvolledig" voor veel recepten in één keer (database-functie
 * recipe_cost_status). Werkt door naar onderliggende halfproducten op elke diepte.
 */
export async function fetchRecipeCostStatus(
  supabase: SupabaseClient<Database>,
  companyId: string,
  recipeIds: string[],
): Promise<Map<string, CostStatus>> {
  const result = new Map<string, CostStatus>();
  const unique = [...new Set(recipeIds.filter(Boolean))];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 400) chunks.push(unique.slice(i, i + 400));
  await Promise.all(
    chunks.map(async (ids) => {
      const { data } = await supabase.rpc("recipe_cost_status", {
        p_company_id: companyId,
        p_recipe_ids: ids,
      });
      for (const row of (data ?? []) as { recipe_id: string; is_complete: boolean; issues: unknown }[]) {
        result.set(row.recipe_id, toCostStatus(row));
      }
    }),
  );
  return result;
}

/** Status "Kostprijs onvolledig" van één menu/buffet. */
export async function fetchEventMenuCostStatus(
  supabase: SupabaseClient<Database>,
  menuId: string,
  companyId: string,
): Promise<CostStatus> {
  const { data } = await supabase.rpc("event_menu_cost_status", {
    p_menu_id: menuId,
    p_company_id: companyId,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return toCostStatus(row as { is_complete: boolean; issues: unknown } | null);
}

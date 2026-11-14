import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

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

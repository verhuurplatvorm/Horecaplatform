import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Haalt de group_id van de ingelogde gebruiker op via user_profiles —
 * de enige betrouwbare bron. Nodig bij elke insert in een tabel met een
 * verplichte group_id-kolom (products, recipes, sales_products,
 * suppliers, companies, ...), omdat die kolom nergens een database-
 * default heeft.
 */
export async function getCurrentGroupId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("group_id")
    .eq("id", user.id)
    .single();

  return profile?.group_id ?? null;
}

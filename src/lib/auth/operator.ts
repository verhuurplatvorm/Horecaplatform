import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * Is de ingelogde gebruiker (uitsluitend) Operator? Zelfde controle als de
 * database gebruikt voor de alleen-lezen-beveiliging.
 */
export async function isOperator(
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  const { data } = await supabase.rpc("current_user_is_operator");
  return data === true;
}

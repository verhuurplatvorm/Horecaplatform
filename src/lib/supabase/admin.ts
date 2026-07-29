import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * Admin-client met de service role key. Omzeilt RLS volledig — gebruik
 * dit ALLEEN server-side (API routes), nooit in een Client Component, en
 * altijd pas nadat is gecontroleerd dat de aanroepende gebruiker de
 * juiste rechten heeft (bv. is_group_admin).
 *
 * Vereist de omgevingsvariabele SUPABASE_SERVICE_ROLE_KEY (zonder
 * NEXT_PUBLIC_-prefix, dus nooit naar de browser gestuurd). Te vinden in
 * het Supabase-dashboard onder Project Settings → API → service_role key.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY ontbreekt. Voeg 'm toe aan .env.local (lokaal) en aan de Vercel-projectinstellingen (Environment Variables) — te vinden in het Supabase-dashboard onder Project Settings → API → service_role key."
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

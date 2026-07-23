import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";

/**
 * Supabase-client voor gebruik in Client Components.
 * Gebruikt NEXT_PUBLIC_* env vars, dus veilig om in de browser te draaien
 * (RLS regelt de daadwerkelijke autorisatie op de database).
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

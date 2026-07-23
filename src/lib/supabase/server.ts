import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database";

/**
 * Supabase-client voor gebruik in Server Components, Server Actions en
 * Route Handlers. Leest/schrijft de sessie via cookies, zodat RLS-policies
 * (public.has_company_access, is_group_admin, ...) de ingelogde gebruiker
 * herkennen via auth.uid().
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll wordt ook aangeroepen vanuit Server Components waar
            // cookies niet geschreven mogen worden; middleware.ts ververst
            // de sessie in dat geval.
          }
        },
      },
    }
  );
}

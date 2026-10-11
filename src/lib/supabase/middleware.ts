import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Ververst de Supabase-sessie bij elk request en stuurt niet-ingelogde
 * gebruikers naar /login (behalve voor de login-/auth-routes zelf).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth");

  // De factuurmailbox-webhook wordt door een externe mailservice (Mailgun)
  // aangeroepen, zonder inlogsessie. De route beveiligt zichzelf met het
  // geheime token in de URL, dus hij mag niet naar /login worden gestuurd.
  const isInboundEmailWebhook = request.nextUrl.pathname.startsWith(
    "/api/invoices/inbound-email/"
  );

  if (!user && !isAuthRoute && !isInboundEmailWebhook) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

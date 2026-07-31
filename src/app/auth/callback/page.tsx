"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackHandler />
    </Suspense>
  );
}

function AuthCallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const message = "Bezig met inloggen…";

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();

      // Sommige Supabase-inloglinks geven de tokens mee als #-fragment
      // (bv. #access_token=...&refresh_token=...) i.p.v. als ?code=.
      // Een #-fragment wordt nooit naar de server gestuurd — dat kan
      // alleen de browser zelf lezen, dus dit moet hier gebeuren.
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (cancelled) return;
        if (error) {
          router.replace(`/login?error=${encodeURIComponent(error.message)}`);
          return;
        }
        router.replace("/dashboard");
        return;
      }

      const errorDescription = searchParams.get("error_description");
      if (errorDescription) {
        router.replace(`/login?error=${encodeURIComponent(errorDescription)}`);
        return;
      }

      const code = searchParams.get("code");
      if (!code) {
        router.replace(
          `/login?error=${encodeURIComponent(
            "Geen inlogcode ontvangen. Vraag een nieuwe link aan."
          )}`
        );
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (cancelled) return;
      if (error) {
        router.replace(`/login?error=${encodeURIComponent(error.message)}`);
        return;
      }
      router.replace("/dashboard");
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-4">
      <p className="text-sm text-white/60">{message}</p>
    </main>
  );
}

"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");
  const [mode, setMode] = useState<"wachtwoord" | "inloglink">("wachtwoord");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus("error");
      setErrorMessage(
        error.message === "Invalid login credentials"
          ? "E-mailadres of wachtwoord onjuist."
          : error.message
      );
      return;
    }
    router.push("/dashboard");
  }

  async function handleMagicLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setStatus(error ? "error" : "sent");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm rounded-lg border border-white/10 bg-navy-light p-8">
        <p className="text-sm font-semibold tracking-wide text-white">
          Horeca Platform
        </p>
        <h1 className="mt-1 text-xl font-semibold text-white">Inloggen</h1>

        {callbackError && (
          <p className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            Inloggen mislukt: {callbackError}
          </p>
        )}

        <div className="mt-4 flex gap-1 rounded-md border border-white/15 bg-navy p-1">
          <button
            type="button"
            onClick={() => {
              setMode("wachtwoord");
              setStatus("idle");
            }}
            className={cn(
              "flex-1 rounded px-3 py-1.5 text-sm font-medium",
              mode === "wachtwoord" ? "bg-teal text-white" : "text-white/60"
            )}
          >
            Wachtwoord
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("inloglink");
              setStatus("idle");
            }}
            className={cn(
              "flex-1 rounded px-3 py-1.5 text-sm font-medium",
              mode === "inloglink" ? "bg-teal text-white" : "text-white/60"
            )}
          >
            Inloglink
          </button>
        </div>

        {mode === "wachtwoord" ? (
          <>
            <p className="mt-3 text-sm text-white/60">
              Log in met je werk-e-mailadres en wachtwoord.
            </p>
            <form onSubmit={handlePasswordSubmit} className="mt-4 space-y-3">
              <input
                type="email"
                required
                placeholder="naam@bedrijf.nl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10 w-full rounded-md border border-white/15 bg-navy px-3 text-sm text-white placeholder:text-white/40 focus:border-copper focus:outline-none"
              />
              <input
                type="password"
                required
                placeholder="Wachtwoord"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 w-full rounded-md border border-white/15 bg-navy px-3 text-sm text-white placeholder:text-white/40 focus:border-copper focus:outline-none"
              />
              <Button type="submit" className="w-full" disabled={status === "sending"}>
                {status === "sending" ? "Bezig…" : "Inloggen"}
              </Button>
            </form>
            {status === "error" && (
              <p className="mt-4 text-sm text-danger">{errorMessage}</p>
            )}
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-white/60">
              Je ontvangt een e-mail met een inloglink.
            </p>
            <form onSubmit={handleMagicLinkSubmit} className="mt-4 space-y-3">
              <input
                type="email"
                required
                placeholder="naam@bedrijf.nl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10 w-full rounded-md border border-white/15 bg-navy px-3 text-sm text-white placeholder:text-white/40 focus:border-copper focus:outline-none"
              />
              <Button type="submit" className="w-full" disabled={status === "sending"}>
                {status === "sending" ? "Versturen…" : "Stuur inloglink"}
              </Button>
            </form>
            {status === "sent" && (
              <p className="mt-4 text-sm text-success">
                Check je inbox voor de inloglink.
              </p>
            )}
            {status === "error" && (
              <p className="mt-4 text-sm text-danger">
                Er ging iets mis. Probeer het opnieuw.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}

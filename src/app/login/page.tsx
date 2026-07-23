"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  async function handleSubmit(e: React.FormEvent) {
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
        <p className="mt-2 text-sm text-white/60">
          Log in met je werk-e-mailadres. Je ontvangt een inloglink.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            required
            placeholder="naam@bedrijf.nl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 w-full rounded-md border border-white/15 bg-navy px-3 text-sm text-white placeholder:text-white/40 focus:border-copper focus:outline-none"
          />
          <Button
            type="submit"
            className="w-full"
            disabled={status === "sending"}
          >
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
      </div>
    </main>
  );
}

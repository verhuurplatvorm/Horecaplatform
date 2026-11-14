"use client";

import { useEffect, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Ingelogde gebruiker + uitloggen, zodat iemand anders (bv. met een
 * andere rol) kan inloggen op hetzelfde apparaat.
 */
export function LogoutButton() {
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("user_profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled) setName(data?.full_name || user.email || null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    setBusy(true);
    await createClient().auth.signOut();
    // Volledig herladen, zodat geen gegevens van de vorige gebruiker blijven staan.
    window.location.href = "/login";
  }

  return (
    <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
      {name && (
        <span className="hidden items-center gap-1.5 text-sm text-muted lg:flex">
          <UserRound className="h-4 w-4" />
          <span className="max-w-[12rem] truncate">{name}</span>
        </span>
      )}
      <button
        type="button"
        onClick={() => void logout()}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:border-danger/40 hover:bg-danger/5 hover:text-danger disabled:opacity-50"
        title="Uitloggen"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">{busy ? "Uitloggen…" : "Uitloggen"}</span>
      </button>
    </div>
  );
}

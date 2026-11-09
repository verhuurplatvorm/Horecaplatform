"use client";

import { useEffect, useState } from "react";
import { Delete, User, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  haccpError,
  staffSessionExpiry,
  type StaffSession,
} from "@/lib/haccp/cleaning";

interface Staff {
  id: string;
  full_name: string;
  has_pin: boolean;
}

/**
 * Medewerker wisselen op een gedeelde tablet: naam kiezen → pincode.
 * De server controleert de pincode en geeft een sessie terug; elke
 * afmelding wordt daarna op naam van deze medewerker vastgelegd.
 */
export function StaffSwitcher({
  companyId,
  accountName,
  onClose,
  onChosen,
}: {
  companyId: string;
  accountName: string | null;
  onClose: () => void;
  onChosen: (session: StaffSession | null) => void;
}) {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [chosen, setChosen] = useState<Staff | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .rpc("haccp_staff", { p_company_id: companyId })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(haccpError(err));
        setStaff((data as Staff[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function submit(code: string) {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await createClient().rpc(
      "haccp_start_staff_session",
      {
        p_company_id: companyId,
        p_staff_id: chosen.id,
        p_pin: code,
      },
    );
    setBusy(false);
    if (err || !data) {
      setPin("");
      setError(haccpError(err));
      return;
    }
    onChosen({
      companyId,
      sessionId: data as string,
      staffId: chosen.id,
      name: chosen.full_name,
      expiresAt: staffSessionExpiry(),
    });
  }

  function press(d: string) {
    if (busy) return;
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) void submit(next);
  }

  const withPin = (staff ?? []).filter((s) => s.has_pin);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy/60 p-4 sm:p-8">
      <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            {chosen ? `Pincode ${chosen.full_name}` : "Wie werkt er?"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-muted hover:bg-surface"
            aria-label="Sluiten"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {error && (
            <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          {!chosen && (
            <>
              {staff === null && <p className="text-sm text-muted">Laden…</p>}
              {staff !== null && withPin.length === 0 && (
                <p className="mb-4 text-sm text-muted">
                  Er zijn nog geen pincodes ingesteld. Een beheerder doet dat
                  bij HACCP → Instellingen.
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {withPin.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setChosen(s);
                      setPin("");
                      setError(null);
                    }}
                    className="flex h-14 items-center gap-3 rounded-lg border border-border bg-surface px-4 text-left text-base font-medium text-foreground hover:border-teal"
                  >
                    <User className="h-5 w-5 text-muted" />
                    {s.full_name}
                  </button>
                ))}
              </div>
              {accountName && (
                <button
                  onClick={() => onChosen(null)}
                  className="mt-4 w-full rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted hover:text-foreground"
                >
                  Geen medewerker kiezen — registreren als ingelogd account (
                  {accountName})
                </button>
              )}
            </>
          )}

          {chosen && (
            <div className="mx-auto max-w-xs">
              <div className="mb-4 flex justify-center gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-4 w-4 rounded-full border-2 border-navy",
                      pin.length > i && "bg-navy",
                    )}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                  <button
                    key={d}
                    onClick={() => press(d)}
                    disabled={busy}
                    className="h-16 rounded-lg border border-border bg-surface text-2xl font-semibold text-foreground active:bg-background"
                  >
                    {d}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setChosen(null);
                    setPin("");
                  }}
                  className="h-16 rounded-lg text-sm text-muted"
                >
                  Terug
                </button>
                <button
                  onClick={() => press("0")}
                  disabled={busy}
                  className="h-16 rounded-lg border border-border bg-surface text-2xl font-semibold text-foreground active:bg-background"
                >
                  0
                </button>
                <button
                  onClick={() => setPin((p) => p.slice(0, -1))}
                  className="flex h-16 items-center justify-center rounded-lg text-muted"
                  aria-label="Wissen"
                >
                  <Delete className="h-6 w-6" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

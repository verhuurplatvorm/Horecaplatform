"use client";

import { useEffect, useState } from "react";
import { Plus, User } from "lucide-react";
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
}

const NEW = "__nieuw__";

/**
 * Medewerker kiezen: een gewone keuzelijst plus een veld om een collega
 * toe te voegen. Collegiale werkplek, dus geen pincode. De keuze wordt
 * op de server vastgelegd als medewerkersessie (12 uur op dit apparaat);
 * registraties komen op naam van de gekozen medewerker, het ingelogde
 * account wordt apart bewaard.
 *
 * `excludeShared`: gedeelde keukenaccounts (bv. "Het Strand") niet tonen
 * — gebruikt bij stickers.
 */
export function StaffSelect({
  companyId,
  value,
  onChosen,
  excludeShared = false,
  className,
  placeholder = "— kies medewerker —",
  required = true,
}: {
  companyId: string;
  value: { id: string; name: string } | null;
  onChosen: (session: StaffSession) => void;
  excludeShared?: boolean;
  className?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const req = excludeShared
      ? supabase.rpc("sticker_staff", { p_company_id: companyId })
      : supabase.rpc("haccp_staff", { p_company_id: companyId });
    req.then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) setError(haccpError(err));
      setStaff(
        ((data as Staff[]) ?? []).map((s) => ({
          id: s.id,
          full_name: s.full_name,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, excludeShared, reload]);

  async function choose(id: string, fullName: string) {
    setBusy(true);
    setError(null);
    const { data, error: err } = await createClient().rpc(
      "haccp_start_staff_session",
      { p_company_id: companyId, p_staff_id: id, p_pin: "" },
    );
    setBusy(false);
    if (err || !data) {
      setError(haccpError(err));
      return;
    }
    onChosen({
      companyId,
      sessionId: data as string,
      staffId: id,
      name: fullName,
      expiresAt: staffSessionExpiry(),
    });
  }

  async function add() {
    const fullName = name.trim();
    if (!fullName) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/haccp/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, fullName }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      userId?: string;
      error?: string;
    };
    setBusy(false);
    if (!res.ok || !json.userId) {
      setError(json.error ?? "Toevoegen mislukt.");
      return;
    }
    setAdding(false);
    setName("");
    setReload((r) => r + 1);
    await choose(json.userId, fullName);
  }

  const known = value && staff?.some((s) => s.id === value.id);

  return (
    <div className={className}>
      {!adding ? (
        <div className="relative">
          <User className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <select
            value={value?.id ?? ""}
            disabled={busy || staff === null}
            onChange={(e) => {
              const id = e.target.value;
              if (id === NEW) {
                setAdding(true);
                return;
              }
              const s = staff?.find((x) => x.id === id);
              if (s) void choose(s.id, s.full_name);
            }}
            className={cn(
              "input h-12! pl-10! text-base! font-medium",
              !value && required && "border-danger! text-danger",
            )}
          >
            <option value="" disabled>
              {staff === null ? "Laden…" : placeholder}
            </option>
            {value && !known && <option value={value.id}>{value.name}</option>}
            {(staff ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
            <option value={NEW}>+ Nieuwe medewerker toevoegen…</option>
          </select>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Voor- en achternaam"
            className="input h-12! flex-1"
          />
          <button
            type="submit"
            disabled={busy || name.trim().length < 2}
            className="flex h-12 items-center gap-1 rounded-lg bg-teal px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            {busy ? "Bezig…" : "Toevoegen"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setName("");
              setError(null);
            }}
            className="h-12 px-2 text-sm text-muted"
          >
            Annuleren
          </button>
        </form>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

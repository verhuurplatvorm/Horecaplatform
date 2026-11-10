"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, KeyRound, QrCode } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SingleCompany } from "@/components/haccp/single-company";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { cn } from "@/lib/utils";
import {
  addDaysISO,
  formatDateNL,
  haccpError,
  todayISO,
} from "@/lib/haccp/cleaning";
import type { HaccpArea, HaccpClosedDay } from "@/lib/types/database";

export default function HaccpInstellingenPage() {
  return (
    <>
      <Topbar title="HACCP-instellingen" />
      <SingleCompany>
        {(companyId) => <Instellingen key={companyId} companyId={companyId} />}
      </SingleCompany>
    </>
  );
}

const inputCls =
  "h-10 rounded-md border border-border bg-surface px-3 text-sm text-foreground focus:border-teal focus:outline-none";

interface Staff {
  id: string;
  full_name: string;
  has_pin: boolean;
}

function Instellingen({ companyId }: { companyId: string }) {
  const [areas, setAreas] = useState<HaccpArea[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newDept, setNewDept] = useState("");
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [newName, setNewName] = useState("");
  const [newPin, setNewPin] = useState("");
  const [adding, setAdding] = useState(false);
  const [today] = useState(() => todayISO());
  const [closed, setClosed] = useState<HaccpClosedDay[]>([]);
  const [closeDay, setCloseDay] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [retention, setRetention] = useState<number>(24);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    const supabase = createClient();
    const [a, d, s, c, st] = await Promise.all([
      supabase
        .from("haccp_areas")
        .select("*")
        .eq("company_id", companyId)
        .order("sort_order")
        .order("name"),
      supabase
        .from("departments")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
      supabase.rpc("haccp_staff", { p_company_id: companyId }),
      supabase
        .from("haccp_closed_days")
        .select("*")
        .eq("company_id", companyId)
        .gte("day", addDaysISO(today, -60))
        .order("day"),
      supabase
        .from("haccp_settings")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);
    const err = a.error ?? d.error ?? s.error;
    if (err) setError(haccpError(err));
    setAreas((a.data as HaccpArea[]) ?? []);
    setDepts(d.data ?? []);
    setStaff((s.data as Staff[]) ?? []);
    setClosed((c.data as HaccpClosedDay[]) ?? []);
    setRetention(st.data?.retention_months ?? 24);
  }, [companyId, today]);

  useEffect(() => {
    // load() zet pas state na het ophalen (asynchroon), niet direct in het effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function run(
    p: PromiseLike<{ error: { message: string } | null }>,
    ok?: string,
  ) {
    setError(null);
    setNotice(null);
    const { error: err } = await p;
    if (err) setError(haccpError(err));
    else if (ok) setNotice(ok);
    await load();
    return !err;
  }

  async function move(index: number, dir: -1 | 1) {
    const list = [...areas];
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
    const supabase = createClient();
    setAreas(list);
    for (let i = 0; i < list.length; i++) {
      if (list[i].sort_order !== (i + 1) * 10) {
        await supabase
          .from("haccp_areas")
          .update({ sort_order: (i + 1) * 10 })
          .eq("id", list[i].id);
      }
    }
    await load();
  }

  async function addDept() {
    const name = newDept.trim();
    if (!name) return;
    const supabase = createClient();
    const [{ data: loc }, groupId] = await Promise.all([
      supabase
        .from("locations")
        .select("id")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("created_at")
        .limit(1),
      getCurrentGroupId(supabase),
    ]);
    const locationId = loc?.[0]?.id;
    if (!locationId || !groupId) {
      setError(
        "Dit bedrijf heeft nog geen vestiging; voeg die eerst toe bij Beheer → Bedrijven.",
      );
      return;
    }
    const ok = await run(
      supabase.from("departments").insert({
        company_id: companyId,
        location_id: locationId,
        group_id: groupId,
        name,
      }),
      `Afdeling "${name}" toegevoegd.`,
    );
    if (ok) setNewDept("");
  }

  async function addStaff() {
    setError(null);
    setNotice(null);
    setAdding(true);
    const res = await fetch("/api/haccp/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        fullName: newName.trim(),
        pin: newPin,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setAdding(false);
    if (!res.ok) {
      setError(json.error ?? "Toevoegen mislukt.");
      return;
    }
    setNotice(
      `${newName.trim()} is toegevoegd en kan nu op de tablet met de pincode werken.`,
    );
    setNewName("");
    setNewPin("");
    await load();
  }

  async function savePin(userId: string, value: string | null) {
    const ok = await run(
      createClient().rpc("haccp_set_pin", {
        p_company_id: companyId,
        p_user_id: userId,
        p_pin: value,
      }),
      value ? "Pincode opgeslagen." : "Pincode verwijderd.",
    );
    if (ok) {
      setPinFor(null);
      setPin("");
    }
  }

  async function setDayClosed(day: string, isClosed: boolean, reason?: string) {
    const ok = await run(
      createClient().rpc("haccp_set_closed_day", {
        p_company_id: companyId,
        p_day: day,
        p_closed: isClosed,
        p_reason: reason ?? null,
      }),
      isClosed
        ? `${formatDateNL(day)} staat als gesloten.`
        : `${formatDateNL(day)} is weer open.`,
    );
    if (ok && isClosed) {
      setCloseDay("");
      setCloseReason("");
    }
  }

  async function saveRetention(months: number) {
    setRetention(months);
    await run(
      createClient().from("haccp_settings").upsert({
        company_id: companyId,
        retention_months: months,
        updated_at: new Date().toISOString(),
      }),
      "Bewaartermijn opgeslagen.",
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-3 sm:p-6">
      {error && (
        <p className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md bg-teal/10 px-4 py-3 text-sm text-teal">
          {notice}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pincodes medewerkers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted">
            Op een gedeelde keukentablet kiest een medewerker zijn naam en tikt
            zijn pincode (4 cijfers). Afmeldingen worden dan op zijn naam
            vastgelegd. Heeft iemand geen e-mailadres, voeg hem dan hieronder
            toe met alleen een naam en pincode.
          </p>
          <ul className="divide-y divide-border">
            {staff.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                  {s.full_name}
                </span>
                <span
                  className={cn(
                    "text-xs",
                    s.has_pin ? "text-teal" : "text-muted",
                  )}
                >
                  {s.has_pin ? "pincode ingesteld" : "geen pincode"}
                </span>
                {pinFor === s.id ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void savePin(s.id, pin);
                    }}
                  >
                    <input
                      autoFocus
                      inputMode="numeric"
                      pattern="[0-9]{4}"
                      maxLength={4}
                      className={cn(
                        inputCls,
                        "w-24 text-center tracking-widest",
                      )}
                      value={pin}
                      onChange={(e) =>
                        setPin(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="••••"
                    />
                    <Button type="submit" size="sm" disabled={pin.length !== 4}>
                      Opslaan
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setPinFor(null)}
                    >
                      Annuleren
                    </Button>
                  </form>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setPinFor(s.id);
                        setPin("");
                      }}
                    >
                      <KeyRound className="h-4 w-4" />
                      {s.has_pin ? "Wijzigen" : "Instellen"}
                    </Button>
                    {s.has_pin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void savePin(s.id, null)}
                      >
                        Verwijderen
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <form
            className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void addStaff();
            }}
          >
            <span className="w-full text-sm font-medium text-foreground">
              Medewerker toevoegen (zonder e-mail)
            </span>
            <input
              className={cn(inputCls, "min-w-40 flex-1")}
              placeholder="Naam"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              inputMode="numeric"
              maxLength={4}
              className={cn(inputCls, "w-28 text-center tracking-widest")}
              placeholder="Pincode"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={adding || !newName.trim() || newPin.length !== 4}
            >
              {adding ? "Toevoegen…" : "Toevoegen"}
            </Button>
            <span className="w-full text-xs text-muted">
              Kan alleen op de tablet afmelden met naam en pincode; niet zelf
              inloggen.
            </span>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gesloten dagen</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted">
            Op een gesloten dag worden geen schoonmaaktaken gepland en
            verschijnt er niets als &quot;te laat&quot;. Taken die al zijn
            afgemeld blijven gewoon staan.
          </p>
          <form
            className="mb-3 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (closeDay) void setDayClosed(closeDay, true, closeReason);
            }}
          >
            <input
              type="date"
              className={inputCls}
              value={closeDay}
              onChange={(e) => setCloseDay(e.target.value)}
            />
            <input
              className={cn(inputCls, "min-w-40 flex-1")}
              placeholder="Reden (optioneel), bv. sluitingsdag"
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={!closeDay}>
              Gesloten zetten
            </Button>
            {!closed.some((c) => c.day === today) && (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  void setDayClosed(today, true, "Vandaag gesloten")
                }
              >
                Vandaag gesloten
              </Button>
            )}
          </form>
          {closed.length === 0 ? (
            <p className="text-sm text-muted">Geen gesloten dagen ingesteld.</p>
          ) : (
            <ul className="divide-y divide-border">
              {closed.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "flex items-center gap-3 py-2",
                    c.day < today && "opacity-60",
                  )}
                >
                  <span className="w-32 text-sm font-medium text-foreground">
                    {formatDateNL(c.day)}
                  </span>
                  <span className="flex-1 text-sm text-muted">{c.reason}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void setDayClosed(c.day, false)}
                  >
                    Toch open
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bewaartermijn registraties</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <select
              className={inputCls}
              value={retention}
              onChange={(e) => void saveRetention(Number(e.target.value))}
            >
              {[6, 12, 24, 36, 60, 84, 120].map((m) => (
                <option key={m} value={m}>
                  {m < 12 ? `${m} maanden` : `${m / 12} jaar`}
                </option>
              ))}
            </select>
            <span className="text-sm text-muted">minimaal bewaren</span>
          </div>
          <p className="mt-2 text-xs text-muted">
            KHN adviseert registraties minstens zes maanden te bewaren. Er wordt
            nooit automatisch iets verwijderd; opruimen na de termijn gebeurt
            alleen na jouw uitdrukkelijke bevestiging.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ruimtes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted">
            Volgorde bepaalt de volgorde op het scherm Vandaag. Een ruimte die
            uit staat verdwijnt uit de planning; de historie blijft bewaard.
          </p>
          <Link
            href="/haccp/qr"
            className="mb-3 inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-background"
          >
            <QrCode className="h-4 w-4" /> QR-codes per ruimte afdrukken
          </Link>
          {areas.length === 0 && (
            <p className="text-sm text-muted">
              Nog geen ruimtes — die ontstaan bij Schoonmaakplan.
            </p>
          )}
          <ul className="divide-y divide-border">
            {areas.map((a, i) => (
              <li
                key={a.id}
                className={cn(
                  "flex items-center gap-2 py-2",
                  !a.is_active && "opacity-50",
                )}
              >
                <div className="flex flex-col">
                  <button
                    onClick={() => void move(i, -1)}
                    disabled={i === 0}
                    className="text-muted disabled:opacity-20"
                    aria-label="Omhoog"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => void move(i, 1)}
                    disabled={i === areas.length - 1}
                    className="text-muted disabled:opacity-20"
                    aria-label="Omlaag"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
                {renaming?.id === a.id ? (
                  <form
                    className="flex flex-1 gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const name = renaming.name.trim();
                      if (!name) return;
                      if (
                        await run(
                          createClient()
                            .from("haccp_areas")
                            .update({ name })
                            .eq("id", a.id),
                        )
                      )
                        setRenaming(null);
                    }}
                  >
                    <input
                      autoFocus
                      className={cn(inputCls, "flex-1")}
                      value={renaming.name}
                      onChange={(e) =>
                        setRenaming({ id: a.id, name: e.target.value })
                      }
                    />
                    <Button type="submit" size="sm">
                      Opslaan
                    </Button>
                  </form>
                ) : (
                  <button
                    onClick={() => setRenaming({ id: a.id, name: a.name })}
                    className="flex-1 text-left text-sm font-medium text-foreground"
                  >
                    {a.name}
                    {!a.is_active && (
                      <span className="ml-2 text-xs text-muted">(uit)</span>
                    )}
                  </button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void run(
                      createClient()
                        .from("haccp_areas")
                        .update({ is_active: !a.is_active })
                        .eq("id", a.id),
                    )
                  }
                >
                  {a.is_active ? "Uitzetten" : "Aanzetten"}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Afdelingen (verantwoordelijke)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted">
            Bij elke taak kies je welke afdeling verantwoordelijk is. Op de
            tablet kan per afdeling worden gefilterd.
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            {depts.length === 0 && (
              <span className="text-sm text-muted">Nog geen afdelingen.</span>
            )}
            {depts.map((d) => (
              <span
                key={d.id}
                className="rounded-full border border-border bg-surface px-3 py-1 text-sm text-foreground"
              >
                {d.name}
              </span>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addDept();
            }}
          >
            <input
              className={cn(inputCls, "flex-1")}
              placeholder="Bijv. Keuken, Bediening, Afwas"
              value={newDept}
              onChange={(e) => setNewDept(e.target.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={!newDept.trim()}
            >
              Toevoegen
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

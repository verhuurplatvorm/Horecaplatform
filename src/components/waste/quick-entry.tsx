"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Check, Search, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { cn } from "@/lib/utils";
import type { ConsumptionType, Unit, WasteReason } from "@/lib/types/database";

interface Target {
  id: string;
  name: string;
  kind: "ingrediënt" | "halfproduct";
  baseUnitId: string | null;
}

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* geblokkeerde opslag mag het scherm niet breken */
  }
}

/**
 * Snelinvoer afval / personeelsmaaltijd voor de keukentablet:
 * bedrijf (altijd zichtbaar) → wie → wat → hoeveel → reden → opslaan.
 *
 * Het bedrijf wordt nooit stilzwijgend gekozen: met één bedrijf in beeld is
 * dat het; anders tikt de medewerker het bedrijf aan (onthouden per tablet).
 * Er wordt geen voorraadmutatie aangemaakt.
 */
export function WasteQuickEntry({
  preferredCompanyId,
  initialType = "afval",
  onSaved,
  onCancel,
}: {
  /** Bedrijf uit het filter van het overzicht (één bedrijf gekozen), anders null. */
  preferredCompanyId: string | null;
  initialType?: ConsumptionType;
  onSaved?: (info: { companyId: string; type: ConsumptionType }) => void;
  onCancel?: () => void;
}) {
  const { companies, activeCompanyIds, scope } = useCompanyScope();

  const [pickedCompany, setPickedCompany] = useState<string | null>(null);
  const [lastCompany] = useState<string | null>(() => readLocal<string | null>("afval:bedrijf", null));
  const companyId = useMemo(() => {
    const ok = (id: string | null) => (id && companies.some((c) => c.id === id) ? id : null);
    return (
      ok(pickedCompany) ??
      ok(preferredCompanyId) ??
      (scope.mode === "companies" && activeCompanyIds.length === 1 ? ok(activeCompanyIds[0]) : null) ??
      (companies.length === 1 ? companies[0].id : null) ??
      ok(lastCompany)
    );
  }, [pickedCompany, preferredCompanyId, scope.mode, activeCompanyIds, companies, lastCompany]);
  const companyName = companies.find((c) => c.id === companyId)?.name ?? null;

  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [staffId, setStaffId] = useState<string | null>(() => readLocal<string | null>("afval:medewerker-id", null));
  const [reasons, setReasons] = useState<WasteReason[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  const [regType, setRegType] = useState<ConsumptionType>(initialType);
  const [kind, setKind] = useState<"ingrediënt" | "halfproduct">("ingrediënt");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ q: string; list: Target[] }>({ q: "", list: [] });
  const [recent, setRecent] = useState<Target[]>(() => readLocal<Target[]>("afval:recent", []));
  const [selected, setSelected] = useState<Target | null>(null);

  const [quantity, setQuantity] = useState("");
  const [unitId, setUnitId] = useState("");
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const [value, setValue] = useState<{
    key: string;
    data: { unit_cost: number | null; waste_value: number | null } | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    void Promise.all([
      supabase.from("user_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
      supabase.from("waste_reasons").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("units").select("*").order("sort_order"),
    ]).then(([s, r, u]) => {
      if (cancelled) return;
      setStaff(s.data ?? []);
      setReasons((r.data as WasteReason[]) ?? []);
      setUnits((u.data as Unit[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Zoeken in de bestaande ingrediënten/halfproducten (resultaat per zoekterm).
  const term = query.trim();
  useEffect(() => {
    if (!term) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const supabase = createClient();
      const list: Target[] =
        kind === "ingrediënt"
          ? ((
              await supabase
                .from("products")
                .select("id, name, custom_name, base_unit_id")
                .ilike("name", `%${term}%`)
                .eq("is_active", true)
                .limit(12)
            ).data ?? []).map((p) => ({
              id: p.id,
              name: p.custom_name?.trim() || p.name,
              kind: "ingrediënt" as const,
              baseUnitId: p.base_unit_id,
            }))
          : ((
              await supabase
                .from("recipes")
                .select("id, name, base_unit_id")
                .eq("recipe_kind", "halfproduct")
                .ilike("name", `%${term}%`)
                .limit(12)
            ).data ?? []).map((r) => ({
              id: r.id,
              name: r.name,
              kind: "halfproduct" as const,
              baseUnitId: r.base_unit_id,
            }));
      if (!cancelled) setHits({ q: `${kind}:${term}`, list });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, kind]);
  const shownHits = term && hits.q === `${kind}:${term}` ? hits.list : [];

  // Waarde live, met de kostprijs van het gekozen bedrijf.
  const valueKey =
    selected && Number(quantity) > 0 && unitId
      ? `${selected.kind}:${selected.id}:${quantity}:${unitId}:${companyId ?? ""}`
      : null;
  useEffect(() => {
    if (!valueKey || !selected) return;
    let cancelled = false;
    void createClient()
      .rpc("calculate_waste_value", {
        p_product_id: selected.kind === "ingrediënt" ? selected.id : null,
        p_recipe_id: selected.kind === "halfproduct" ? selected.id : null,
        p_quantity: Number(quantity),
        p_unit_id: unitId,
        p_company_id: companyId,
      })
      .then(({ data }) => {
        if (!cancelled) setValue({ key: valueKey, data: data?.[0] ?? null });
      });
    return () => {
      cancelled = true;
    };
  }, [valueKey, selected, quantity, unitId, companyId]);
  const shownValue = valueKey && value?.key === valueKey ? value.data : null;

  function choose(t: Target) {
    setSelected(t);
    setUnitId(t.baseUnitId ?? "");
    setSaved(null);
    const next = [t, ...recent.filter((r) => r.id !== t.id)].slice(0, 6);
    setRecent(next);
    writeLocal("afval:recent", next);
  }

  function chooseCompany(id: string) {
    setPickedCompany(id);
    writeLocal("afval:bedrijf", id);
  }

  async function save() {
    if (!companyId) return setError("Kies eerst voor welk bedrijf je registreert.");
    if (!staffId) return setError("Kies eerst wie deze registratie doet.");
    if (!selected) return setError("Kies een ingrediënt of halfproduct.");
    if (!quantity.trim() || Number(quantity) <= 0) return setError("Vul een hoeveelheid in.");
    if (regType === "afval") {
      if (!reasonId) return setError("Kies een reden.");
      const chosen = reasons.find((r) => r.id === reasonId);
      if (chosen?.name.toLowerCase() === "anders" && !note.trim()) {
        return setError('Vul bij "Anders" een korte toelichting in.');
      }
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const groupId = await getCurrentGroupId(supabase);
    if (!groupId) {
      setSaving(false);
      return setError("Kan de groep niet bepalen.");
    }
    const { error: insertError } = await supabase.from("waste_registrations").insert({
      group_id: groupId,
      company_id: companyId,
      product_id: selected.kind === "ingrediënt" ? selected.id : null,
      recipe_id: selected.kind === "halfproduct" ? selected.id : null,
      quantity: Number(quantity),
      unit_id: unitId || null,
      registration_type: regType,
      reason_id: regType === "afval" ? reasonId : null,
      note: note.trim() || null,
      unit_cost: shownValue?.unit_cost ?? null,
      waste_value: shownValue?.waste_value ?? null,
      registered_by: staffId,
    });
    setSaving(false);
    if (insertError) return setError("Opslaan mislukt: " + insertError.message);

    writeLocal("afval:medewerker-id", staffId);
    writeLocal("afval:bedrijf", companyId);
    const unitName = units.find((u) => u.id === unitId)?.name ?? "";
    setSaved(
      `${quantity} ${unitName} ${selected.name} geregistreerd als ${
        regType === "afval" ? "afval" : "personeelsmaaltijd"
      } voor ${companyName}.`,
    );
    // Klaar voor de volgende registratie; bedrijf en medewerker blijven staan.
    setSelected(null);
    setQuery("");
    setQuantity("");
    setNote("");
    setReasonId(null);
    onSaved?.({ companyId, type: regType });
  }

  const isOther =
    regType === "afval" && reasons.find((r) => r.id === reasonId)?.name.toLowerCase() === "anders";
  const unitsForSelected = selected?.baseUnitId
    ? units.filter((u) => u.dimension === units.find((x) => x.id === selected.baseUnitId)?.dimension)
    : units;

  return (
    <Card className="border-teal/40">
      <CardContent className="space-y-4 pt-4">
        {/* Voor welk bedrijf — altijd zichtbaar */}
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-lg px-3 py-2",
            companyId ? "bg-navy text-white" : "bg-copper/10 text-copper",
          )}
        >
          <Building2 className="h-5 w-5 shrink-0" />
          <span className="mr-auto text-base">
            {companyId ? (
              <>
                Je registreert voor <strong>{companyName}</strong>
              </>
            ) : (
              <strong>Kies eerst het bedrijf</strong>
            )}
          </span>
          {companies.length > 1 &&
            companies.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => chooseCompany(c.id)}
                className={cn(
                  "h-10 rounded-full border px-4 text-sm font-medium",
                  c.id === companyId
                    ? "border-white bg-white text-navy"
                    : companyId
                      ? "border-white/40 text-white"
                      : "border-copper/40 bg-surface text-foreground",
                )}
              >
                {c.name}
              </button>
            ))}
        </div>

        <div className="flex gap-2">
          {(
            [
              ["afval", "Afval / derving"],
              ["personeelsmaaltijd", "Personeelsmaaltijd"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRegType(key)}
              className={cn(
                "h-12 flex-1 rounded-lg border px-4 text-sm",
                regType === key
                  ? "border-teal bg-teal/10 font-medium text-teal"
                  : "border-border bg-surface hover:bg-background",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div>
          <label className="mb-2 flex items-center gap-2 text-sm font-medium">
            <User className="h-4 w-4" /> Wie registreert dit?
          </label>
          <div className="flex flex-wrap gap-2">
            {staff.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStaffId(s.id)}
                className={cn(
                  "h-11 rounded-lg border px-4 text-sm",
                  staffId === s.id
                    ? "border-teal bg-teal/10 font-medium text-teal"
                    : "border-border hover:bg-background",
                )}
              >
                {s.full_name}
              </button>
            ))}
            {staff.length === 0 && <p className="text-sm text-muted">Nog geen medewerkers ingesteld.</p>}
          </div>
        </div>

        {!selected ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              {(["ingrediënt", "halfproduct"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "h-11 flex-1 rounded-lg border px-4 text-sm capitalize",
                    kind === k
                      ? "border-teal bg-teal/10 font-medium text-teal"
                      : "border-border hover:bg-background",
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSaved(null);
                }}
                placeholder={`Zoek een ${kind}…`}
                className="h-12 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-base"
              />
            </div>
            {!term && recent.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <span className="self-center text-xs uppercase tracking-wide text-muted">Recent</span>
                {recent.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => choose(r)}
                    className="h-10 rounded-lg border border-border px-3 text-sm hover:bg-background"
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            )}
            {shownHits.length > 0 && (
              <div className="divide-y divide-border rounded-md border border-border">
                {shownHits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => choose(h)}
                    className="block w-full truncate px-3 py-3 text-left text-base hover:bg-background"
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md bg-teal/5 px-3 py-2.5">
              <span className="font-medium">
                {selected.name}
                <span className="ml-2 text-xs font-normal text-muted">{selected.kind}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setQuery("");
                }}
                className="text-sm text-muted hover:text-foreground"
              >
                Anders kiezen
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Hoeveelheid</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  autoFocus
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="h-12 w-full rounded-md border border-border bg-surface px-3 text-base tabular"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Eenheid</label>
                <select
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value)}
                  className="h-12 w-full rounded-md border border-border bg-surface px-3 text-base"
                >
                  <option value="">Kies…</option>
                  {unitsForSelected.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {regType === "afval" && (
              <div>
                <label className="mb-1 block text-sm font-medium">Reden</label>
                <div className="flex flex-wrap gap-2">
                  {reasons.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setReasonId(r.id)}
                      className={cn(
                        "h-11 rounded-lg border px-3 text-sm",
                        reasonId === r.id
                          ? "border-teal bg-teal/10 font-medium text-teal"
                          : "border-border hover:bg-background",
                      )}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium">
                {isOther ? "Toelichting" : "Opmerking (optioneel)"}
              </label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  isOther
                    ? "Beschrijf kort wat er aan de hand was"
                    : regType === "personeelsmaaltijd"
                      ? "bv. lunch keukenbrigade"
                      : ""
                }
                className={cn("input", isOther && !note.trim() && "border-copper")}
              />
            </div>

            <p className="rounded-md bg-background p-3 text-sm">
              {shownValue?.waste_value != null ? (
                <>
                  Waarde:{" "}
                  <strong className="text-base text-danger">€ {shownValue.waste_value.toFixed(2)}</strong>
                </>
              ) : (
                <span className="text-muted">
                  {quantity.trim() && unitId
                    ? "Geen actuele kostprijs bekend — de registratie wordt zonder waarde opgeslagen."
                    : "Vul hoeveelheid en eenheid in om de waarde te zien."}
                </span>
              )}
            </p>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
        {saved && (
          <p className="flex items-center gap-2 rounded-md bg-teal/10 px-3 py-2 text-sm text-teal">
            <Check className="h-4 w-4" /> {saved}
          </p>
        )}

        {selected && (
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving || !companyId} className="h-12 flex-1 text-base">
              <Check className="h-5 w-5" />
              {saving
                ? "Opslaan…"
                : `${regType === "afval" ? "Afval" : "Maaltijd"} registreren${companyName ? ` voor ${companyName}` : ""}`}
            </Button>
            {onCancel && (
              <Button variant="secondary" onClick={onCancel} className="h-12">
                Annuleren
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

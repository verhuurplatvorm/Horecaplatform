"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Search, Trash2, User } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
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

/**
 * Afval registreren op een keukentablet: medewerker → product → hoeveelheid
 * → reden → opslaan. Grote knoppen, zo min mogelijk stappen.
 *
 * De waarde wordt berekend uit de bestaande kostprijzen en is zichtbaar
 * vóór het opslaan. Er wordt geen voorraadmutatie aangemaakt — afval is
 * hier puur een analyse van verspilling.
 */
export default function AfvalRegistrerenPage() {
  const router = useRouter();
  const { activeCompanyIds } = useCompanyScope();
  const companyId = activeCompanyIds[0] ?? null;

  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<WasteReason[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  // Wat leg je vast: weggegooid afval of een personeelsmaaltijd. Zelfde
  // vastlegging en waardering, maar apart geteld.
  const [regType, setRegType] = useState<ConsumptionType>("afval");
  const [kind, setKind] = useState<"ingrediënt" | "halfproduct">("ingrediënt");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Target[]>([]);
  const [recent, setRecent] = useState<Target[]>([]);
  const [selected, setSelected] = useState<Target | null>(null);

  const [quantity, setQuantity] = useState("");
  const [unitId, setUnitId] = useState("");
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const [value, setValue] = useState<{ unit_cost: number | null; waste_value: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stamgegevens en de laatst gebruikte medewerker/reden.
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("user_profiles")
      .select("id, full_name")
      .eq("is_active", true)
      .order("full_name")
      .then(({ data }) => setStaff(data ?? []));
    supabase
      .from("waste_reasons")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => setReasons((data as WasteReason[]) ?? []));
    supabase
      .from("units")
      .select("*")
      .order("sort_order")
      .then(({ data }) => setUnits((data as Unit[]) ?? []));
    try {
      setStaffId(localStorage.getItem("afval:medewerker"));
      const r = localStorage.getItem("afval:recent");
      if (r) setRecent(JSON.parse(r));
    } catch {
      /* geblokkeerde opslag mag het scherm niet breken */
    }
  }, []);

  // Zoeken in de bestaande ingrediënten/halfproducten.
  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const supabase = createClient();
      if (kind === "ingrediënt") {
        const { data } = await supabase
          .from("products")
          .select("id, name, custom_name, base_unit_id")
          .ilike("name", `%${query.trim()}%`)
          .eq("is_active", true)
          .limit(12);
        if (!cancelled) {
          setHits(
            (data ?? []).map((p) => ({
              id: p.id,
              name: p.custom_name?.trim() || p.name,
              kind: "ingrediënt" as const,
              baseUnitId: p.base_unit_id,
            }))
          );
        }
      } else {
        const { data } = await supabase
          .from("recipes")
          .select("id, name, base_unit_id")
          .eq("recipe_kind", "halfproduct")
          .ilike("name", `%${query.trim()}%`)
          .limit(12);
        if (!cancelled) {
          setHits(
            (data ?? []).map((r) => ({
              id: r.id,
              name: r.name,
              kind: "halfproduct" as const,
              baseUnitId: r.base_unit_id,
            }))
          );
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, kind]);

  // Waarde live berekenen zodra product, hoeveelheid en eenheid bekend zijn.
  useEffect(() => {
    if (!selected || !quantity.trim() || !unitId || Number(quantity) <= 0) {
      setValue(null);
      return;
    }
    let cancelled = false;
    createClient()
      .rpc("calculate_waste_value", {
        p_product_id: selected.kind === "ingrediënt" ? selected.id : null,
        p_recipe_id: selected.kind === "halfproduct" ? selected.id : null,
        p_quantity: Number(quantity),
        p_unit_id: unitId,
        p_company_id: companyId,
      })
      .then(({ data }) => {
        if (!cancelled) setValue(data?.[0] ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, quantity, unitId, companyId]);

  function choose(t: Target) {
    setSelected(t);
    setUnitId(t.baseUnitId ?? "");
    try {
      const next = [t, ...recent.filter((r) => r.id !== t.id)].slice(0, 6);
      setRecent(next);
      localStorage.setItem("afval:recent", JSON.stringify(next));
    } catch {
      /* niets aan te doen */
    }
  }

  async function save() {
    if (!staffId) return setError("Kies eerst wie deze registratie doet.");
    if (!selected) return setError("Kies een ingrediënt of halfproduct.");
    if (!quantity.trim() || Number(quantity) <= 0) return setError("Vul een hoeveelheid in.");
    if (regType === "afval") {
      if (!reasonId) return setError("Kies een reden.");
      const chosen = reasons.find((r) => r.id === reasonId);
      if (chosen?.name.toLowerCase() === "anders" && !note.trim()) {
        return setError("Vul bij \"Anders\" een korte toelichting in.");
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
      unit_cost: value?.unit_cost ?? null,
      waste_value: value?.waste_value ?? null,
      registered_by: staffId,
    });
    setSaving(false);
    if (insertError) return setError("Opslaan mislukt: " + insertError.message);

    try {
      localStorage.setItem("afval:medewerker", staffId);
    } catch {
      /* niets aan te doen */
    }
    router.push("/afval");
  }

  const isOther =
    regType === "afval" &&
    reasons.find((r) => r.id === reasonId)?.name.toLowerCase() === "anders";

  const unitsForSelected = selected?.baseUnitId
    ? units.filter(
        (u) => u.dimension === units.find((x) => x.id === selected.baseUnitId)?.dimension
      )
    : units;

  return (
    <>
      <Topbar title="Registreren" />
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        {/* Stap 0: wat leg je vast */}
        <div className="flex gap-2">
          {(
            [
              ["afval", "Afval / derving"],
              ["personeelsmaaltijd", "Personeelsmaaltijd"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRegType(key)}
              className={cn(
                "flex-1 rounded-lg border px-4 py-3 text-sm",
                regType === key
                  ? "border-teal bg-teal/10 font-medium text-teal"
                  : "border-border bg-surface hover:bg-background"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Stap 1: wie */}
        <Card>
          <CardContent className="pt-4">
            <label className="mb-2 flex items-center gap-2 text-sm font-medium">
              <User className="h-4 w-4" /> Wie registreert dit?
            </label>
            <div className="flex flex-wrap gap-2">
              {staff.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStaffId(s.id)}
                  className={cn(
                    "rounded-lg border px-4 py-2.5 text-sm",
                    staffId === s.id
                      ? "border-teal bg-teal/10 font-medium text-teal"
                      : "border-border hover:bg-background"
                  )}
                >
                  {s.full_name}
                </button>
              ))}
              {staff.length === 0 && (
                <p className="text-sm text-muted">Nog geen medewerkers ingesteld.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Stap 2: wat */}
        <Card>
          <CardContent className="space-y-3 pt-4">
            {!selected ? (
              <>
                <div className="flex gap-2">
                  {(["ingrediënt", "halfproduct"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => {
                        setKind(k);
                        setHits([]);
                      }}
                      className={cn(
                        "flex-1 rounded-lg border px-4 py-3 text-sm capitalize",
                        kind === k
                          ? "border-teal bg-teal/10 font-medium text-teal"
                          : "border-border hover:bg-background"
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
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Zoek een ${kind}…`}
                    className="h-12 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-base"
                  />
                </div>

                {hits.length === 0 && recent.length > 0 && !query.trim() && (
                  <>
                    <p className="text-xs uppercase tracking-wide text-muted">Recent</p>
                    <div className="flex flex-wrap gap-2">
                      {recent.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => choose(r)}
                          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-background"
                        >
                          {r.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className="divide-y divide-border rounded-md border border-border">
                  {hits.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => choose(h)}
                      className="block w-full truncate px-3 py-3 text-left text-base hover:bg-background"
                    >
                      {h.name}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between rounded-md bg-teal/5 px-3 py-2.5">
                <span className="font-medium">
                  {selected.name}
                  <span className="ml-2 text-xs font-normal text-muted">{selected.kind}</span>
                </span>
                <button
                  onClick={() => {
                    setSelected(null);
                    setQuery("");
                  }}
                  className="text-xs text-muted hover:text-foreground"
                >
                  Anders kiezen
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stap 3: hoeveel en waarom */}
        {selected && (
          <Card>
            <CardContent className="space-y-4 pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">Hoeveelheid</label>
                  <input
                    type="number"
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
                        onClick={() => setReasonId(r.id)}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-sm",
                          reasonId === r.id
                            ? "border-teal bg-teal/10 font-medium text-teal"
                            : "border-border hover:bg-background"
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
                {isOther && (
                  <p className="mt-1 text-xs text-copper">
                    Bij &quot;Anders&quot; is een toelichting verplicht — anders wordt deze
                    categorie een verzamelbak waar later niets meer uit te halen valt.
                  </p>
                )}
              </div>

              {/* Waarde vóór opslaan zichtbaar. */}
              <div className="rounded-md bg-background p-3">
                {value?.waste_value != null ? (
                  <p className="text-sm">
                    {quantity} {units.find((u) => u.id === unitId)?.name} ×{" "}
                    <span className="text-muted">
                      € {value.unit_cost?.toFixed(4)} per basiseenheid
                    </span>{" "}
                    ={" "}
                    <strong className="text-base text-danger">
                      € {value.waste_value.toFixed(2)}{" "}
                      {regType === "afval" ? "afvalwaarde" : "kosten personeelsmaaltijd"}
                    </strong>
                  </p>
                ) : (
                  <p className="text-sm text-muted">
                    {quantity.trim() && unitId
                      ? "Geen actuele kostprijs bekend — de registratie wordt zonder waarde opgeslagen."
                      : "Vul hoeveelheid en eenheid in om de afvalwaarde te zien."}
                  </p>
                )}
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}

              <div className="flex gap-2">
                <Button onClick={save} disabled={saving} className="h-12 flex-1 text-base">
                  <Check className="h-5 w-5" />
                  {saving
                    ? "Opslaan…"
                    : regType === "afval"
                      ? "Afval registreren"
                      : "Maaltijd registreren"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => router.push("/afval")}
                  className="h-12"
                >
                  Annuleren
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!selected && (
          <p className="flex items-center justify-center gap-2 text-sm text-muted">
            <Trash2 className="h-4 w-4" />
            Kies eerst een ingrediënt of halfproduct.
          </p>
        )}
      </main>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Printer, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { containerLabel, formatDistribution } from "@/lib/party/party-calc";

/** Eén rij uit get_event_menu_party_plan (centrale rekenregel in de database). */
export interface PartyPlanRow {
  line_id: string;
  recipe_id: string;
  recipe_name: string;
  section_name: string;
  container: string;
  capacity: number;
  capacity_unit: string | null;
  portion: number | null;
  quantity_per_person: number;
  participation_pct: number;
  needed: number;
  containers_exact: number;
  containers: number;
  full_containers: boolean;
  produced: number;
  last_container: number;
  difference: number;
  cost_per_container: number | null;
  total_cost: number | null;
  overproduction_cost: number | null;
  per_container: number;
  recipe_factor: number;
}

export function partyDistribution(p: PartyPlanRow): number[] {
  return Array.from({ length: p.containers }, (_, i) =>
    i === p.containers - 1 ? Number(p.last_container) : Number(p.capacity)
  );
}

interface WorkItem {
  /** recept + eenheid: lukt omrekenen niet, dan kan een recept twee regels hebben */
  key: string;
  recipeId: string;
  name: string;
  quantity: number;
  unitName: string | null;
  location: string;
  preparation: string | null;
  isHalfproduct: boolean;
}

/**
 * Productiewerklijst: wat moet er gemaakt worden voor dit menu, en
 * hoeveel. Klapt gerechten door naar de halfproducten die ze nodig
 * hebben, zodat de keuken één lijst heeft.
 *
 * Afvinken wordt per menu bewaard (tabel event_menu_work_done, migratie
 * 0139), zodat de stand na verversen blijft en elk scherm in de keuken
 * hetzelfde ziet. Een productie die je echt wilt vastleggen registreer je
 * op het halfproduct zelf — daar hoort ook de sticker bij.
 */
export function MenuWorkList({
  menuId,
  personCount,
  serviceDate,
  companyId,
}: {
  menuId: string;
  personCount: number;
  serviceDate: string | null;
  companyId: string | null;
}) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [party, setParty] = useState<PartyPlanRow[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);

  // Afgevinkte regels ophalen: bij openen en als je terugkomt op het
  // tabblad (een ander scherm kan intussen hebben afgevinkt).
  useEffect(() => {
    let cancelled = false;
    async function loadDone() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("event_menu_work_done")
        .select("item_key")
        .eq("menu_id", menuId);
      if (!cancelled && !error) setDone(new Set((data ?? []).map((r) => r.item_key)));
    }
    loadDone();
    const onFocus = () => {
      if (document.visibilityState === "visible") loadDone();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [menuId]);

  async function toggle(key: string) {
    const wasDone = done.has(key);
    setDone((prev) => {
      const next = new Set(prev);
      if (wasDone) next.delete(key);
      else next.add(key);
      return next;
    });
    const supabase = createClient();
    const { error } = wasDone
      ? await supabase
          .from("event_menu_work_done")
          .delete()
          .eq("menu_id", menuId)
          .eq("item_key", key)
      : await supabase
          .from("event_menu_work_done")
          .upsert({ menu_id: menuId, item_key: key }, { onConflict: "menu_id,item_key" });
    if (error) {
      // Terugdraaien, zodat het scherm niet iets anders laat zien dan er bewaard is.
      setSaveError(true);
      setDone((prev) => {
        const next = new Set(prev);
        if (wasDone) next.add(key);
        else next.delete(key);
        return next;
      });
    } else {
      setSaveError(false);
    }
  }

  async function clearAll() {
    if (done.size === 0) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("event_menu_work_done")
      .delete()
      .eq("menu_id", menuId);
    if (error) setSaveError(true);
    else {
      setSaveError(false);
      setDone(new Set());
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      const supabase = createClient();

      // Partijgerechten: aantal vormen en verdeling komen uit de database.
      const { data: planData } = companyId
        ? await supabase.rpc("get_event_menu_party_plan", {
            p_menu_id: menuId,
            p_company_id: companyId,
          })
        : { data: [] };
      const plans = ((planData ?? []) as PartyPlanRow[]).map((p) => ({
        ...p,
        capacity: Number(p.capacity),
        needed: Number(p.needed),
        produced: Number(p.produced),
        last_container: Number(p.last_container),
        difference: Number(p.difference),
        containers_exact: Number(p.containers_exact),
      }));
      if (!cancelled) setParty(plans);

      // Wat er gemaakt moet worden, inclusief alle halfproducten, rekent de
      // database uit (get_event_menu_production, migratie 0135). Die rekent
      // elke hoeveelheid om naar de eenheid van het recept: 40 ml ijs p.p.
      // wordt dus bollen, niet "6.800 stuk".
      const { data: work } = await supabase.rpc("get_event_menu_production", {
        p_menu_id: menuId,
      });
      const rows = work ?? [];
      if (rows.length === 0) {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
        return;
      }

      const recipeIds = [...new Set(rows.map((r) => r.recipe_id))];
      const [{ data: recipes }, { data: units }] = await Promise.all([
        supabase
          .from("recipes")
          .select("id, name, recipe_kind, preparation, production_location")
          .in("id", recipeIds),
        supabase.from("units").select("id, name"),
      ]);
      const unitName = new Map((units ?? []).map((u) => [u.id, u.name]));
      const recipeById = new Map((recipes ?? []).map((r) => [r.id, r]));

      const out: WorkItem[] = [];
      for (const row of rows) {
        const r = recipeById.get(row.recipe_id);
        if (!r) continue;
        out.push({
          key: `${row.recipe_id}:${row.unit_id ?? ""}`,
          recipeId: row.recipe_id,
          name: r.name,
          quantity: Number(row.quantity),
          unitName: row.unit_id ? unitName.get(row.unit_id) ?? null : null,
          location: r.production_location?.trim() || "Niet ingedeeld",
          preparation: r.preparation,
          isHalfproduct: r.recipe_kind === "halfproduct",
        });
      }

      if (!cancelled) {
        setItems(out.sort((a, b) => a.name.localeCompare(b.name, "nl")));
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [menuId, personCount, companyId]);

  const byLocation = new Map<string, WorkItem[]>();
  for (const i of items) {
    if (!byLocation.has(i.location)) byLocation.set(i.location, []);
    byLocation.get(i.location)!.push(i);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>
          Productiewerklijst
          {serviceDate && (
            <span className="ml-2 text-sm font-normal text-muted">
              voor {new Date(serviceDate).toLocaleDateString("nl-NL")}
            </span>
          )}
        </CardTitle>
        {(items.length > 0 || party.length > 0) && (
          <div className="flex items-center gap-2 print:hidden">
            {done.size > 0 && (
              <Button variant="secondary" size="sm" onClick={clearAll}>
                <RotateCcw className="h-3.5 w-3.5" />
                Vinkjes wissen
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
              Printen
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        {saveError && (
          <p className="px-5 text-sm text-danger">
            Vinkje kon niet worden opgeslagen. Controleer de verbinding en probeer het opnieuw.
          </p>
        )}
        {party.length > 0 && (
          <div>
            <p className="border-y border-border bg-background px-5 py-2 text-sm font-medium">
              Partijgerechten — productie per vorm
            </p>
            <ul className="divide-y divide-border">
              {party.map((p) => {
                const unit = p.capacity_unit ?? "";
                const fmt = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });
                return (
                  <li key={p.line_id} className="flex items-start gap-3 px-5 py-2.5">
                    <input
                      type="checkbox"
                      checked={done.has(p.line_id)}
                      onChange={() => toggle(p.line_id)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p className={cn("font-medium", done.has(p.line_id) && "text-muted line-through")}>
                        {p.recipe_name}
                        <span className="ml-2 text-xs font-normal text-muted">{p.section_name}</span>
                      </p>
                      <p className="text-xs text-muted">
                        {fmt(p.quantity_per_person)} {unit} p.p.
                        {Number(p.participation_pct) !== 100 && <> · {fmt(p.participation_pct)}% deelname</>} ·
                        netto {fmt(p.needed)} {unit} · verdeling{" "}
                        {formatDistribution(partyDistribution(p), unit)}
                        {p.difference > 0 && (
                          <>
                            {" "}
                            · {fmt(p.difference)} {unit} extra (volle {containerLabel(p.container, 2)})
                          </>
                        )}
                      </p>
                    </div>
                    <span className="tabular whitespace-nowrap font-medium">
                      {p.containers} {containerLabel(p.container, p.containers)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {items.length === 0 && party.length > 0 ? null : items.length === 0 ? (
          <p className="px-5 py-8 text-center text-muted">
            {loading
              ? "Werklijst samenstellen…"
              : "Nog niets te produceren — voeg gerechten of halfproducten toe."}
          </p>
        ) : (
          [...byLocation.entries()].map(([location, list]) => (
            <div key={location}>
              <p className="border-y border-border bg-background px-5 py-2 text-sm font-medium">
                {location}
                <span className="ml-2 text-xs font-normal text-muted">
                  {list.filter((i) => done.has(i.key)).length}/{list.length} gereed
                </span>
              </p>
              <ul className="divide-y divide-border">
                {list.map((i) => (
                  <li key={i.key} className="flex items-start gap-3 px-5 py-2.5">
                    <input
                      type="checkbox"
                      checked={done.has(i.key)}
                      onChange={() => toggle(i.key)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "font-medium",
                          done.has(i.key) && "text-muted line-through"
                        )}
                      >
                        {i.name}
                        <span className="ml-2 text-xs font-normal text-muted">
                          {i.isHalfproduct ? "halfproduct" : "gerecht"}
                        </span>
                      </p>
                      {i.preparation && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted">
                          {i.preparation}
                        </p>
                      )}
                    </div>
                    <span className="tabular whitespace-nowrap font-medium">
                      {i.quantity.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}{" "}
                      {i.unitName}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

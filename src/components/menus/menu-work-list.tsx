"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
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
 * Afvinken gebeurt lokaal in de browser: het is een werklijst voor de
 * dag, geen administratie. Een productie die je echt wilt vastleggen
 * registreer je op het halfproduct zelf — daar hoort ook de sticker bij.
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

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      const supabase = createClient();

      const { data: lines } = await supabase
        .from("event_menu_lines")
        .select("id, recipe_id, quantity_per_person, unit_id, is_fixed, participation_pct")
        .eq("menu_id", menuId)
        .not("recipe_id", "is", null);
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
      const planByLine = new Map(plans.map((p) => [p.line_id, p]));
      if (!cancelled) setParty(plans);
      if (!lines || lines.length === 0) {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
        return;
      }

      const recipeIds = [...new Set(lines.map((l) => l.recipe_id).filter(Boolean))] as string[];
      const [{ data: recipes }, { data: units }] = await Promise.all([
        supabase
          .from("recipes")
          .select(
            "id, name, recipe_kind, yield_quantity, base_unit_id, preparation, production_location"
          )
          .in("id", recipeIds),
        supabase.from("units").select("id, name"),
      ]);
      const unitName = new Map((units ?? []).map((u) => [u.id, u.name]));
      const recipeById = new Map((recipes ?? []).map((r) => [r.id, r]));

      // Benodigde hoeveelheid per recept optellen. Partijgerechten staan
      // apart (per vorm); hun halfproducten gaan wél mee in deze lijst.
      const needed = new Map<string, number>();
      const partyFactor = new Map<string, number>();
      for (const l of lines) {
        if (!l.recipe_id) continue;
        const plan = planByLine.get(l.id);
        if (plan) {
          const f = Number(plan.recipe_factor);
          partyFactor.set(l.recipe_id, (partyFactor.get(l.recipe_id) ?? 0) + f);
          continue;
        }
        const pct = l.is_fixed ? 100 : Number(l.participation_pct ?? 100);
        const qty = (l.quantity_per_person * (l.is_fixed ? 1 : personCount) * pct) / 100;
        needed.set(l.recipe_id, (needed.get(l.recipe_id) ?? 0) + qty);
      }

      // Halfproducten die deze gerechten nodig hebben, erbij.
      const subNeeded = new Map<string, number>();
      const factors: [string, number][] = [];
      for (const [recipeId, qty] of needed) {
        const r = recipeById.get(recipeId);
        if (!r?.yield_quantity || r.yield_quantity <= 0) continue;
        factors.push([recipeId, qty / r.yield_quantity]);
      }
      for (const [recipeId, f] of partyFactor) factors.push([recipeId, f]);
      for (const [recipeId, factor] of factors) {
        const { data: subs } = await supabase
          .from("recipe_ingredients")
          .select("sub_recipe_id, quantity")
          .eq("recipe_id", recipeId)
          .not("sub_recipe_id", "is", null);
        for (const s of subs ?? []) {
          if (!s.sub_recipe_id) continue;
          subNeeded.set(
            s.sub_recipe_id,
            (subNeeded.get(s.sub_recipe_id) ?? 0) + s.quantity * factor
          );
        }
      }

      const subIds = [...subNeeded.keys()].filter((id) => !recipeById.has(id));
      if (subIds.length) {
        const { data: subRecipes } = await supabase
          .from("recipes")
          .select(
            "id, name, recipe_kind, yield_quantity, base_unit_id, preparation, production_location"
          )
          .in("id", subIds);
        for (const r of subRecipes ?? []) recipeById.set(r.id, r);
      }

      const all = new Map<string, number>(needed);
      for (const [id, qty] of subNeeded) all.set(id, (all.get(id) ?? 0) + qty);

      const out: WorkItem[] = [];
      for (const [id, qty] of all) {
        const r = recipeById.get(id);
        if (!r) continue;
        out.push({
          recipeId: id,
          name: r.name,
          quantity: qty,
          unitName: r.base_unit_id ? unitName.get(r.base_unit_id) ?? null : null,
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
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Printen
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 p-0">
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
                      onChange={() =>
                        setDone((prev) => {
                          const next = new Set(prev);
                          if (next.has(p.line_id)) next.delete(p.line_id);
                          else next.add(p.line_id);
                          return next;
                        })
                      }
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
                  {list.filter((i) => done.has(i.recipeId)).length}/{list.length} gereed
                </span>
              </p>
              <ul className="divide-y divide-border">
                {list.map((i) => (
                  <li key={i.recipeId} className="flex items-start gap-3 px-5 py-2.5">
                    <input
                      type="checkbox"
                      checked={done.has(i.recipeId)}
                      onChange={() =>
                        setDone((prev) => {
                          const next = new Set(prev);
                          if (next.has(i.recipeId)) next.delete(i.recipeId);
                          else next.add(i.recipeId);
                          return next;
                        })
                      }
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "font-medium",
                          done.has(i.recipeId) && "text-muted line-through"
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

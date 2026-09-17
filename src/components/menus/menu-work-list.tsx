"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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
}: {
  menuId: string;
  personCount: number;
  serviceDate: string | null;
}) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      const supabase = createClient();

      const { data: lines } = await supabase
        .from("event_menu_lines")
        .select("recipe_id, quantity_per_person, unit_id, is_fixed")
        .eq("menu_id", menuId)
        .not("recipe_id", "is", null);
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

      // Benodigde hoeveelheid per recept optellen.
      const needed = new Map<string, number>();
      for (const l of lines) {
        if (!l.recipe_id) continue;
        const qty = l.quantity_per_person * (l.is_fixed ? 1 : personCount);
        needed.set(l.recipe_id, (needed.get(l.recipe_id) ?? 0) + qty);
      }

      // Halfproducten die deze gerechten nodig hebben, erbij.
      const subNeeded = new Map<string, number>();
      for (const [recipeId, qty] of needed) {
        const r = recipeById.get(recipeId);
        if (!r?.yield_quantity || r.yield_quantity <= 0) continue;
        const factor = qty / r.yield_quantity;
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
  }, [menuId, personCount]);

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
        {items.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Printen
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        {items.length === 0 ? (
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

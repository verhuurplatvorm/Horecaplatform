"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import type { StockMovement, Recipe } from "@/lib/types/database";

export default function ProductiesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: recipeId } = use(params);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [labelCounts, setLabelCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const [{ data: r }, { data: m }] = await Promise.all([
        supabase.from("recipes").select("*").eq("id", recipeId).single(),
        supabase
          .from("stock_movements")
          .select("*")
          .eq("recipe_id", recipeId)
          .eq("movement_type", "productie")
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setRecipe(r as Recipe);
      const movs = (m as StockMovement[]) ?? [];
      setMovements(movs);

      if (movs.length > 0) {
        const { data: labels } = await supabase
          .from("production_labels")
          .select("stock_movement_id")
          .in("stock_movement_id", movs.map((mv) => mv.id));
        const counts = new Map<string, number>();
        for (const l of labels ?? []) {
          counts.set(l.stock_movement_id, (counts.get(l.stock_movement_id) ?? 0) + 1);
        }
        setLabelCounts(counts);
      }
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  return (
    <>
      <Topbar title={`Producties — ${recipe?.name ?? ""}`} />
      <main className="p-6 space-y-4">
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Datum</th>
                  <th className="px-5 py-3 font-medium">Hoeveelheid</th>
                  <th className="px-5 py-3 font-medium">Batchnummer</th>
                  <th className="px-5 py-3 font-medium">Stickers afgedrukt</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="px-5 py-3">
                      {new Date(m.created_at).toLocaleString("nl-NL")}
                    </td>
                    <td className="px-5 py-3 tabular">{m.quantity_change}</td>
                    <td className="px-5 py-3">{m.batch_number ?? "—"}</td>
                    <td className="px-5 py-3 tabular">{labelCounts.get(m.id) ?? 0}</td>
                    <td className="px-5 py-3">
                      <Link href={`/halfproducten/${recipeId}/sticker/nieuw?movementId=${m.id}`}>
                        <Button size="sm" variant="secondary">
                          <Printer className="h-3.5 w-3.5" />
                          {(labelCounts.get(m.id) ?? 0) > 0 ? "Opnieuw afdrukken" : "Sticker afdrukken"}
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
                {movements.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-muted">
                      Nog geen producties geregistreerd voor dit halfproduct.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Download, Save } from "lucide-react";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Vaste balk boven het halfproductscherm: wat een kok als eerste wil zien
 * (naam, map, status, kostprijs per basiseenheid) plus de acties die bij
 * het hele halfproduct horen.
 *
 * De opslaan-knop stuurt het bestaande formulier aan via het form-attribuut
 * — er is dus geen tweede opslag-logica, en de knop onderaan het formulier
 * blijft gewoon werken.
 */
export function HalfproductHeader({
  recipeId,
  name,
  folderName,
  status,
  yieldQuantity,
  baseUnitName,
}: {
  recipeId: string;
  name: string;
  folderName: string | null;
  status: string;
  yieldQuantity: number | null;
  baseUnitName: string | null;
}) {
  const router = useRouter();
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const { can } = usePermissions();
  const canViewFinancial = can("halfproducten").canViewFinancial;

  const [costPerUnit, setCostPerUnit] = useState<number | null>(null);
  const [neighbours, setNeighbours] = useState<{ prev: string | null; next: string | null }>({
    prev: null,
    next: null,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();

      if (canViewFinancial && referenceCompanyId && yieldQuantity && yieldQuantity > 0) {
        const { data } = await supabase.rpc("calculate_recipe_cost", {
          p_recipe_id: recipeId,
          p_company_id: referenceCompanyId,
        });
        if (!cancelled && typeof data === "number") {
          setCostPerUnit(data / yieldQuantity);
        }
      }

      // Vorige/volgende halfproduct op alfabetische volgorde.
      const { data: all } = await supabase
        .from("recipes")
        .select("id, name")
        .eq("recipe_kind", "halfproduct")
        .order("name");
      if (!cancelled && all) {
        const i = all.findIndex((r) => r.id === recipeId);
        setNeighbours({
          prev: i > 0 ? all[i - 1].id : null,
          next: i >= 0 && i < all.length - 1 ? all[i + 1].id : null,
        });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [recipeId, referenceCompanyId, canViewFinancial, yieldQuantity]);

  /** Kopie met eigen ingrediëntregels; opent meteen de kopie. */
  async function duplicate() {
    setBusy(true);
    const supabase = createClient();
    const { data: original } = await supabase
      .from("recipes")
      .select("*")
      .eq("id", recipeId)
      .single();
    if (!original) {
      setBusy(false);
      window.alert("Kan dit halfproduct niet kopiëren.");
      return;
    }
    const { data: lines } = await supabase
      .from("recipe_ingredients")
      .select("*")
      .eq("recipe_id", recipeId);

    const {
      id: _id,
      created_at: _c,
      updated_at: _u,
      version: _v,
      ...rest
    } = original;
    void _id;
    void _c;
    void _u;
    void _v;

    const { data: created, error } = await supabase
      .from("recipes")
      .insert({ ...rest, name: `${original.name} (kopie)`, status: "concept" })
      .select("id")
      .single();
    if (error || !created) {
      setBusy(false);
      window.alert("Kopiëren mislukt: " + (error?.message ?? "onbekende fout"));
      return;
    }
    if (lines?.length) {
      await supabase.from("recipe_ingredients").insert(
        lines.map((l) => {
          const { id: _lid, ...lrest } = l;
          void _lid;
          return { ...lrest, recipe_id: created.id };
        })
      );
    }
    router.push(`/halfproducten/${created.id}/bewerken`);
  }

  /** Receptuur als CSV, bruikbaar in Excel. */
  async function exportCsv() {
    const supabase = createClient();
    const { data: breakdown } = await supabase.rpc("get_recipe_cost_breakdown", {
      p_recipe_id: recipeId,
      p_company_id: referenceCompanyId,
    });
    const rows = (breakdown as
      | { ingredient_name: string | null; quantity: number; unit_name: string | null; line_cost: number | null }[]
      | null) ?? [];

    const header = ["Ingrediënt", "Hoeveelheid", "Eenheid"];
    if (canViewFinancial) header.push("Kostprijs");
    const lines = rows.map((r) => {
      const base = [r.ingredient_name ?? "", String(r.quantity), r.unit_name ?? ""];
      if (canViewFinancial) base.push(r.line_cost?.toFixed(4) ?? "");
      return base;
    });
    const csv = [[`Halfproduct: ${name}`], [], header, ...lines]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^\w\- ]/g, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="sticky top-0 z-30 -mx-6 border-b border-border bg-background px-6 pb-3 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold text-foreground">{name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>{folderName ?? "zonder map"}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5",
                status === "goedgekeurd"
                  ? "bg-success/10 text-success"
                  : status === "vervallen"
                    ? "bg-muted/10 text-muted"
                    : "bg-copper/10 text-copper"
              )}
            >
              {status === "goedgekeurd"
                ? "actief"
                : status === "vervallen"
                  ? "gearchiveerd"
                  : "concept"}
            </span>
            {canViewFinancial && costPerUnit !== null && baseUnitName && (
              <span className="font-medium text-foreground">
                € {costPerUnit.toFixed(4)} per {baseUnitName}
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="submit"
            form="recipe-form"
            className="flex items-center gap-1.5 rounded-md bg-teal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            <Save className="h-3.5 w-3.5" />
            Opslaan
          </button>
          <button
            type="button"
            onClick={duplicate}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-surface"
          >
            <Copy className="h-3.5 w-3.5" />
            Dupliceren
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-surface"
          >
            <Download className="h-3.5 w-3.5" />
            Exporteren
          </button>
          {neighbours.prev ? (
            <Link
              href={`/halfproducten/${neighbours.prev}/bewerken`}
              title="Vorige halfproduct"
              className="rounded-md border border-border p-1.5 hover:bg-surface"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
          ) : (
            <span className="rounded-md border border-border p-1.5 opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </span>
          )}
          {neighbours.next ? (
            <Link
              href={`/halfproducten/${neighbours.next}/bewerken`}
              title="Volgende halfproduct"
              className="rounded-md border border-border p-1.5 hover:bg-surface"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span className="rounded-md border border-border p-1.5 opacity-30">
              <ChevronRight className="h-4 w-4" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

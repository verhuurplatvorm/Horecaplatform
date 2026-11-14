import Link from "next/link";
import {
  BookOpen,
  Clock,
  CookingPot,
  MapPin,
  Package,
  Snowflake,
  Utensils,
} from "lucide-react";
import { StickerQuickButton } from "@/components/stickers/sticker-quick-button";
import { createClient } from "@/lib/supabase/server";
import { formatAmount } from "@/lib/units/format";
import type { Recipe, RecipeIngredient } from "@/lib/types/database";

/**
 * Alleen-lezen weergave van een gerecht of halfproduct (Operator).
 * Geen bewerkvelden, geen knoppen om iets te wijzigen, geen kostprijzen.
 */
export async function RecipeReadOnly({
  recipe,
  ingredients,
}: {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
}) {
  const supabase = await createClient();
  const productIds = ingredients
    .map((l) => l.product_id)
    .filter((x): x is string => Boolean(x));
  const subIds = ingredients
    .map((l) => l.sub_recipe_id)
    .filter((x): x is string => Boolean(x));
  const [
    { data: products },
    { data: subs },
    { data: units },
    { data: allergens },
    station,
  ] = await Promise.all([
    productIds.length
      ? supabase
          .from("products")
          .select("id, name, custom_name")
          .in("id", productIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            name: string;
            custom_name: string | null;
          }[],
        }),
    subIds.length
      ? supabase
          .from("recipes")
          .select("id, name, recipe_kind")
          .in("id", subIds)
      : Promise.resolve({
          data: [] as { id: string; name: string; recipe_kind: string }[],
        }),
    supabase.from("units").select("id, name"),
    supabase.rpc("calculate_recipe_allergens", { p_recipe_id: recipe.id }),
    recipe.station_id
      ? supabase
          .from("kitchen_stations")
          .select("name")
          .eq("id", recipe.station_id)
          .maybeSingle()
      : Promise.resolve({ data: null as { name: string } | null }),
  ]);
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const subById = new Map((subs ?? []).map((r) => [r.id, r]));
  const unitById = new Map((units ?? []).map((u) => [u.id, u.name as string]));
  const baseUnit = recipe.base_unit_id
    ? (unitById.get(recipe.base_unit_id) ?? null)
    : null;
  const isHalf = recipe.recipe_kind === "halfproduct";
  const bevat = (allergens as { bevat?: string[] } | null)?.bevat ?? [];
  const sporen = (allergens as { sporen?: string[] } | null)?.sporen ?? [];

  const facts: { icon: typeof Clock; label: string; value: string }[] = [];
  if (recipe.yield_quantity && baseUnit)
    facts.push({
      icon: Utensils,
      label: "Opbrengst",
      value: formatAmount(recipe.yield_quantity, baseUnit),
    });
  if (recipe.storage_method)
    facts.push({
      icon: Snowflake,
      label: "Bewaren",
      value: recipe.storage_method,
    });
  if (recipe.shelf_life_days)
    facts.push({
      icon: Clock,
      label: "Houdbaar",
      value: `${recipe.shelf_life_days} dagen`,
    });
  if (recipe.production_location)
    facts.push({
      icon: MapPin,
      label: "Productie",
      value: recipe.production_location,
    });
  if (station.data?.name)
    facts.push({ icon: MapPin, label: "Partie", value: station.data.name });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
            {isHalf ? (
              <CookingPot className="h-4 w-4" />
            ) : (
              <BookOpen className="h-4 w-4" />
            )}
            {isHalf ? "Halfproduct" : "Gerecht"}
            {recipe.category ? ` · ${recipe.category}` : ""}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">
            {recipe.name}
          </h2>
        </div>
        <StickerQuickButton recipeId={recipe.id} big />
      </div>

      {facts.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {facts.map((f) => (
            <div
              key={f.label}
              className="rounded-lg border border-border bg-surface p-3"
            >
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <f.icon className="h-3.5 w-3.5" />
                {f.label}
              </p>
              <p className="mt-0.5 font-medium text-foreground">{f.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-border bg-surface">
          <h3 className="border-b border-border px-4 py-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Ingrediënten
          </h3>
          <ul className="divide-y divide-border">
            {ingredients.map((l) => {
              const p = l.product_id ? productById.get(l.product_id) : null;
              const sub = l.sub_recipe_id ? subById.get(l.sub_recipe_id) : null;
              const name = p
                ? p.custom_name?.trim() || p.name
                : (sub?.name ?? l.unmatched_name ?? "—");
              const unit = l.unit_id
                ? (unitById.get(l.unit_id) ?? l.unit)
                : l.unit;
              const href = p
                ? `/producten/${p.id}/bewerken`
                : sub
                  ? sub.recipe_kind === "halfproduct"
                    ? `/halfproducten/${sub.id}/bewerken`
                    : `/recepturen/${sub.id}/bewerken`
                  : null;
              return (
                <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-28 shrink-0 text-right font-semibold tabular text-foreground">
                    {formatAmount(Number(l.quantity), unit)}
                  </span>
                  <span className="min-w-0 flex-1">
                    {href ? (
                      <Link
                        href={href}
                        className="font-medium text-foreground hover:text-teal"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">
                        {name}
                      </span>
                    )}
                    {l.preparation && (
                      <span className="ml-1 text-muted">({l.preparation})</span>
                    )}
                    {l.note && (
                      <span className="block text-xs text-muted">{l.note}</span>
                    )}
                  </span>
                  {sub ? (
                    <CookingPot
                      className="h-4 w-4 shrink-0 text-teal"
                      aria-label="Halfproduct"
                    />
                  ) : p ? (
                    <Package
                      className="h-4 w-4 shrink-0 text-muted"
                      aria-label="Ingrediënt"
                    />
                  ) : null}
                </li>
              );
            })}
            {ingredients.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted">
                Geen ingrediënten.
              </li>
            )}
          </ul>
        </section>

        <div className="space-y-4">
          {recipe.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={recipe.photo_url}
              alt={recipe.name}
              className="max-h-80 w-full rounded-lg border border-border object-cover"
            />
          )}
          <section className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
              Bereiding
            </h3>
            <p className="whitespace-pre-wrap text-foreground">
              {recipe.preparation?.trim() || (
                <span className="text-muted">Geen bereiding vastgelegd.</span>
              )}
            </p>
          </section>
          {recipe.plating_instructions?.trim() && (
            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                Opmaak
              </h3>
              <p className="whitespace-pre-wrap text-foreground">
                {recipe.plating_instructions}
              </p>
            </section>
          )}
          {(bevat.length > 0 || sporen.length > 0) && (
            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                Allergenen
              </h3>
              {bevat.length > 0 && (
                <p className="text-foreground">
                  <strong>Bevat:</strong> {bevat.join(", ")}
                </p>
              )}
              {sporen.length > 0 && (
                <p className="text-muted">
                  <strong>Sporen:</strong> {sporen.join(", ")}
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

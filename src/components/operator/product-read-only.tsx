import { Package } from "lucide-react";
import { StickerQuickButton } from "@/components/stickers/sticker-quick-button";
import { createClient } from "@/lib/supabase/server";
import { formatAmount } from "@/lib/units/format";
import type { Product, ProductPackaging } from "@/lib/types/database";

/**
 * Alleen-lezen weergave van een ingrediënt (Operator): geen bewerkvelden,
 * geen prijzen.
 */
export async function ProductReadOnly({
  product,
  packagings,
  baseUnitName,
  supplierName,
}: {
  product: Product;
  packagings: ProductPackaging[];
  baseUnitName: string | null;
  supplierName: string | null;
}) {
  const supabase = await createClient();
  const { data: used } = await supabase
    .from("recipe_ingredients")
    .select("recipe_id, recipes(id, name, recipe_kind)")
    .eq("product_id", product.id)
    .limit(50);
  const usedIn = new Map<string, { id: string; name: string; kind: string }>();
  for (const u of (used ?? []) as unknown as {
    recipes: { id: string; name: string; recipe_kind: string } | null;
  }[]) {
    if (u.recipes)
      usedIn.set(u.recipes.id, {
        id: u.recipes.id,
        name: u.recipes.name,
        kind: u.recipes.recipe_kind,
      });
  }
  const name = product.custom_name?.trim() || product.name;
  const facts: { label: string; value: string }[] = [];
  if (baseUnitName) facts.push({ label: "Eenheid", value: baseUnitName });
  if (supplierName) facts.push({ label: "Leverancier", value: supplierName });
  if (product.brand) facts.push({ label: "Merk", value: product.brand });
  if (product.article_number)
    facts.push({ label: "Artikelnummer", value: product.article_number });
  if (product.storage_location)
    facts.push({ label: "Opslag", value: product.storage_location });
  if (product.avg_unit_quantity && baseUnitName === "stuk")
    facts.push({
      label: "Gewicht per stuk",
      value: `± ${product.avg_unit_quantity}`,
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
            <Package className="h-4 w-4" />
            Ingrediënt
            {product.product_group ? ` · ${product.product_group}` : ""}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">
            {name}
          </h2>
          {product.custom_name?.trim() &&
            product.custom_name.trim() !== product.name && (
              <p className="text-sm text-muted">{product.name}</p>
            )}
        </div>
        <StickerQuickButton productId={product.id} big />
      </div>

      {facts.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {facts.map((f) => (
            <div
              key={f.label}
              className="rounded-lg border border-border bg-surface p-3"
            >
              <p className="text-xs text-muted">{f.label}</p>
              <p className="mt-0.5 font-medium text-foreground">{f.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {product.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt={name}
              className="max-h-72 w-full rounded-lg border border-border object-contain"
            />
          )}
          {packagings.length > 0 && (
            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                Verpakking
              </h3>
              <ul className="space-y-1">
                {packagings.map((p) => (
                  <li key={p.id} className="text-foreground">
                    {p.name}
                    {baseUnitName && (
                      <span className="text-muted">
                        {" "}
                        ={" "}
                        {formatAmount(
                          Number(p.quantity_in_base_unit),
                          baseUnitName,
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {product.description?.trim() && (
            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                Omschrijving
              </h3>
              <p className="whitespace-pre-wrap text-foreground">
                {product.description}
              </p>
            </section>
          )}
          {((product.allergens ?? []).length > 0 ||
            (product.contains_traces ?? []).length > 0) && (
            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                Allergenen
              </h3>
              {(product.allergens ?? []).length > 0 && (
                <p>
                  <strong>Bevat:</strong> {(product.allergens ?? []).join(", ")}
                </p>
              )}
              {(product.contains_traces ?? []).length > 0 && (
                <p className="text-muted">
                  <strong>Sporen:</strong>{" "}
                  {(product.contains_traces ?? []).join(", ")}
                </p>
              )}
            </section>
          )}
        </div>
        <section className="rounded-lg border border-border bg-surface">
          <h3 className="border-b border-border px-4 py-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Gebruikt in
          </h3>
          <ul className="divide-y divide-border">
            {[...usedIn.values()]
              .sort((a, b) => a.name.localeCompare(b.name, "nl"))
              .map((r) => (
                <li key={r.id}>
                  <a
                    href={
                      r.kind === "halfproduct"
                        ? `/halfproducten/${r.id}/bewerken`
                        : `/recepturen/${r.id}/bewerken`
                    }
                    className="flex items-center justify-between px-4 py-3 hover:bg-background"
                  >
                    <span className="font-medium text-foreground">
                      {r.name}
                    </span>
                    <span className="text-xs text-muted">
                      {r.kind === "halfproduct" ? "Halfproduct" : "Gerecht"}
                    </span>
                  </a>
                </li>
              ))}
            {usedIn.size === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted">
                Nergens gebruikt.
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

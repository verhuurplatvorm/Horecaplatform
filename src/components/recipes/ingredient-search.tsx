"use client";

import { useEffect, useState } from "react";
import { Package, Search, SoupIcon } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ProductForm } from "@/components/products/product-form";
import { HalfproductQuickForm } from "@/components/recipes/halfproduct-quick-form";
import { createClient } from "@/lib/supabase/client";
import type { Product, Recipe } from "@/lib/types/database";

export interface PickedIngredient {
  type: "product" | "halfproduct";
  id: string;
  name: string;
  baseUnitId: string | null;
  yieldQuantity?: number | null;
  yieldUnit?: string | null;
}

interface SearchResult {
  type: "product" | "halfproduct";
  id: string;
  name: string;
  customName?: string | null;
  baseUnitId: string | null;
  category: string | null;
  yieldQuantity?: number | null;
  yieldUnit?: string | null;
}

export function IngredientSearch({
  companyId,
  onPick,
}: {
  companyId: string | null;
  onPick: (picked: PickedIngredient) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [priceByProduct, setPriceByProduct] = useState<Map<string, number>>(
    new Map()
  );
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [creatingHalfproduct, setCreatingHalfproduct] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) return;
    let cancelled = false;

    const timeout = setTimeout(async () => {
      const supabase = createClient();
      const [{ data: products }, { data: halfproducts }] = await Promise.all([
        supabase
          .from("products")
          .select("id, name, custom_name, base_unit_id, product_group")
          .or(`name.ilike.%${query}%,custom_name.ilike.%${query}%`)
          .limit(8),
        supabase
          .from("recipes")
          .select("id, name, base_unit_id, category, yield_quantity, yield_unit")
          .eq("recipe_kind", "halfproduct")
          .ilike("name", `%${query}%`)
          .limit(8),
      ]);
      if (cancelled) return;

      const merged: SearchResult[] = [
        ...((products as (Product & { product_group: string | null })[]) ?? []).map(
          (p) => ({
            type: "product" as const,
            id: p.id,
            name: p.name,
            customName: p.custom_name,
            baseUnitId: p.base_unit_id,
            category: p.product_group,
          })
        ),
        ...((halfproducts as Recipe[]) ?? []).map((r) => ({
          type: "halfproduct" as const,
          id: r.id,
          name: r.name,
          baseUnitId: r.base_unit_id,
          category: r.category,
          yieldQuantity: r.yield_quantity,
          yieldUnit: r.yield_unit,
        })),
      ];
      setResults(merged);

      if (companyId) {
        const productIds = merged
          .filter((m) => m.type === "product")
          .map((m) => m.id);
        if (productIds.length > 0) {
          const { data: prices } = await supabase
            .from("current_product_cost")
            .select("product_id, price_per_base_unit")
            .in("product_id", productIds)
            .eq("company_id", companyId);
          if (!cancelled) {
            setPriceByProduct(
              new Map((prices ?? []).map((p) => [p.product_id, p.price_per_base_unit]))
            );
          }
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, companyId]);

  const visible = query.trim().length < 2 ? [] : results;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Zoek ingrediënt of halfproduct…"
          className="h-9 w-full rounded-md border border-border bg-surface pl-7 pr-2 text-sm"
        />
      </div>

      {query.trim().length >= 1 && (
        <div className="absolute z-20 mt-1 w-80 rounded-md border border-border bg-surface shadow-lg">
          {visible.length > 0 && (
            <div className="max-h-64 overflow-y-auto py-1">
              {visible.map((r) => (
                <button
                  key={`${r.type}-${r.id}`}
                  type="button"
                  onClick={() =>
                    onPick({
                      type: r.type,
                      id: r.id,
                      name: r.name,
                      baseUnitId: r.baseUnitId,
                      yieldQuantity: r.yieldQuantity,
                      yieldUnit: r.yieldUnit,
                    })
                  }
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-background"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2">
                      {r.type === "product" ? (
                        <Package className="h-3.5 w-3.5 shrink-0 text-teal" />
                      ) : (
                        <SoupIcon className="h-3.5 w-3.5 shrink-0 text-copper" />
                      )}
                      <span className="truncate">{r.name}</span>
                    </span>
                    {r.customName && r.customName !== r.name && (
                      <span className="ml-5 truncate text-xs text-muted">{r.customName}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    <span
                      className={
                        r.type === "product"
                          ? "rounded-full bg-teal/10 px-1.5 py-0.5 text-teal"
                          : "rounded-full bg-copper/10 px-1.5 py-0.5 text-copper"
                      }
                    >
                      {r.type === "product" ? "Ingrediënt" : "Halfproduct"}
                    </span>
                    {r.type === "product" && priceByProduct.has(r.id) && (
                      <span className="tabular">
                        € {priceByProduct.get(r.id)!.toFixed(4)}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={() => setCreatingProduct(true)}
              className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-teal hover:bg-background"
            >
              + Nieuw ingrediënt aanmaken
            </button>
            <button
              type="button"
              onClick={() => setCreatingHalfproduct(true)}
              className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-copper hover:bg-background"
            >
              + Nieuw halfproduct aanmaken
            </button>
          </div>
        </div>
      )}

      {creatingProduct && (
        <Modal title="Nieuw ingrediënt aanmaken" onClose={() => setCreatingProduct(false)}>
          <ProductForm
            mode="dialog"
            prefillName={query}
            onSaved={(product) => {
              setCreatingProduct(false);
              onPick({
                type: "product",
                id: product.id,
                name: product.name,
                baseUnitId: product.base_unit_id,
              });
            }}
            onCancel={() => setCreatingProduct(false)}
          />
        </Modal>
      )}

      {creatingHalfproduct && (
        <Modal
          title="Nieuw halfproduct aanmaken"
          onClose={() => setCreatingHalfproduct(false)}
        >
          <HalfproductQuickForm
            prefillName={query}
            companyId={companyId}
            onSaved={(recipe) => {
              setCreatingHalfproduct(false);
              onPick({
                type: "halfproduct",
                id: recipe.id,
                name: recipe.name,
                baseUnitId: recipe.base_unit_id,
                yieldQuantity: recipe.yield_quantity,
                yieldUnit: recipe.yield_unit,
              });
            }}
            onCancel={() => setCreatingHalfproduct(false)}
          />
        </Modal>
      )}
    </div>
  );
}

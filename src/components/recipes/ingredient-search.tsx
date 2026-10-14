"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Package, Search, SoupIcon, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ProductForm } from "@/components/products/product-form";
import { HalfproductQuickForm } from "@/components/recipes/halfproduct-quick-form";
import { createClient } from "@/lib/supabase/client";

export interface PickedIngredient {
  type: "ingrediënt" | "halfproduct";
  id: string;
  name: string;
  baseUnitId: string | null;
  yieldQuantity?: number | null;
  yieldUnit?: string | null;
}

interface SearchRow {
  kind: "ingrediënt" | "halfproduct";
  id: string;
  name: string;
  custom_name: string | null;
  brand: string | null;
  article_number: string | null;
  base_unit: string | null;
  base_unit_id: string | null;
  supplier_name: string | null;
  supplier_article_code: string | null;
  purchase_price: number | null;
  packaging_description: string | null;
  packaging_unit_count: number | null;
  price_per_base_unit: number | null;
  yield_quantity: number | null;
  yield_unit: string | null;
  match_rank: number;
}

const EURO = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const EURO_PRECISE = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/**
 * Prijs per basiseenheid leesbaar maken: gram → per kilo, milliliter → per
 * liter, stuk → per stuk. Zo ziet een kok "€ 3,13 per liter" in plaats van
 * "€ 0,003125 per ml". De opgeslagen basiseenheid verandert hier niet.
 */
function formatUnitPrice(pricePerBase: number | null, baseUnit: string | null): string {
  if (pricePerBase == null) return "—";
  const unit = (baseUnit ?? "").toLowerCase();
  if (unit === "g") return `${EURO_PRECISE.format(pricePerBase * 1000)} per kg`;
  if (unit === "ml") return `${EURO_PRECISE.format(pricePerBase * 1000)} per liter`;
  if (unit === "stuk") return `${EURO_PRECISE.format(pricePerBase)} per stuk`;
  return `${EURO_PRECISE.format(pricePerBase)} per ${unit || "eenheid"}`;
}

function formatQuantity(row: SearchRow): string {
  if (row.kind === "halfproduct") {
    return row.yield_quantity
      ? `opbrengst ${row.yield_quantity} ${row.yield_unit ?? ""}`.trim()
      : "—";
  }
  if (row.packaging_description) return row.packaging_description;
  if (row.packaging_unit_count) return `${row.packaging_unit_count} ${row.base_unit ?? ""}`.trim();
  return "—";
}

/**
 * Zoekvenster voor ingrediënten en halfproducten in een recept. Zoekt direct
 * tijdens het typen (naam, eigen naam, synoniemen, artikelnummer, EAN, merk
 * en leverancier), toont exacte treffers bovenaan en laat per resultaat de
 * leverancier, het merk, de inkoopprijs, de verpakking en de prijs per
 * basiseenheid zien. De getoonde prijs is dezelfde actuele prijs als waarmee
 * de receptkostprijs wordt berekend.
 *
 * Het kiezen van een regel loopt via dezelfde `onPick` als altijd; de
 * eenheid, kostprijs en eenhedenconversie worden daarna door het recept
 * zelf bepaald. Met "Venster open laten" kunnen meerdere producten achter
 * elkaar worden toegevoegd (via `onPickMore`, elk als nieuwe regel).
 */
export function IngredientSearch({
  companyId,
  onPick,
  onPickMore,
  open: controlledOpen,
  onOpenChange,
  initialQuery,
  hideTrigger = false,
}: {
  companyId: string | null;
  onPick: (picked: PickedIngredient) => void;
  onPickMore?: (picked: PickedIngredient) => void;
  /** Laat de ouder bepalen wanneer het venster open is (bv. bij een regel
   * die uit het tekstveld komt en nog gekoppeld moet worden). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Zoekterm waarmee het venster opent, bv. de ingetypte ingrediëntnaam. */
  initialQuery?: string;
  /** Geen eigen zoekknop tonen; de ouder opent het venster zelf. */
  hideTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };
  // Wat de gebruiker typte; zolang er niets getypt is geldt de meegegeven
  // zoekterm (de naam uit het tekstveld).
  const [typedQuery, setQuery] = useState<string | null>(null);
  const query = typedQuery ?? initialQuery ?? "";
  const [results, setResults] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [keepOpen, setKeepOpen] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [creatingHalfproduct, setCreatingHalfproduct] = useState(false);
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Eerste keuze vult de regel waar het venster bij hoort; volgende keuzes
  // (bij "open laten") worden nieuwe regels.
  const usedFirstPick = useRef(false);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    const timeout = setTimeout(async () => {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("search_ingredients_picker", {
        p_search: trimmed,
        p_company_id: companyId,
        p_limit: 60,
      });
      // Een nieuwere zoekopdracht is al onderweg: dit antwoord is verouderd.
      if (id !== requestId.current) return;
      setLoading(false);
      if (rpcError) {
        setError("Zoeken mislukt: " + rpcError.message);
        setResults([]);
        return;
      }
      setError(null);
      setResults((data as SearchRow[]) ?? []);
      setActiveIndex(0);
    }, 180);
    return () => clearTimeout(timeout);
  }, [query, companyId, open]);

  useEffect(() => {
    // Het gekozen resultaat in beeld houden bij pijltjestoetsen.
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function close() {
    setOpen(false);
    setQuery(null);
    setResults([]);
    setAdded([]);
    usedFirstPick.current = false;
  }

  function pick(row: SearchRow) {
    const picked: PickedIngredient = {
      type: row.kind,
      id: row.id,
      name: row.custom_name?.trim() || row.name,
      baseUnitId: row.base_unit_id,
      yieldQuantity: row.yield_quantity,
      yieldUnit: row.yield_unit,
    };
    if (keepOpen && onPickMore && usedFirstPick.current) {
      onPickMore(picked);
    } else {
      onPick(picked);
      usedFirstPick.current = true;
    }
    if (keepOpen && onPickMore) {
      setAdded((prev) => [...prev, picked.name]);
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      close();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = results[activeIndex];
      if (row) pick(row);
    }
  }

  const hasQuery = query.trim().length >= 2;

  return (
    <div>
      {!hideTrigger && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-left text-sm text-muted hover:border-teal"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          Ingrediënt zoeken…
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-navy/60 p-4 pt-16"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onKeyDown={handleKeyDown}
        >
          <div className="flex max-h-[80vh] w-full max-w-6xl flex-col rounded-lg border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Ingrediënten &amp; halfproducten</h2>
              <button
                type="button"
                onClick={close}
                className="rounded-md p-1 text-muted hover:bg-surface hover:text-foreground"
                aria-label="Sluiten"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-border px-4 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Zoek op naam, synoniem, artikelnummer, leverancier of merk…"
                  className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
                />
              </div>
              {onPickMore && (
                <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={keepOpen}
                    onChange={(e) => setKeepOpen(e.target.checked)}
                  />
                  Venster open laten om meer ingrediënten achter elkaar toe te voegen
                </label>
              )}
            </div>

            <div ref={listRef} className="min-h-[12rem] flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr className="text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Naam</th>
                    <th className="px-3 py-2 font-medium">Lev. artikelnr.</th>
                    <th className="px-3 py-2 font-medium">Leverancier</th>
                    <th className="px-3 py-2 font-medium">Merk</th>
                    <th className="px-3 py-2 text-right font-medium">Aanschafprijs</th>
                    <th className="px-3 py-2 font-medium">Hoeveelheid</th>
                    <th className="px-4 py-2 text-right font-medium">Prijs per basiseenheid</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr
                      key={`${r.kind}-${r.id}`}
                      data-index={i}
                      onClick={() => pick(r)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`cursor-pointer border-t border-border ${
                        i === activeIndex ? "bg-teal/10" : "hover:bg-surface"
                      }`}
                    >
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2">
                          {r.kind === "ingrediënt" ? (
                            <Package className="h-3.5 w-3.5 shrink-0 text-teal" />
                          ) : (
                            <SoupIcon className="h-3.5 w-3.5 shrink-0 text-copper" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {r.custom_name?.trim() || r.name}
                            </span>
                            {r.custom_name?.trim() && r.custom_name !== r.name && (
                              <span className="block truncate text-xs text-muted">{r.name}</span>
                            )}
                          </span>
                          {r.kind === "halfproduct" && (
                            <span className="shrink-0 rounded-full bg-copper/10 px-1.5 py-0.5 text-xs text-copper">
                              Halfproduct
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted">{r.supplier_article_code ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">{r.supplier_name ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">{r.brand ?? "—"}</td>
                      <td className="tabular px-3 py-2 text-right">
                        {r.purchase_price != null ? EURO.format(r.purchase_price) : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted">{formatQuantity(r)}</td>
                      <td className="tabular px-4 py-2 text-right font-medium">
                        {formatUnitPrice(r.price_per_base_unit, r.base_unit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!hasQuery && (
                <p className="px-4 py-6 text-center text-sm text-muted">
                  Typ minstens 2 letters om te zoeken.
                </p>
              )}
              {hasQuery && loading && results.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-muted">Zoeken…</p>
              )}
              {hasQuery && !loading && !error && results.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-muted">
                  Niets gevonden voor &quot;{query.trim()}&quot;.
                </p>
              )}
              {error && <p className="px-4 py-6 text-center text-sm text-danger">{error}</p>}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
              <div className="flex gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setCreatingProduct(true)}
                  className="text-teal hover:underline"
                >
                  + Nieuw ingrediënt aanmaken
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingHalfproduct(true)}
                  className="text-copper hover:underline"
                >
                  + Nieuw halfproduct aanmaken
                </button>
              </div>
              {added.length > 0 ? (
                <span className="flex items-center gap-1 text-xs text-success">
                  <Check className="h-3.5 w-3.5" />
                  {added.length} toegevoegd — laatst: {added[added.length - 1]}
                </span>
              ) : (
                <span className="text-xs text-muted">
                  ↑↓ kiezen · Enter toevoegen · Esc sluiten
                </span>
              )}
            </div>
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
                type: "ingrediënt",
                id: product.id,
                name: product.name,
                baseUnitId: product.base_unit_id,
              });
              close();
            }}
            onCancel={() => setCreatingProduct(false)}
          />
        </Modal>
      )}

      {creatingHalfproduct && (
        <Modal title="Nieuw halfproduct aanmaken" onClose={() => setCreatingHalfproduct(false)}>
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
              close();
            }}
            onCancel={() => setCreatingHalfproduct(false)}
          />
        </Modal>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Ster voor een favoriet ingrediënt (products.is_favorite, migratie 0141).
 * Favorieten staan bovenaan in de zoekvensters. Geldt voor de hele groep.
 * Met readOnly alleen tonen (bv. Operator), en dan niets als het geen favoriet is.
 */
export function FavoriteStar({
  productId,
  initial,
  readOnly = false,
  size = "sm",
  onChange,
}: {
  productId: string;
  initial: boolean;
  readOnly?: boolean;
  size?: "sm" | "md";
  onChange?: (value: boolean) => void;
}) {
  const [fav, setFav] = useState(initial);
  const [busy, setBusy] = useState(false);
  const icon = size === "md" ? "h-5 w-5" : "h-4 w-4";

  if (readOnly) {
    return fav ? (
      <Star className={cn(icon, "shrink-0 fill-amber-400 text-amber-400")} aria-label="Favoriet" />
    ) : null;
  }

  async function toggle(e: React.MouseEvent) {
    // Niet ook de rij openen waar de ster in staat.
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    const next = !fav;
    setFav(next);
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("products").update({ is_favorite: next }).eq("id", productId);
    setBusy(false);
    if (error) setFav(!next);
    else onChange?.(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={fav ? "Favoriet — klik om te verwijderen" : "Markeer als favoriet"}
      aria-label={fav ? "Favoriet verwijderen" : "Markeer als favoriet"}
      aria-pressed={fav}
      className="shrink-0 rounded p-0.5 hover:bg-amber-400/10"
    >
      <Star
        className={cn(
          icon,
          fav ? "fill-amber-400 text-amber-400" : "text-muted/60 hover:text-amber-400",
        )}
      />
    </button>
  );
}

"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { usePermissions } from "@/components/permissions/permissions-context";
import { cn } from "@/lib/utils";

/**
 * Snelknop "Sticker afdrukken". Met recipeId/productId opent het
 * stickerscherm met dat product al gekozen.
 */
export function StickerQuickButton({
  recipeId,
  productId,
  big,
  className,
}: {
  recipeId?: string;
  productId?: string;
  big?: boolean;
  className?: string;
}) {
  const { can, loading } = usePermissions();
  if (loading || !can("stickers").canCreate) return null;
  const href = recipeId
    ? `/stickers?recept=${recipeId}`
    : productId
      ? `/stickers?product=${productId}`
      : "/stickers";

  if (big) {
    return (
      <Link
        href={href}
        className={cn(
          "flex items-center gap-3 rounded-lg border border-teal/40 bg-teal/5 px-5 py-4 transition-colors hover:bg-teal/10",
          className,
        )}
      >
        <Printer className="h-6 w-6 text-teal" />
        <div>
          <p className="text-base font-semibold">Sticker afdrukken</p>
          <p className="text-xs text-muted">
            Productiedatum, vers of diepvries — binnen een paar tikken
          </p>
        </div>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      title="Sticker afdrukken"
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-background",
        className,
      )}
    >
      <Printer className="h-4 w-4" />
      Sticker
    </Link>
  );
}

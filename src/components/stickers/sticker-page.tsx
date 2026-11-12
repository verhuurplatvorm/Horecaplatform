"use client";

import { SingleCompany } from "@/components/haccp/single-company";
import { StickerForm } from "@/components/stickers/sticker-form";

export function StickerPage({
  recipeId,
  productId,
}: {
  recipeId?: string;
  productId?: string;
}) {
  return (
    <SingleCompany hint="Stickers en de stickerregistratie zijn per bedrijf. Kies er één.">
      {(companyId) => (
        <StickerForm
          key={companyId}
          companyId={companyId}
          initialRecipeId={recipeId}
          initialProductId={productId}
        />
      )}
    </SingleCompany>
  );
}

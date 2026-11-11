import { Topbar } from "@/components/layout/topbar";
import { StickerPage } from "@/components/stickers/sticker-page";

export default async function StickersPage({
  searchParams,
}: {
  searchParams: Promise<{ recept?: string; product?: string }>;
}) {
  const { recept, product } = await searchParams;
  return (
    <>
      <Topbar title="Sticker afdrukken" />
      <StickerPage recipeId={recept} productId={product} />
    </>
  );
}

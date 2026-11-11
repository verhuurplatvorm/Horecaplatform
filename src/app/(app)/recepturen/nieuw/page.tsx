import { Topbar } from "@/components/layout/topbar";
import { RecipeForm } from "@/components/recipes/recipe-form";

export default async function NieuweReceptuurPage({
  searchParams,
}: {
  searchParams: Promise<{ map?: string }>;
}) {
  const { map } = await searchParams;
  const initialCategory = typeof map === "string" && map.trim() ? map.trim().slice(0, 80) : undefined;
  return (
    <>
      <Topbar title={initialCategory === "Partijgerechten" ? "Nieuw partijgerecht" : "Nieuw gerecht"} />
      <main className="p-6">
        <RecipeForm lockedKind="gerecht" initialCategory={initialCategory} />
      </main>
    </>
  );
}

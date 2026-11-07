import { Topbar } from "@/components/layout/topbar";
import { RecipeForm } from "@/components/recipes/recipe-form";

export default function NieuweReceptuurPage() {
  return (
    <>
      <Topbar title="Nieuw gerecht" />
      <main className="p-6">
        <RecipeForm lockedKind="gerecht" />
      </main>
    </>
  );
}

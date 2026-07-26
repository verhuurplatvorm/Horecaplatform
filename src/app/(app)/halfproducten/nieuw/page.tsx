import { Topbar } from "@/components/layout/topbar";
import { RecipeForm } from "@/components/recipes/recipe-form";

export default function NieuwHalfproductPage() {
  return (
    <>
      <Topbar title="Nieuw halfproduct" />
      <main className="max-w-4xl p-6">
        <RecipeForm lockedKind="halfproduct" />
      </main>
    </>
  );
}

import { Topbar } from "@/components/layout/topbar";
import { RecipeForm } from "@/components/recipes/recipe-form";

export default function NieuweReceptuurPage() {
  return (
    <>
      <Topbar title="Nieuwe receptuur" />
      <main className="max-w-4xl p-6">
        <RecipeForm />
      </main>
    </>
  );
}

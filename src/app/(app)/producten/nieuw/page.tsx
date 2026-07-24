import { Topbar } from "@/components/layout/topbar";
import { ProductForm } from "@/components/products/product-form";

export default function NieuwProductPage() {
  return (
    <>
      <Topbar title="Nieuw product" />
      <main className="max-w-3xl p-6">
        <ProductForm />
      </main>
    </>
  );
}

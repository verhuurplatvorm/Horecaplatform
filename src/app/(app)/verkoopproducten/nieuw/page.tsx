import { Topbar } from "@/components/layout/topbar";
import { SalesProductForm } from "@/components/sales-products/sales-product-form";

export default function NieuwVerkoopproductPage() {
  return (
    <>
      <Topbar title="Nieuw verkoopproduct" />
      <main className="max-w-3xl p-6">
        <SalesProductForm />
      </main>
    </>
  );
}

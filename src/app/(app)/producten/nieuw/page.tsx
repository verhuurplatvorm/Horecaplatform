import { Topbar } from "@/components/layout/topbar";
import { ProductForm } from "@/components/products/product-form";

export default async function NieuwProductPage({
  searchParams,
}: {
  searchParams: Promise<{ naam?: string }>;
}) {
  const { naam } = await searchParams;
  return (
    <>
      <Topbar title="Nieuw product" />
      <main className="max-w-3xl p-6">
        <ProductForm prefillName={naam} />
      </main>
    </>
  );
}

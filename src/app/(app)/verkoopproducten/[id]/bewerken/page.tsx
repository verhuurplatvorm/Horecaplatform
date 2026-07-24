import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { SalesProductForm } from "@/components/sales-products/sales-product-form";
import { createClient } from "@/lib/supabase/server";
import type { SalesProduct, SalesProductComponent } from "@/lib/types/database";

export default async function BewerkVerkoopproductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: salesProduct }, { data: components }] = await Promise.all([
    supabase.from("sales_products").select("*").eq("id", id).single(),
    supabase
      .from("sales_product_components")
      .select("*")
      .eq("sales_product_id", id)
      .order("sort_order"),
  ]);

  if (!salesProduct) notFound();

  return (
    <>
      <Topbar title={`Bewerken: ${salesProduct.name}`} />
      <main className="max-w-3xl p-6">
        <SalesProductForm
          initialSalesProduct={salesProduct as SalesProduct}
          initialComponents={(components as SalesProductComponent[]) ?? []}
        />
      </main>
    </>
  );
}

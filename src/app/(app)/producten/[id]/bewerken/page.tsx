import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { ProductForm } from "@/components/products/product-form";
import { ProductPricing } from "@/components/products/product-pricing";
import { createClient } from "@/lib/supabase/server";
import type { Product, ProductPackaging } from "@/lib/types/database";

export default async function BewerkProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: product }, { data: packagings }] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).single(),
    supabase
      .from("product_packagings")
      .select("*")
      .eq("product_id", id)
      .order("sort_order"),
  ]);

  if (!product) notFound();

  let baseUnitName: string | null = null;
  if (product.base_unit_id) {
    const { data: unit } = await supabase
      .from("units")
      .select("name")
      .eq("id", product.base_unit_id)
      .single();
    baseUnitName = unit?.name ?? null;
  }

  return (
    <>
      <Topbar title={`Bewerken: ${product.name}`} />
      <main className="max-w-3xl space-y-6 p-6">
        <ProductForm
          initialProduct={product as Product}
          initialPackagings={(packagings as ProductPackaging[]) ?? []}
        />
        <ProductPricing productId={product.id} baseUnitName={baseUnitName} />
      </main>
    </>
  );
}

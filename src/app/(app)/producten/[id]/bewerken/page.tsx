import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { ProductForm } from "@/components/products/product-form";
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

  return (
    <>
      <Topbar title={`Bewerken: ${product.name}`} />
      <main className="max-w-3xl p-6">
        <ProductForm
          initialProduct={product as Product}
          initialPackagings={(packagings as ProductPackaging[]) ?? []}
        />
      </main>
    </>
  );
}

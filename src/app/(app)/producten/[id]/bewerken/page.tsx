import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { ProductDetailTabs } from "@/components/products/product-detail-tabs";
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

  // Leverancier voor de vaste kop: de actieve prijs is leidend, anders de
  // ingestelde voorkeursleverancier.
  let supplierName: string | null = null;
  const { data: activePrice } = await supabase
    .from("supplier_products")
    .select("suppliers(name)")
    .eq("product_id", id)
    .is("valid_to", null)
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  // @ts-expect-error -- suppliers komt als geneste relatie terug
  supplierName = activePrice?.suppliers?.name ?? null;
  if (!supplierName && product.preferred_supplier_id) {
    const { data: pref } = await supabase
      .from("suppliers")
      .select("name")
      .eq("id", product.preferred_supplier_id)
      .maybeSingle();
    supplierName = pref?.name ?? null;
  }

  // Vorige/volgende ingrediënt op volgorde van het interne nummer, zodat
  // je met de pijltjes door de lijst kunt lopen.
  let prevId: string | null = null;
  let nextId: string | null = null;
  if (product.product_number != null) {
    const [{ data: prev }, { data: next }] = await Promise.all([
      supabase
        .from("products")
        .select("id")
        .lt("product_number", product.product_number)
        .order("product_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("products")
        .select("id")
        .gt("product_number", product.product_number)
        .order("product_number", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    prevId = prev?.id ?? null;
    nextId = next?.id ?? null;
  }

  return (
    <>
      <Topbar title="Ingrediënt" />
      <main className="max-w-4xl p-6">
        <ProductDetailTabs
          product={product as Product}
          packagings={(packagings as ProductPackaging[]) ?? []}
          baseUnitName={baseUnitName}
          supplierName={supplierName}
          prevId={prevId}
          nextId={nextId}
        />
      </main>
    </>
  );
}

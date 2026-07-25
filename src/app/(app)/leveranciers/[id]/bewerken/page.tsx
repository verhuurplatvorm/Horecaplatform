import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { createClient } from "@/lib/supabase/server";
import type { Supplier } from "@/lib/types/database";

export default async function BewerkLeverancierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: supplier } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .single();

  if (!supplier) notFound();

  return (
    <>
      <Topbar title={`Bewerken: ${supplier.name}`} />
      <main className="max-w-3xl p-6">
        <SupplierForm initialSupplier={supplier as Supplier} />
      </main>
    </>
  );
}

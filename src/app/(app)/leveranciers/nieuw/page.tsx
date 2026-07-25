import { Topbar } from "@/components/layout/topbar";
import { SupplierForm } from "@/components/suppliers/supplier-form";

export default function NieuweLeverancierPage() {
  return (
    <>
      <Topbar title="Nieuwe leverancier" />
      <main className="max-w-3xl p-6">
        <SupplierForm />
      </main>
    </>
  );
}

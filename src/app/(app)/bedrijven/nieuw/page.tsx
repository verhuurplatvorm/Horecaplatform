import { Topbar } from "@/components/layout/topbar";
import { CompanyForm } from "@/components/companies/company-form";

export default function NieuwBedrijfPage() {
  return (
    <>
      <Topbar title="Nieuw bedrijf" />
      <main className="max-w-2xl p-6">
        <CompanyForm />
      </main>
    </>
  );
}

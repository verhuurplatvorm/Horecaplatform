import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { CompanyForm } from "@/components/companies/company-form";
import { createClient } from "@/lib/supabase/server";
import type { Company } from "@/lib/types/database";

export default async function BewerkBedrijfPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("id", id)
    .single();

  if (!company) notFound();

  return (
    <>
      <Topbar title={`Bewerken: ${company.name}`} />
      <main className="max-w-2xl p-6">
        <CompanyForm initialCompany={company as Company} />
      </main>
    </>
  );
}

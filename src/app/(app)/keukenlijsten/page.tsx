"use client";

import { Topbar } from "@/components/layout/topbar";
import { SingleCompany } from "@/components/haccp/single-company";
import { KitchenLists } from "@/components/kitchen-lists/kitchen-lists";

export default function KeukenlijstenPage() {
  return (
    <>
      <div className="print:hidden">
        <Topbar title="Keukenlijsten & Besteloverzicht" />
      </div>
      <SingleCompany hint="Keukenlijsten zijn per bedrijf (bedrijfsnaam en bestelapp-vinkjes). Kies er één.">
        {(companyId) => <KitchenLists key={companyId} companyId={companyId} />}
      </SingleCompany>
    </>
  );
}

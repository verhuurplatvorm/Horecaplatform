"use client";

import { Topbar } from "@/components/layout/topbar";
import { SingleCompany } from "@/components/haccp/single-company";
import { Vandaag } from "@/components/haccp/vandaag";

export default function HaccpVandaagPage() {
  return (
    <>
      <Topbar title="Schoonmaak vandaag" />
      <SingleCompany>
        {(companyId) => <Vandaag key={companyId} companyId={companyId} />}
      </SingleCompany>
    </>
  );
}

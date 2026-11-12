"use client";

import { Topbar } from "@/components/layout/topbar";
import { SingleCompany } from "@/components/haccp/single-company";
import { Vandaag } from "@/components/haccp/vandaag";
import { TouchArea } from "@/components/touch/touch-keyboard";

export default function HaccpVandaagPage() {
  return (
    <>
      <Topbar title="Schoonmaak vandaag" />
      <TouchArea>
        <SingleCompany>
          {(companyId) => <Vandaag key={companyId} companyId={companyId} />}
        </SingleCompany>
      </TouchArea>
    </>
  );
}

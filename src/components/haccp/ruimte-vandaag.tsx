"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { Vandaag } from "@/components/haccp/vandaag";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";

/**
 * Na het scannen van een QR-code: zoekt de ruimte op, zet het juiste
 * bedrijf actief en toont alleen de taken van die ruimte.
 */
export function RuimteVandaag({ areaId }: { areaId: string }) {
  const { scope, setScope } = useCompanyScope();
  const [area, setArea] = useState<{ name: string; company_id: string } | null>(
    null,
  );
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("haccp_areas")
      .select("name, company_id")
      .eq("id", areaId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data) setNotFound(true);
        else setArea(data);
      });
    return () => {
      cancelled = true;
    };
  }, [areaId]);

  // Juiste bedrijf actief zetten, zodat de rest van het systeem meeloopt.
  useEffect(() => {
    if (!area) return;
    if (
      scope.mode !== "companies" ||
      scope.ids.length !== 1 ||
      scope.ids[0] !== area.company_id
    ) {
      setScope({ mode: "companies", ids: [area.company_id] });
    }
  }, [area, scope, setScope]);

  return (
    <>
      <Topbar title={area ? `Schoonmaak – ${area.name}` : "Schoonmaak"} />
      {notFound && (
        <p className="p-6 text-sm text-muted">
          Deze ruimte is niet gevonden of je hebt geen toegang tot dit bedrijf.
        </p>
      )}
      {area && (
        <Vandaag key={areaId} companyId={area.company_id} areaId={areaId} />
      )}
    </>
  );
}

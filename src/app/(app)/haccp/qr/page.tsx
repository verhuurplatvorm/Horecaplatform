"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Printer } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { SingleCompany } from "@/components/haccp/single-company";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";

export default function HaccpQrPage() {
  return (
    <>
      <div className="print:hidden">
        <Topbar title="QR-codes per ruimte" />
      </div>
      <SingleCompany>
        {(companyId) => <QrSheet key={companyId} companyId={companyId} />}
      </SingleCompany>
    </>
  );
}

/**
 * Eén vel met een QR-code per ruimte. Ophangen bij de ruimte; scannen met
 * de telefoon opent direct de schoonmaaktaken van die ruimte.
 */
function QrSheet({ companyId }: { companyId: string }) {
  const { companies } = useCompanyScope();
  const company = companies.find((c) => c.id === companyId)?.name ?? "";
  const [codes, setCodes] = useState<
    { id: string; name: string; img: string }[] | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from("haccp_areas")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      const list = await Promise.all(
        (data ?? []).map(async (a) => ({
          id: a.id,
          name: a.name,
          img: await QRCode.toDataURL(
            `${window.location.origin}/haccp/ruimte/${a.id}`,
            { margin: 1, width: 360 },
          ),
        })),
      );
      if (!cancelled) setCodes(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return (
    <div className="mx-auto max-w-4xl p-3 sm:p-6 print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-muted">
          Print dit vel, knip de kaartjes uit en hang ze bij de ruimte. Scannen
          met de telefoon opent direct de taken van die ruimte (na inloggen).
        </p>
        <Button onClick={() => window.print()} disabled={!codes?.length}>
          <Printer className="h-4 w-4" /> Afdrukken
        </Button>
      </div>
      {codes === null && <p className="text-sm text-muted">Laden…</p>}
      {codes?.length === 0 && (
        <p className="text-sm text-muted">
          Nog geen ruimtes in het schoonmaakplan.
        </p>
      )}
      <div className="qr-sheet grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3">
        {codes?.map((c) => (
          <div
            key={c.id}
            className="break-inside-avoid rounded-lg border-2 border-dashed border-black/30 bg-white p-3 text-center text-black"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={c.img}
              alt={`QR-code ${c.name}`}
              className="mx-auto w-full max-w-[180px]"
            />
            <div className="mt-1 text-base font-bold">{c.name}</div>
            <div className="text-xs">
              Scan voor de schoonmaaktaken · {company}
            </div>
          </div>
        ))}
      </div>
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 10mm;
          }
          body * {
            visibility: hidden;
          }
          .qr-sheet,
          .qr-sheet * {
            visibility: visible;
          }
          .qr-sheet {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

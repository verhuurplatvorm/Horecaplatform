"use client";

import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { WasteQuickEntry } from "@/components/waste/quick-entry";

/** Losse registratiepagina (oude link); zelfde snelinvoer als bovenaan het overzicht. */
export default function AfvalRegistrerenPage() {
  const router = useRouter();
  return (
    <>
      <Topbar title="Registreren" />
      <main className="mx-auto max-w-2xl space-y-4 p-3 sm:p-6">
        <WasteQuickEntry preferredCompanyId={null} onCancel={() => router.push("/afval")} />
      </main>
    </>
  );
}

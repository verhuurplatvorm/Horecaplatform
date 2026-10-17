"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { MenuCardSettingsForm } from "@/components/menus/menu-card-settings-form";

/** Blijft bestaan voor oude links; instellingen openen nu direct op de kaartpagina. */
export default function MenukaartInstellingenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  return (
    <>
      <Topbar title="Instellingen" />
      <main className="max-w-2xl p-6">
        <MenuCardSettingsForm
          menuCardId={id}
          onSaved={() => router.push(`/menukaarten/${id}`)}
          onCancel={() => router.push(`/menukaarten/${id}`)}
          onDeleted={() => router.push("/menukaarten")}
        />
      </main>
    </>
  );
}

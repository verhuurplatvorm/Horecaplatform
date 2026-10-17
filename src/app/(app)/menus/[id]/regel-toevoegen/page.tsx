"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { MenuLineForm } from "@/components/menus/menu-line-form";

/** Blijft bestaan voor oude links; het toevoegen gebeurt nu direct op de menupagina. */
export default function RegelToevoegenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const back = () => router.push(`/menus/${id}`);
  return (
    <>
      <Topbar title="Regel toevoegen" />
      <main className="max-w-xl p-6">
        <MenuLineForm id={id} onDone={back} onCancel={back} />
      </main>
    </>
  );
}

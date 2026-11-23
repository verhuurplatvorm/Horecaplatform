"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ArrowLeft, Users } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { MenuOrderList } from "@/components/menus/menu-order-list";
import { MenuWorkList } from "@/components/menus/menu-work-list";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import type { EventMenu } from "@/lib/types/database";
import { cn } from "@/lib/utils";

/**
 * Eén menu/buffet voor de Operator: alleen de productiewerklijst (afvinken)
 * en de bestellijst (zonder prijzen). Geen calculatie, geen bewerken.
 */

type Lijst = "werklijst" | "bestellijst";

const LIJSTEN: { key: Lijst; label: string }[] = [
  { key: "werklijst", label: "Productiewerklijst" },
  { key: "bestellijst", label: "Bestellijst" },
];

export default function OperatorMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lijst?: string }>;
}) {
  const { id } = use(params);
  const { lijst } = use(searchParams);
  const { activeCompanyIds } = useCompanyScope();
  const { can } = usePermissions();
  const [tab, setTab] = useState<Lijst>(lijst === "bestellijst" ? "bestellijst" : "werklijst");
  const [menu, setMenu] = useState<EventMenu | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data } = await supabase.from("event_menus").select("*").eq("id", id).maybeSingle();
      const m = (data as EventMenu | null) ?? null;
      let name: string | null = null;
      if (m?.company_id) {
        const { data: c } = await supabase
          .from("companies")
          .select("name")
          .eq("id", m.company_id)
          .maybeSingle();
        name = c?.name ?? null;
      }
      if (!cancelled) {
        setMenu(m);
        setCompanyName(name);
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const referenceCompanyId = activeCompanyIds[0] ?? menu?.company_id ?? null;

  return (
    <>
      <Topbar title={menu?.name ?? "Menu"} />
      <main className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        <Link
          href="/operator/menus"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground print:hidden"
        >
          <ArrowLeft className="h-4 w-4" />
          Alle menu&apos;s &amp; buffetten
        </Link>

        {loading ? (
          <p className="py-8 text-center text-muted">Menu laden…</p>
        ) : !menu ? (
          <p className="py-8 text-center text-muted">Dit menu bestaat niet (meer).</p>
        ) : (
          <>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-foreground">{menu.name}</h1>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
                {menu.service_date && (
                  <span className="capitalize">
                    {new Date(`${menu.service_date}T12:00:00`).toLocaleDateString("nl-NL", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  {menu.person_count} personen
                </span>
                {menu.menu_type && <span>{menu.menu_type}</span>}
                <span>{companyName ?? "groepsbreed"}</span>
              </p>
              {menu.notes && (
                <p className="whitespace-pre-line rounded-md bg-copper/10 p-3 text-sm text-foreground">
                  {menu.notes}
                </p>
              )}
            </div>

            <nav className="flex gap-2 print:hidden">
              {LIJSTEN.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setTab(l.key)}
                  className={cn(
                    "rounded-full border px-5 py-2.5 font-medium",
                    tab === l.key
                      ? "border-teal bg-teal text-white"
                      : "border-border bg-surface text-foreground hover:border-teal/50",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </nav>

            {tab === "werklijst" ? (
              <MenuWorkList
                menuId={menu.id}
                personCount={menu.person_count}
                serviceDate={menu.service_date}
                companyId={referenceCompanyId}
                printTitle={menu.name}
              />
            ) : (
              <MenuOrderList
                menuId={menu.id}
                showPrices={can("menukaarten").canViewFinancial}
                printTitle={`${menu.name} · ${menu.person_count} personen`}
              />
            )}
          </>
        )}
      </main>
    </>
  );
}

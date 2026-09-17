"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { ConfigurableTable } from "@/components/ui/configurable-table";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import type { EventMenu } from "@/lib/types/database";

interface MenuRow extends EventMenu {
  companyName: string | null;
  totalCost: number | null;
}

/**
 * Overzicht van menu's, buffetten en arrangementen. Kostprijzen worden
 * per menu opgehaald uit dezelfde centrale kostprijsfuncties als de rest
 * van het platform.
 */
export default function MenusPage() {
  const router = useRouter();
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  const { can } = usePermissions();
  const canViewFinancial = can("menukaarten").canViewFinancial;

  const [rows, setRows] = useState<MenuRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const [{ data: menus }, { data: companies }] = await Promise.all([
        supabase.from("event_menus").select("*").order("service_date", { ascending: false }),
        supabase.from("companies").select("id, name"),
      ]);
      if (cancelled || !menus) {
        setLoading(false);
        return;
      }
      const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));

      const withCost = await Promise.all(
        (menus as EventMenu[]).map(async (m) => {
          let totalCost: number | null = null;
          if (canViewFinancial && referenceCompanyId) {
            const { data } = await supabase.rpc("calculate_event_menu_cost", {
              p_menu_id: m.id,
              p_company_id: referenceCompanyId,
            });
            totalCost = (data as number | null) ?? null;
          }
          return {
            ...m,
            companyName: m.company_id ? companyName.get(m.company_id) ?? null : null,
            totalCost,
          };
        })
      );
      if (!cancelled) {
        setRows(withCost);
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [referenceCompanyId, canViewFinancial]);

  const costPerPerson = (r: MenuRow) =>
    r.totalCost !== null && r.person_count > 0 ? r.totalCost / r.person_count : null;

  const foodcost = (r: MenuRow) => {
    const cpp = costPerPerson(r);
    if (cpp === null || !r.sales_price_per_person) return null;
    const exclVat = r.sales_price_per_person / (1 + r.vat_rate / 100);
    return exclVat > 0 ? (cpp / exclVat) * 100 : null;
  };

  return (
    <>
      <Topbar title="Menu's & buffetten" />
      <main className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Stel een menu, buffet of arrangement samen en reken het automatisch door op
            het aantal personen — tot en met de productiewerklijst en de bestellijst.
          </p>
          <Link href="/menus/nieuw">
            <Button>
              <Plus className="h-4 w-4" />
              Nieuw menu of buffet
            </Button>
          </Link>
        </div>

        <ConfigurableTable<MenuRow>
          storageKey="menus"
          rows={rows}
          onRowClick={(r) => router.push(`/menus/${r.id}`)}
          emptyLabel={loading ? "Menu's laden…" : "Nog geen menu's of buffetten."}
          columns={[
            { key: "naam", label: "Naam", width: 220, sticky: true, value: (r) => r.name },
            { key: "type", label: "Type", width: 120, value: (r) => r.menu_type },
            { key: "cat", label: "Categorie", width: 130, value: (r) => r.category },
            { key: "loc", label: "Locatie", width: 130, value: (r) => r.companyName ?? "groepsbreed" },
            {
              key: "pers",
              label: "Personen",
              width: 90,
              align: "right",
              value: (r) => r.person_count,
            },
            ...(canViewFinancial
              ? [
                  {
                    key: "vkpp",
                    label: "Verkoop p.p.",
                    width: 110,
                    align: "right" as const,
                    value: (r: MenuRow) => r.sales_price_per_person,
                    render: (r: MenuRow) =>
                      r.sales_price_per_person
                        ? `€ ${r.sales_price_per_person.toFixed(2)}`
                        : "—",
                  },
                  {
                    key: "kpp",
                    label: "Kostprijs p.p.",
                    width: 110,
                    align: "right" as const,
                    value: (r: MenuRow) => costPerPerson(r),
                    render: (r: MenuRow) => {
                      const c = costPerPerson(r);
                      return c !== null ? `€ ${c.toFixed(2)}` : "—";
                    },
                  },
                  {
                    key: "totaal",
                    label: "Totale kostprijs",
                    width: 120,
                    align: "right" as const,
                    value: (r: MenuRow) => r.totalCost,
                    render: (r: MenuRow) =>
                      r.totalCost !== null ? `€ ${r.totalCost.toFixed(2)}` : "—",
                  },
                  {
                    key: "fc",
                    label: "Foodcost %",
                    width: 100,
                    align: "right" as const,
                    value: (r: MenuRow) => foodcost(r),
                    render: (r: MenuRow) => {
                      const f = foodcost(r);
                      if (f === null) return "—";
                      return (
                        <span className={f > 33 ? "text-danger" : "text-success"}>
                          {f.toFixed(1)}%
                        </span>
                      );
                    },
                  },
                  {
                    key: "marge",
                    label: "Brutomarge",
                    width: 110,
                    align: "right" as const,
                    value: (r: MenuRow) => {
                      const cpp = costPerPerson(r);
                      if (cpp === null || !r.sales_price_per_person) return null;
                      return (
                        (r.sales_price_per_person / (1 + r.vat_rate / 100) - cpp) *
                        r.person_count
                      );
                    },
                    render: (r: MenuRow) => {
                      const cpp = costPerPerson(r);
                      if (cpp === null || !r.sales_price_per_person) return "—";
                      const m =
                        (r.sales_price_per_person / (1 + r.vat_rate / 100) - cpp) *
                        r.person_count;
                      return `€ ${m.toFixed(2)}`;
                    },
                  },
                ]
              : []),
            {
              key: "datum",
              label: "Datum",
              width: 110,
              value: (r) => r.service_date,
              render: (r) =>
                r.service_date
                  ? new Date(r.service_date).toLocaleDateString("nl-NL")
                  : "—",
            },
            {
              key: "status",
              label: "Status",
              width: 110,
              value: (r) => (r.is_template ? "sjabloon" : r.status),
            },
          ]}
        />
      </main>
    </>
  );
}

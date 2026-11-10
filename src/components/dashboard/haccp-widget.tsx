"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardWidget } from "./dashboard-widget";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { HaccpDashboardRow } from "@/lib/types/database";

interface CompanyStats {
  id: string;
  name: string;
  planned: number;
  done: number;
  late: number;
  toCheck: number;
  deviations: number;
  areas: HaccpDashboardRow[];
}

/**
 * Dashboardpaneel HACCP Schoonmaak – vandaag. Per bedrijf: hoeveel taken
 * zijn uitgevoerd, open, te laat, te controleren en hoeveel afwijkingen
 * lopen er. Elk cijfer opent het bijbehorende HACCP-scherm voor dat bedrijf.
 */
export function HaccpWidget({
  hidden,
  onHide,
}: {
  hidden?: boolean;
  onHide?: (id: string) => void;
}) {
  const { activeCompanyIds, setScope } = useCompanyScope();
  const { can, loading: permLoading } = usePermissions();
  const allowed = can("haccp_controle").canView;
  const router = useRouter();
  const [rows, setRows] = useState<HaccpDashboardRow[] | null>(null);
  const [showAreas, setShowAreas] = useState<string | null>(null);
  const key = activeCompanyIds.join(",");

  useEffect(() => {
    if (!allowed || !key) return;
    let cancelled = false;
    createClient()
      .rpc("haccp_dashboard", { p_company_ids: key.split(",") })
      .then(({ data }) => {
        if (!cancelled) setRows((data as HaccpDashboardRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, key]);

  const companies = useMemo<CompanyStats[]>(() => {
    const m = new Map<string, CompanyStats>();
    for (const r of rows ?? []) {
      const c = m.get(r.company_id) ?? {
        id: r.company_id,
        name: r.company_name,
        planned: 0,
        done: 0,
        late: 0,
        toCheck: 0,
        deviations: 0,
        areas: [],
      };
      c.planned += r.planned;
      c.done += r.done;
      c.late += r.late;
      c.toCheck += r.to_check;
      c.deviations += r.deviations_open;
      if (r.area_id && r.planned > 0) c.areas.push(r);
      m.set(r.company_id, c);
    }
    // Bedrijven zonder schoonmaakplan niet tonen.
    return [...m.values()]
      .filter(
        (c) => c.planned > 0 || c.late > 0 || c.deviations > 0 || c.toCheck > 0,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  if (permLoading || !allowed) return null;

  function go(companyId: string, href: string) {
    setScope({ mode: "companies", ids: [companyId] });
    router.push(href);
  }

  const attention = companies.reduce((n, c) => n + c.late + c.deviations, 0);

  return (
    <DashboardWidget
      id="haccp"
      title="HACCP Schoonmaak – vandaag"
      count={attention}
      hidden={hidden}
      onHide={onHide}
    >
      {rows === null ? (
        <p className="px-4 py-6 text-center text-sm text-muted">Laden…</p>
      ) : companies.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">
          Nog geen schoonmaakplan. Zet het op bij HACCP → Schoonmaakplan.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {companies.map((c) => {
            const pct =
              c.planned > 0 ? Math.round((c.done / c.planned) * 100) : 0;
            const open = c.planned - c.done;
            return (
              <div key={c.id} className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <button
                    onClick={() =>
                      setShowAreas(showAreas === c.id ? null : c.id)
                    }
                    className="text-sm font-semibold text-foreground hover:text-teal"
                  >
                    {c.name}
                  </button>
                  <button
                    onClick={() => go(c.id, "/haccp/vandaag")}
                    className="text-sm text-muted hover:text-teal"
                  >
                    <span className="font-semibold text-foreground">
                      {c.done}
                    </span>{" "}
                    van {c.planned} uitgevoerd
                  </button>
                </div>
                <div className="mb-3 h-2 overflow-hidden rounded-full bg-background">
                  <div
                    className="h-full rounded-full bg-teal"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <Num
                    label="open"
                    value={open}
                    onClick={() => go(c.id, "/haccp/vandaag")}
                  />
                  <Num
                    label="te laat"
                    value={c.late}
                    tone="danger"
                    onClick={() => go(c.id, "/haccp/controle")}
                  />
                  <Num
                    label={
                      c.deviations === 1 ? "afwijking open" : "afwijkingen open"
                    }
                    value={c.deviations}
                    tone="danger"
                    onClick={() => go(c.id, "/haccp/controle")}
                  />
                  <Num
                    label="te controleren"
                    value={c.toCheck}
                    tone="copper"
                    onClick={() => go(c.id, "/haccp/controle")}
                  />
                </div>
                {showAreas === c.id && c.areas.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {[...c.areas]
                      .sort((a, b) => a.area_sort - b.area_sort)
                      .map((a) => (
                        <li
                          key={a.area_id}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span className="w-32 truncate text-foreground">
                            {a.area_name}
                          </span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-background">
                            <span
                              className="block h-full rounded-full bg-teal"
                              style={{
                                width: `${a.planned ? Math.round((a.done / a.planned) * 100) : 0}%`,
                              }}
                            />
                          </span>
                          <span className="w-10 text-right text-muted">
                            {a.done}/{a.planned}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </DashboardWidget>
  );
}

function Num({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "danger" | "copper";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-1 py-1 hover:bg-background"
    >
      <span
        className={cn(
          "block text-xl font-semibold tabular-nums",
          value > 0 && tone === "danger" && "text-danger",
          value > 0 && tone === "copper" && "text-copper",
          (value === 0 || !tone) && "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="block text-[11px] leading-tight text-muted">
        {label}
      </span>
    </button>
  );
}

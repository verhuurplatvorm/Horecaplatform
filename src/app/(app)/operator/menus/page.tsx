"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardCheck, ShoppingCart, Users } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { createClient } from "@/lib/supabase/client";
import type { EventMenu } from "@/lib/types/database";

/**
 * Menu's & buffetten voor de Operator (keuken): alleen het overzicht, zonder
 * prijzen of bewerken. Per menu direct door naar de productiewerklijst of de
 * bestellijst.
 */

type Row = Pick<
  EventMenu,
  "id" | "name" | "menu_type" | "service_date" | "person_count" | "status" | "company_id"
> & { companyName: string | null };

const PAST_LIMIT = 10;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Geen datum";
  return new Date(`${iso}T12:00:00`).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function OperatorMenusPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllPast, setShowAllPast] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const [{ data: menus }, { data: companies }] = await Promise.all([
        supabase
          .from("event_menus")
          .select("id, name, menu_type, service_date, person_count, status, company_id")
          .eq("is_template", false)
          .neq("status", "vervallen")
          .order("service_date", { ascending: true }),
        supabase.from("companies").select("id, name"),
      ]);
      if (cancelled) return;
      const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
      setRows(
        ((menus ?? []) as Omit<Row, "companyName">[]).map((m) => ({
          ...m,
          companyName: m.company_id ? companyName.get(m.company_id) ?? null : null,
        })),
      );
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const today = todayIso();
  const upcoming = rows.filter((r) => !r.service_date || r.service_date >= today);
  const past = rows
    .filter((r) => r.service_date && r.service_date < today)
    .reverse();
  const pastShown = showAllPast ? past : past.slice(0, PAST_LIMIT);

  return (
    <>
      <Topbar title="Menu's & buffetten" />
      <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        {loading ? (
          <p className="py-8 text-center text-muted">Menu&apos;s laden…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-muted">Nog geen menu&apos;s of buffetten.</p>
        ) : (
          <>
            <Section title="Vandaag en komend" rows={upcoming} today={today} empty="Niets gepland." />
            {past.length > 0 && (
              <Section title="Eerder" rows={pastShown} today={today} muted>
                {past.length > PAST_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowAllPast((v) => !v)}
                    className="mt-2 text-sm text-teal hover:underline"
                  >
                    {showAllPast ? "Minder tonen" : `Alle ${past.length} tonen`}
                  </button>
                )}
              </Section>
            )}
          </>
        )}
      </main>
    </>
  );
}

function Section({
  title,
  rows,
  today,
  empty,
  muted,
  children,
}: {
  title: string;
  rows: Row[];
  today: string;
  empty?: string;
  muted?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{title}</h2>
      {rows.length === 0 && empty && <p className="text-muted">{empty}</p>}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li
            key={r.id}
            className={
              "rounded-xl border bg-surface p-4 shadow-sm " +
              (r.service_date === today ? "border-teal" : "border-border") +
              (muted ? " opacity-80" : "")
            }
          >
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-lg font-medium text-foreground">
                  {r.name}
                  {r.service_date === today && (
                    <span className="ml-2 rounded-full bg-teal px-2.5 py-0.5 align-middle text-xs font-medium text-white">
                      vandaag
                    </span>
                  )}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  <span className="capitalize">{formatDate(r.service_date)}</span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {r.person_count} personen
                  </span>
                  {r.menu_type && <span>{r.menu_type}</span>}
                  <span>{r.companyName ?? "groepsbreed"}</span>
                  {r.status !== "definitief" && <span className="text-copper">{r.status}</span>}
                </p>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <Link
                  href={`/operator/menus/${r.id}`}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-teal px-4 py-3 font-medium text-white hover:bg-teal/90 sm:flex-none"
                >
                  <ClipboardCheck className="h-5 w-5" />
                  Werklijst
                </Link>
                <Link
                  href={`/operator/menus/${r.id}?lijst=bestellijst`}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border px-4 py-3 font-medium text-foreground hover:border-teal hover:bg-teal/5 sm:flex-none"
                >
                  <ShoppingCart className="h-5 w-5" />
                  Bestellijst
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {children}
    </section>
  );
}

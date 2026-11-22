"use client";

import Link from "next/link";
import { Filter, X } from "lucide-react";
import { useCompanyScope } from "@/components/company-context";
import { describeScope, type DashboardScope } from "@/lib/dashboard-links";

/**
 * Balk bovenaan een bestemmingspagina die vanaf het dashboard is geopend:
 * welk filter, met welke filters (bedrijf, actuele kaart, periode) en hoeveel
 * resultaten — gelijk aan de teller op het dashboard.
 */
export function DashboardFilterBar({
  title,
  count,
  scope,
  clearHref,
  note,
  menuRelevant = true,
}: {
  title: string;
  count: number | null;
  scope: DashboardScope;
  clearHref: string;
  note?: string;
  /** Speelt "actuele kaart" een rol bij deze lijst? (niet bij facturen) */
  menuRelevant?: boolean;
}) {
  const { companies } = useCompanyScope();
  const name = (id: string) => companies.find((c) => c.id === id)?.name;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-teal/30 bg-teal/5 px-4 py-2.5 text-sm">
      <Filter className="h-4 w-4 text-teal" />
      <span className="font-semibold">
        {title}: {count === null ? "…" : count}
      </span>
      <span className="text-muted">{describeScope(scope, name, menuRelevant)}</span>
      {note && <span className="text-xs text-muted">{note}</span>}
      <Link href={clearHref} className="ml-auto inline-flex items-center gap-1 text-xs text-teal hover:underline">
        <X className="h-3.5 w-3.5" /> Filter wissen
      </Link>
    </div>
  );
}

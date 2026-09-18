"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Omhulsel voor een dashboardblok.
 *
 * Elk blok laadt zijn eigen gegevens en toont zijn eigen laadtekst, zodat
 * één trage query de rest van het dashboard niet ophoudt. Inklappen en
 * verbergen worden per gebruiker in de browser bewaard.
 */
export function DashboardWidget({
  id,
  title,
  count,
  href,
  hidden,
  onHide,
  children,
}: {
  id: string;
  title: string;
  /** Aantal dat aandacht vraagt; kleurt de kop als het meer dan nul is. */
  count?: number | null;
  /** "Alles bekijken"-link naar het achterliggende overzicht. */
  href?: string;
  hidden?: boolean;
  onHide?: (id: string) => void;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(`dash:collapsed:${id}`) === "1");
    } catch {
      /* geblokkeerde opslag mag het dashboard niet breken */
    }
  }, [id]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(`dash:collapsed:${id}`, next ? "1" : "0");
    } catch {
      /* niets aan te doen */
    }
  }

  if (hidden) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <button
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
          )}
          <span className="truncate text-sm font-medium">{title}</span>
          {count != null && count > 0 && (
            <span className="shrink-0 rounded-full bg-copper/10 px-2 py-0.5 text-xs font-medium text-copper">
              {count}
            </span>
          )}
        </button>
        {href && (
          <Link href={href} className="shrink-0 text-xs text-teal hover:underline">
            Alles bekijken
          </Link>
        )}
        {onHide && (
          <button
            onClick={() => onHide(id)}
            title="Dit blok verbergen"
            className="shrink-0 text-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {!collapsed && <CardContent className="p-0">{children}</CardContent>}
    </Card>
  );
}

/** Compacte tabel binnen een dashboardblok. */
export function WidgetTable({
  headers,
  children,
  empty,
  loading,
}: {
  headers: string[];
  children: React.ReactNode;
  empty: string;
  loading: boolean;
}) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  if (loading) {
    return <p className="px-4 py-6 text-center text-sm text-muted">Laden…</p>;
  }
  if (!hasRows) {
    return <p className="px-4 py-6 text-center text-sm text-muted">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted">
            {headers.map((h, i) => (
              <th
                key={h}
                className={cn("px-4 py-2 font-medium", i > 1 && "text-right")}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

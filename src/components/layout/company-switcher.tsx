"use client";

import { useState, useRef, useEffect } from "react";
import { Building2, ChevronDown, Check, LayoutGrid } from "lucide-react";
import { useCompanyScope } from "@/components/company-context";
import { cn } from "@/lib/utils";

/**
 * Bedrijfsselector: altijd zichtbaar binnen welk bedrijf wordt gewerkt,
 * eenvoudig schakelen tussen bedrijf en groepsweergave (spec §34).
 */
export function CompanySwitcher() {
  const { companies, scope, setScope, loading } = useCompanyScope();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const label =
    scope.mode === "group"
      ? "Alle bedrijven"
      : scope.ids.length === 1
      ? companies.find((c) => c.id === scope.ids[0])?.name ?? "1 bedrijf"
      : `${scope.ids.length} bedrijven`;

  function toggleCompany(id: string) {
    if (scope.mode === "group") {
      setScope({ mode: "companies", ids: [id] });
      return;
    }
    const has = scope.ids.includes(id);
    const nextIds = has
      ? scope.ids.filter((x) => x !== id)
      : [...scope.ids, id];
    if (nextIds.length === 0) {
      setScope({ mode: "group" });
    } else {
      setScope({ mode: "companies", ids: nextIds });
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-background"
      >
        {scope.mode === "group" ? (
          <LayoutGrid className="h-4 w-4 text-teal" />
        ) : (
          <Building2 className="h-4 w-4 text-teal" />
        )}
        <span className="max-w-[220px] truncate">{loading ? "Laden…" : label}</span>
        <ChevronDown className="h-4 w-4 text-muted" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-border bg-surface shadow-lg">
          <button
            onClick={() => {
              setScope({ mode: "group" });
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-background",
              scope.mode === "group" && "font-medium text-teal"
            )}
          >
            <span className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4" />
              Alle bedrijven (groepsweergave)
            </span>
            {scope.mode === "group" && <Check className="h-4 w-4" />}
          </button>

          <div className="border-t border-border" />

          <div className="max-h-72 overflow-y-auto py-1">
            {companies.map((company) => {
              const checked =
                scope.mode === "companies" && scope.ids.includes(company.id);
              return (
                <button
                  key={company.id}
                  onClick={() => toggleCompany(company.id)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-background"
                >
                  <span className="flex items-center gap-2 truncate">
                    <Building2 className="h-4 w-4 shrink-0 text-muted" />
                    <span className="truncate">{company.name}</span>
                  </span>
                  {checked && <Check className="h-4 w-4 shrink-0 text-teal" />}
                </button>
              );
            })}
            {companies.length === 0 && !loading && (
              <p className="px-3 py-2 text-sm text-muted">
                Geen bedrijven gevonden voor dit account.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

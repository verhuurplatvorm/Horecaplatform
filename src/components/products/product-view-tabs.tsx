"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/producten", label: "Alle producten" },
  { href: "/producten/opschonen", label: "Te controleren" },
];

/** Kleine tabbalk die "Producten" en "Producten opschonen" als twee weergaven van hetzelfde overzicht laat aanvoelen, in plaats van losse bestemmingen. */
export function ProductViewTabs() {
  const pathname = usePathname() ?? "";

  return (
    <div className="mb-4 flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-teal font-medium text-teal"
                : "border-transparent text-muted hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

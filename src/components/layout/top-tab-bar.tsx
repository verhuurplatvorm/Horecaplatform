"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_TABS, findTabForPath } from "@/lib/nav-structure";
import { usePermissions } from "@/components/permissions/permissions-context";
import { useMobileNav } from "@/components/layout/mobile-nav-context";

/**
 * Volledige-breedte tabbalk bovenaan het scherm voor de vijf
 * hoofdonderdelen (Keuken / Inkoop & Voorraad / Productie / Financieel /
 * Beheer). Vervangt de eerdere, te krappe bolletjes-tabs binnen de
 * smalle zijbalk. Op mobiel/tablet (< md) staat er links een
 * hamburger-knop die het zijmenu opent, aangezien de zijbalk daar niet
 * permanent zichtbaar is.
 */
export function TopTabBar() {
  const pathname = usePathname() ?? "";
  const { can, loading } = usePermissions();
  const { toggle } = useMobileNav();
  const activeTab = findTabForPath(pathname);

  const visibleTabs = NAV_TABS.filter((tab) =>
    tab.items.some((item) => can(item.moduleKey).canView)
  );

  if (loading || visibleTabs.length === 0) {
    return (
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 md:px-4">
        <button
          onClick={toggle}
          className="rounded-md p-1.5 text-muted hover:bg-background md:hidden"
          aria-label="Menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold text-foreground">Culilogic</span>
      </div>
    );
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-3 md:px-4">
      <button
        onClick={toggle}
        className="mr-1 shrink-0 rounded-md p-1.5 text-muted hover:bg-background md:hidden"
        aria-label="Menu"
      >
        <Menu className="h-5 w-5" />
      </button>
      <span className="mr-4 hidden shrink-0 text-sm font-semibold text-foreground sm:block">
        Culilogic
      </span>
      <nav className="flex h-full items-stretch gap-1 overflow-x-auto">
        {visibleTabs.map((tab) => {
          const active = activeTab?.key === tab.key;
          return (
            <Link
              key={tab.key}
              href={tab.items[0].href}
              className={cn(
                "flex items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors",
                active
                  ? "border-teal text-teal"
                  : "border-transparent text-muted hover:border-border hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

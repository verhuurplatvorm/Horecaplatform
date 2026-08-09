"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_TABS, findTabForPath } from "@/lib/nav-structure";
import { usePermissions } from "@/components/permissions/permissions-context";

/**
 * Volledige-breedte tabbalk bovenaan het scherm voor de vijf
 * hoofdonderdelen (Keuken / Inkoop & Voorraad / Productie / Financieel /
 * Beheer). Vervangt de eerdere, te krappe bolletjes-tabs binnen de
 * smalle zijbalk.
 */
export function TopTabBar() {
  const pathname = usePathname() ?? "";
  const { can, loading } = usePermissions();
  const activeTab = findTabForPath(pathname);

  const visibleTabs = NAV_TABS.filter((tab) =>
    tab.items.some((item) => can(item.moduleKey).canView)
  );

  if (loading || visibleTabs.length === 0) {
    return (
      <div className="flex h-12 shrink-0 items-center border-b border-border bg-surface px-4">
        <span className="text-sm font-semibold text-foreground">Horeca Platform</span>
      </div>
    );
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-4">
      <span className="mr-4 shrink-0 text-sm font-semibold text-foreground">
        Horeca Platform
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

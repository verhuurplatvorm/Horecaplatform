"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_TABS, findTabForPath } from "@/lib/nav-structure";
import { usePermissions } from "@/components/permissions/permissions-context";

export function Sidebar() {
  const pathname = usePathname() ?? "";
  const { can, loading } = usePermissions();

  const activeTab = findTabForPath(pathname);
  const visibleTabs = NAV_TABS.filter((tab) =>
    tab.items.some((item) => can(item.moduleKey).canView)
  );
  const currentTab = activeTab ?? visibleTabs[0];

  return (
    <aside className="flex h-[calc(100vh-3rem)] w-60 shrink-0 flex-col bg-navy text-white/90">
      <Link
        href="/dashboard"
        className={cn(
          "mx-3 mt-3 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
          pathname.startsWith("/dashboard")
            ? "bg-navy-light text-white border-l-2 border-copper"
            : "text-white/70 hover:bg-navy-light hover:text-white border-l-2 border-transparent"
        )}
      >
        <LayoutDashboard className="h-4 w-4" />
        Dashboard
      </Link>

      {!loading && currentTab && (
        <>
          <p className="mt-4 px-6 text-xs font-medium uppercase tracking-wide text-white/40">
            {currentTab.label}
          </p>
          <nav className="mt-1 flex-1 space-y-0.5 px-3">
            {currentTab.items.map((item) => {
              if (!can(item.moduleKey).canView) return null;
              const active = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-navy-light text-white border-l-2 border-copper"
                      : "text-white/70 hover:bg-navy-light hover:text-white border-l-2 border-transparent"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </>
      )}

      <div className="px-5 py-4 text-xs text-white/40">
        Personeelszaken volgen in een latere fase.
      </div>
    </aside>
  );
}

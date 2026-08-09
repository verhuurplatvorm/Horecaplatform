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

  // Alleen tabbladen tonen waar minstens één onderdeel zichtbaar is voor
  // deze gebruiker — een kok ziet bijvoorbeeld geen "Beheer"-tabblad als
  // die nergens in dat tabblad "bekijken" mag.
  const visibleTabs = NAV_TABS.filter((tab) =>
    tab.items.some((item) => can(item.moduleKey).canView)
  );

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col bg-navy text-white/90">
      <div className="px-5 py-5">
        <p className="text-sm font-semibold tracking-wide text-white">
          Horeca Platform
        </p>
        <p className="text-xs text-white/50">Fase 1 · Fundament</p>
      </div>

      <Link
        href="/dashboard"
        className={cn(
          "mx-3 mb-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
          pathname.startsWith("/dashboard")
            ? "bg-navy-light text-white border-l-2 border-copper"
            : "text-white/70 hover:bg-navy-light hover:text-white border-l-2 border-transparent"
        )}
      >
        <LayoutDashboard className="h-4 w-4" />
        Dashboard
      </Link>

      {!loading && visibleTabs.length > 0 && (
        <>
          <div className="mx-3 mb-2 flex flex-wrap gap-1 border-t border-white/10 pt-3">
            {visibleTabs.map((tab) => (
              <Link
                key={tab.key}
                href={tab.items[0].href}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs transition-colors",
                  activeTab?.key === tab.key
                    ? "bg-copper text-white"
                    : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                )}
              >
                {tab.label}
              </Link>
            ))}
          </div>

          <nav className="flex-1 space-y-0.5 px-3">
            {(activeTab ?? visibleTabs[0]).items.map((item) => {
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

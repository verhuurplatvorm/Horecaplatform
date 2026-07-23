"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Truck,
  BookOpen,
  Building2,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/producten", label: "Producten", icon: Package },
  { href: "/leveranciers", label: "Leveranciers", icon: Truck },
  { href: "/recepturen", label: "Recepturen", icon: BookOpen },
  { href: "/bedrijven", label: "Bedrijven", icon: Building2 },
  { href: "/gebruikers", label: "Gebruikers & rechten", icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col bg-navy text-white/90">
      <div className="px-5 py-5">
        <p className="text-sm font-semibold tracking-wide text-white">
          Horeca Platform
        </p>
        <p className="text-xs text-white/50">Fase 1 · Fundament</p>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-navy-light text-white border-l-2 border-copper"
                  : "text-white/70 hover:bg-navy-light hover:text-white border-l-2 border-transparent"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 text-xs text-white/40">
        Personeelszaken volgen in een latere fase.
      </div>
    </aside>
  );
}

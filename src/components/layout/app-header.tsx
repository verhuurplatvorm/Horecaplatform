"use client";

import { useEffect, useRef } from "react";

/**
 * Vaste kop bovenaan (tabbladen + recent-balk). Blijft in beeld bij scrollen
 * en zet zijn hoogte in de CSS-variabele --app-header-h, zodat de zijbalk en
 * de paginakop (Topbar) er direct onder kunnen blijven plakken.
 */
export function AppHeader({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--app-header-h", `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--app-header-h");
    };
  }, []);
  return (
    <div ref={ref} className="sticky top-0 z-40 print:static">
      {children}
    </div>
  );
}

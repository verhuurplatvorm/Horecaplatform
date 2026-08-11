"use client";

import { createContext, useContext, useState } from "react";
import { usePathname } from "next/navigation";

interface MobileNavContextValue {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

const MobileNavContext = createContext<MobileNavContextValue>({
  open: false,
  toggle: () => {},
  close: () => {},
});

/**
 * Houdt bij of het mobiele zijmenu (onder de md-breakpoint) open staat.
 * Op tablet/desktop heeft dit geen effect — daar blijft de zijbalk altijd
 * zichtbaar, zoals voorheen.
 */
export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Sluit het menu automatisch zodra de route wijzigt (na een klik op een
  // link) — afgeleid tijdens render in plaats van via een effect, zodat
  // er geen extra render-cyclus nodig is.
  const [lastPathname, setLastPathname] = useState<string | null>(null);
  const pathname = usePathname();
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (open) setOpen(false);
  }

  return (
    <MobileNavContext.Provider
      value={{ open, toggle: () => setOpen((o) => !o), close: () => setOpen(false) }}
    >
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav() {
  return useContext(MobileNavContext);
}

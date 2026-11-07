"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Opslaan-/publiceerknoppen rechtsboven in beeld.
 *
 * Een formulier zet zijn knoppen in <PageActions>. Die worden via een
 * portal getoond in de vaste kop van de pagina (sticky, bv. bij
 * ingrediënten en halfproducten) of anders rechtsboven in de Topbar.
 * Is er geen plek (bv. formulier in een pop-up), dan blijven ze gewoon
 * bovenaan het formulier staan.
 *
 * Let op: knoppen buiten het <form>-element hebben `form="<form-id>"`
 * nodig om het formulier te versturen.
 */

type SlotName = "header" | "topbar";
type Slots = Record<SlotName, HTMLElement | null>;

const PageActionsContext = createContext<{
  slots: Slots;
  register: (name: SlotName, el: HTMLElement | null) => void;
} | null>(null);

export function PageActionsProvider({ children }: { children: React.ReactNode }) {
  const [slots, setSlots] = useState<Slots>({ header: null, topbar: null });
  const register = useCallback((name: SlotName, el: HTMLElement | null) => {
    setSlots((prev) => (prev[name] === el ? prev : { ...prev, [name]: el }));
  }, []);
  const value = useMemo(() => ({ slots, register }), [slots, register]);
  return <PageActionsContext.Provider value={value}>{children}</PageActionsContext.Provider>;
}

/** Plek waar formulierknoppen terechtkomen (rechtsboven). */
export function PageActionsSlot({ name, className }: { name: SlotName; className?: string }) {
  const register = useContext(PageActionsContext)?.register;
  const ref = useCallback((el: HTMLDivElement | null) => register?.(name, el), [register, name]);
  return (
    <div
      ref={ref}
      className={cn("flex flex-wrap items-center justify-end gap-2 empty:hidden", className)}
    />
  );
}

export function PageActions({
  children,
  inline = false,
}: {
  children: React.ReactNode;
  /** Altijd bovenaan het formulier tonen (bv. in een pop-up). */
  inline?: boolean;
}) {
  const ctx = useContext(PageActionsContext);
  const target = inline ? null : (ctx?.slots.header ?? ctx?.slots.topbar ?? null);
  if (!target) {
    return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
  }
  return createPortal(children, target);
}

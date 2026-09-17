"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Terugkeren naar waar je vandaan kwam na Opslaan of Annuleren.
 *
 * Schermen die een ingrediënt, recept, gerecht of halfproduct openen
 * geven hun eigen adres mee in de `terug`-parameter (zie `withReturnTo`).
 * Is die er, dan gaan we daar exact naartoe — inclusief tab, filters,
 * zoekterm en geopend onderdeel, want die staan in datzelfde adres.
 *
 * Zonder die parameter vallen we terug op de browserhistorie, zodat het
 * ook werkt als iemand via een link of bladwijzer binnenkomt. Pas als
 * die er niet is, gaan we naar het opgegeven standaardoverzicht.
 */
export function useReturnNavigation(fallbackHref: string) {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = params.get("terug");

  return useCallback(() => {
    if (returnTo) {
      // Alleen interne adressen; een volledige URL van buitenaf negeren we.
      if (returnTo.startsWith("/") && !returnTo.startsWith("//")) {
        router.push(returnTo);
        return;
      }
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }, [returnTo, router, fallbackHref]);
}

/**
 * Bouwt een link naar een detailscherm mét het huidige adres erin, zodat
 * dat scherm weet waar het naartoe terug moet.
 *
 * Roep dit aan vanuit een scherm dat een detail opent:
 *   withReturnTo(`/producten/${id}/bewerken`)
 *
 * De huidige zoekterm, filters en tab zitten al in het adres van het
 * scherm waar je staat, dus die komen automatisch mee terug.
 */
export function withReturnTo(href: string): string {
  if (typeof window === "undefined") return href;
  const current = window.location.pathname + window.location.search + window.location.hash;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}terug=${encodeURIComponent(current)}`;
}

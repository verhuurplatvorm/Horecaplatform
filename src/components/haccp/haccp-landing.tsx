"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/components/permissions/permissions-context";
import { isTabletHome, takeLandingRedirect } from "@/lib/haccp/cleaning";

/**
 * Op het dashboard: medewerkers (die wel mogen afvinken maar geen
 * leidinggevende zijn) en tablets met "altijd openen op Schoonmaak
 * vandaag" gaan bij het openen direct naar dat scherm.
 */
export function HaccpLanding() {
  const router = useRouter();
  const { can, loading, isGroupAdmin } = usePermissions();

  useEffect(() => {
    if (loading) return;
    const staffOnly =
      !isGroupAdmin && can("haccp").canView && !can("haccp_controle").canView;
    if ((isTabletHome() || staffOnly) && takeLandingRedirect()) {
      router.replace("/haccp/vandaag");
    }
  }, [loading, isGroupAdmin, can, router]);

  return null;
}

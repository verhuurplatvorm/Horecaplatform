"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Terug naar de vorige pagina (handig na een verkeerde tik op een
 * touchscherm). Zonder geschiedenis (nieuw tabblad) gaat hij naar het dashboard.
 */
export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname === "/dashboard" || pathname === "/") return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/dashboard");
      }}
      className="-ml-2 flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-background hover:text-foreground print:hidden"
      title="Terug naar de vorige pagina"
    >
      <ArrowLeft className="h-5 w-5" />
      <span className="hidden sm:inline">Terug</span>
    </button>
  );
}

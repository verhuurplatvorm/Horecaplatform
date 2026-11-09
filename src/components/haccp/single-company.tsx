"use client";

import { useCompanyScope } from "@/components/company-context";

/**
 * HACCP werkt altijd voor precies één bedrijf, zodat registraties van Het
 * Strand en Zomers nooit door elkaar lopen. Staan er meerdere bedrijven
 * aan, dan kiest de gebruiker er eerst één.
 */
export function SingleCompany({
  children,
}: {
  children: (companyId: string) => React.ReactNode;
}) {
  const { companies, activeCompanyIds, loading, setScope } = useCompanyScope();

  if (loading) {
    return <p className="p-6 text-sm text-muted">Laden…</p>;
  }
  if (activeCompanyIds.length === 1) {
    return <>{children(activeCompanyIds[0])}</>;
  }

  const options = companies.filter(
    (c) => activeCompanyIds.length === 0 || activeCompanyIds.includes(c.id),
  );

  return (
    <div className="mx-auto max-w-xl p-6">
      <h2 className="mb-1 text-lg font-semibold text-foreground">
        Voor welk bedrijf?
      </h2>
      <p className="mb-5 text-sm text-muted">
        Het schoonmaakplan en de registraties zijn per bedrijf. Kies er één.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((c) => (
          <button
            key={c.id}
            onClick={() => setScope({ mode: "companies", ids: [c.id] })}
            className="h-16 rounded-lg border border-border bg-surface px-4 text-left text-base font-semibold text-foreground hover:border-teal hover:text-teal"
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}

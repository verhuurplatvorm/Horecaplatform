"use client";

import { useEffect, useState } from "react";
import { Building2, Package, Truck, BookOpen, TrendingUp } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { KpiTile } from "@/components/kpi-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";

interface SetupCounts {
  products: number;
  suppliers: number;
  recipes: number;
}

export default function DashboardPage() {
  const { companies, activeCompanyIds, scope, loading } = useCompanyScope();
  const [counts, setCounts] = useState<SetupCounts | null>(null);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;

    async function loadCounts() {
      const supabase = createClient();
      const [{ count: products }, { count: suppliers }, { count: recipes }] =
        await Promise.all([
          supabase.from("products").select("*", { count: "exact", head: true }),
          supabase.from("suppliers").select("*", { count: "exact", head: true }),
          supabase.from("recipes").select("*", { count: "exact", head: true }),
        ]);

      if (!cancelled) {
        setCounts({
          products: products ?? 0,
          suppliers: suppliers ?? 0,
          recipes: recipes ?? 0,
        });
      }
    }

    loadCounts();
    return () => {
      cancelled = true;
    };
  }, [loading]);

  const scopedCompanies =
    scope.mode === "group"
      ? companies
      : companies.filter((c) => activeCompanyIds.includes(c.id));

  return (
    <>
      <Topbar title="Groepsdashboard" />
      <main className="p-6 space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiTile label="Bedrijven in beeld" value={String(scopedCompanies.length)} />
          <KpiTile
            label="Centrale producten"
            value={counts ? String(counts.products) : "…"}
          />
          <KpiTile
            label="Leveranciers"
            value={counts ? String(counts.suppliers) : "…"}
          />
          <KpiTile
            label="Recepturen"
            value={counts ? String(counts.recipes) : "…"}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Omzet-, marge- en voorraad-KPI&apos;s</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted max-w-2xl">
              Deze KPI&apos;s (omzet, foodcost, brutomarge, bezetting,
              liquiditeit, ...) worden gevoed door de kassa-, boekhoud- en
              reserveringskoppelingen uit fase 3. Zodra die koppelingen
              actief zijn, verschijnen ze hier automatisch, gefilterd op de
              huidige bedrijfsselectie.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bedrijven in de groep</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2 font-medium">Bedrijf</th>
                  <th className="px-5 py-2 font-medium">Type</th>
                  <th className="px-5 py-2 font-medium">Seizoensgebonden</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {scopedCompanies.map((company) => (
                  <tr key={company.id} className="border-t border-border">
                    <td className="px-5 py-3 flex items-center gap-2 font-medium">
                      <Building2 className="h-4 w-4 text-muted" />
                      {company.name}
                    </td>
                    <td className="px-5 py-3 text-muted capitalize">
                      {company.kind.replace(/_/g, " ")}
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {company.is_seasonal ? "Ja" : "Nee"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          company.is_active
                            ? "rounded-full bg-success/10 px-2 py-0.5 text-xs text-success"
                            : "rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted"
                        }
                      >
                        {company.is_active ? "Actief" : "Inactief"}
                      </span>
                    </td>
                  </tr>
                ))}
                {scopedCompanies.length === 0 && !loading && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted">
                      Nog geen bedrijven aangemaakt. Voeg het eerste bedrijf
                      toe onder &quot;Bedrijven&quot;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-4">
          <ShortcutCard
            icon={TrendingUp}
            title="Prijzendashboard"
            description="Stijgers, dalers en de impact op halfproducten en gerechten."
            href="/dashboard/prijzen"
          />
          <ShortcutCard
            icon={Package}
            title="Centrale productdatabase"
            description="Beheer ingrediënten en artikelen die door meerdere bedrijven worden gebruikt."
            href="/producten"
          />
          <ShortcutCard
            icon={Truck}
            title="Leveranciers"
            description="Centrale en lokale leveranciers, prijzen en contractafspraken."
            href="/leveranciers"
          />
          <ShortcutCard
            icon={BookOpen}
            title="Recepturen"
            description="Centrale standaarden en lokale varianten, met automatische kostprijs."
            href="/recepturen"
          />
        </div>
      </main>
    </>
  );
}

function ShortcutCard({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: typeof Package;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a href={href}>
      <Card className="h-full transition-colors hover:border-teal">
        <CardContent className="pt-5">
          <Icon className="h-5 w-5 text-teal" />
          <p className="mt-3 font-medium text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </CardContent>
      </Card>
    </a>
  );
}

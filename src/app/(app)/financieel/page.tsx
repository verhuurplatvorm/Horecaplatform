import Link from "next/link";
import { LineChart, History, ArrowRight, Building2 } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SECTIONS = [
  {
    href: "/financieel/bedrijven",
    icon: Building2,
    title: "Kostprijs & foodcost per bedrijf",
    description:
      "Gemiddelde kostprijs, verkoopprijs en foodcost% van alle gerechten, per bedrijf naast elkaar vergeleken.",
  },
  {
    href: "/dashboard/prijzen",
    icon: LineChart,
    title: "Prijsontwikkeling & foodcost",
    description:
      "Ingrediëntprijzen, receptkosten en foodcost% per periode — met signalering bij afwijkingen van de norm.",
  },
  {
    href: "/leveranciers/prijzen/wijzigingen",
    icon: History,
    title: "Prijswijzigingen",
    description: "Geschiedenis van alle doorgevoerde leveranciersprijs-aanpassingen.",
  },
];

export default function FinancieelPage() {
  return (
    <>
      <Topbar title="Financieel" />
      <main className="max-w-3xl space-y-4 p-6">
        <p className="text-sm text-muted">
          Overzicht van de financiële onderdelen van het platform — prijsontwikkeling,
          foodcost-signalering en de geschiedenis van prijswijzigingen.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href}>
              <Card className="h-full transition-colors hover:border-teal">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <s.icon className="h-4 w-4 text-teal" />
                    {s.title}
                    <ArrowRight className="ml-auto h-4 w-4 text-muted" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted">{s.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}

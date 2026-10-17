import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";

const IMPORTS = [
  { href: "/producten/importeren", title: "Ingrediënten", text: "Excel met ingrediënten en leveranciersprijzen" },
  { href: "/leveranciers/prijzen/importeren", title: "Prijslijst leverancier", text: "Nieuwe prijzen uit een Excel- of PDF-prijslijst" },
  { href: "/recepten/importeren", title: "Gerechten", text: "Recepten uit een bestand" },
  { href: "/halfproducten/importeren", title: "Halfproducten", text: "Halfproducten uit een bestand" },
  { href: "/menukaarten/pdf-importeren", title: "Menukaart (PDF)", text: "Een bestaande menukaart inlezen" },
];

export default function ImporterenPage() {
  return (
    <>
      <Topbar title="Importeren" />
      <main className="max-w-3xl space-y-3 p-6">
        <p className="text-sm text-muted">Wat wil je importeren?</p>
        {IMPORTS.map((i) => (
          <Link key={i.href} href={i.href} className="block">
            <Card className="transition-colors hover:border-teal">
              <CardContent className="py-4">
                <p className="font-medium">{i.title}</p>
                <p className="text-sm text-muted">{i.text}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </main>
    </>
  );
}

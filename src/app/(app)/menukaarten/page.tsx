"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, FileUp } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { MenuCard } from "@/lib/types/database";

const STATUS_LABELS: Record<string, string> = {
  concept: "Concept",
  in_voorbereiding: "In voorbereiding",
  actief: "Actief",
  gepland: "Gepland",
  verlopen: "Verlopen",
  gearchiveerd: "Gearchiveerd",
};
const STATUS_STYLES: Record<string, string> = {
  concept: "bg-muted/10 text-muted",
  in_voorbereiding: "bg-copper/10 text-copper",
  actief: "bg-success/10 text-success",
  gepland: "bg-teal/10 text-teal",
  verlopen: "bg-danger/10 text-danger",
  gearchiveerd: "bg-muted/10 text-muted",
};

export default function MenukaartenPage() {
  const { companies } = useCompanyScope();
  const [cards, setCards] = useState<MenuCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("alle");

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("menu_cards")
      .select("*")
      .order("start_date", { ascending: false, nullsFirst: false })
      .then(({ data }) => {
        if (!cancelled) {
          setCards((data as MenuCard[]) ?? []);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
  const filtered = cards.filter((c) => statusFilter === "alle" || c.status === statusFilter);

  return (
    <>
      <Topbar title="Menukaarten" />
      <main className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          >
            <option value="alle">Alle statussen</option>
            {Object.entries(STATUS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <Link href="/menukaarten/pdf-importeren">
            <Button variant="secondary">
              <FileUp className="h-4 w-4" />
              Menukaart uploaden (PDF)
            </Button>
          </Link>
          <Link href="/menukaarten/nieuw">
            <Button>
              <Plus className="h-4 w-4" />
              Nieuwe menukaart
            </Button>
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Naam</th>
                  <th className="px-5 py-3 font-medium">Bedrijf</th>
                  <th className="px-5 py-3 font-medium">Periode</th>
                  <th className="px-5 py-3 font-medium">Versie</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-background">
                    <td className="px-5 py-3 font-medium">
                      <Link href={`/menukaarten/${c.id}`} className="hover:text-teal hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {c.company_id ? companyNameById.get(c.company_id) ?? "—" : "Groepsbreed"}
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {c.start_date ? new Date(c.start_date).toLocaleDateString("nl-NL") : "—"}
                      {c.end_date && ` – ${new Date(c.end_date).toLocaleDateString("nl-NL")}`}
                    </td>
                    <td className="px-5 py-3 tabular text-muted">{c.version.toFixed(1)}</td>
                    <td className="px-5 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs", STATUS_STYLES[c.status])}>
                        {STATUS_LABELS[c.status]}
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-muted">
                      Nog geen menukaarten aangemaakt.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

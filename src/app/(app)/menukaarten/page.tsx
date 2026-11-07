"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, FileUp, ClipboardList, Archive, ArchiveRestore } from "lucide-react";
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
  // "Actuele menukaarten" = menukaarten met status Actief (geen apart veld).
  const [view, setView] = useState<"actueel" | "alle">("actueel");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  /** Archiveren = status Gearchiveerd (verdwijnt uit de lijst); terugzetten = Verlopen. */
  async function toggleArchive(card: MenuCard) {
    const archiving = card.status !== "gearchiveerd";
    if (
      archiving &&
      !window.confirm(
        `"${card.name}" archiveren?\n\nDe kaart verdwijnt uit de lijst en telt niet meer mee als actuele kaart. Er wordt niets verwijderd; terughalen kan via "Toon gearchiveerd".`
      )
    )
      return;
    const next = archiving ? "gearchiveerd" : "verlopen";
    setBusyId(card.id);
    const supabase = createClient();
    const { error } = await supabase.from("menu_cards").update({ status: next }).eq("id", card.id);
    setBusyId(null);
    if (error) {
      window.alert("Bijwerken mislukt: " + error.message);
      return;
    }
    setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, status: next } : c)));
  }

  /** Aanvinken = status Actief; uitvinken = status Verlopen. */
  async function toggleCurrent(card: MenuCard) {
    const next = card.status === "actief" ? "verlopen" : "actief";
    if (
      next === "verlopen" &&
      !window.confirm(`"${card.name}" van de actuele kaarten halen? De status wordt Verlopen.`)
    )
      return;
    setBusyId(card.id);
    const supabase = createClient();
    const { error } = await supabase.from("menu_cards").update({ status: next }).eq("id", card.id);
    setBusyId(null);
    if (error) {
      window.alert("Bijwerken mislukt: " + error.message);
      return;
    }
    setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, status: next } : c)));
  }

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
  const currentCount = cards.filter((c) => c.status === "actief").length;
  const filtered = cards.filter((c) =>
    view === "actueel"
      ? c.status === "actief"
      : statusFilter === "alle"
        ? showArchived || c.status !== "gearchiveerd"
        : c.status === statusFilter
  );
  const archivedCount = cards.filter((c) => c.status === "gearchiveerd").length;

  return (
    <>
      <Topbar title="Menukaarten" />
      <main className="p-6 space-y-4">
        <div className="flex gap-1 border-b border-border" role="tablist">
          {(
            [
              ["actueel", `Actuele menukaarten${loading ? "" : ` (${currentCount})`}`],
              ["alle", "Alle menukaarten"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
                view === key
                  ? "border-teal text-teal"
                  : "border-transparent text-muted hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          {view === "alle" ? (
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
          ) : (
            <p className="text-xs text-muted">
              Menukaarten met status Actief. Vink in &quot;Alle menukaarten&quot; een kaart aan om
              hem actueel te maken.
            </p>
          )}
          {view === "alle" && archivedCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Toon gearchiveerd ({archivedCount})
            </label>
          )}
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
            <div className="overflow-x-auto">
<table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="w-10 px-3 py-3" title="Actuele menukaart"></th>
                  <th className="px-5 py-3 font-medium">Naam</th>
                  <th className="px-5 py-3 font-medium">Bedrijf</th>
                  <th className="px-5 py-3 font-medium">Periode</th>
                  <th className="px-5 py-3 font-medium">Versie</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="w-10 px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-background">
                    <td className="px-3 py-3">
                      <button
                        disabled={busyId === c.id}
                        onClick={() => toggleCurrent(c)}
                        title={
                          c.status === "actief"
                            ? "Actuele menukaart — klik om eraf te halen"
                            : "Actueel maken (status Actief)"
                        }
                      >
                        <ClipboardList
                          className={cn("h-4 w-4", c.status === "actief" ? "text-teal" : "text-muted/50")}
                        />
                      </button>
                    </td>
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
                    <td className="px-3 py-3">
                      <button
                        disabled={busyId === c.id}
                        onClick={() => toggleArchive(c)}
                        title={c.status === "gearchiveerd" ? "Terugzetten uit archief" : "Archiveren"}
                      >
                        {c.status === "gearchiveerd" ? (
                          <ArchiveRestore className="h-4 w-4 text-muted hover:text-teal" />
                        ) : (
                          <Archive className="h-4 w-4 text-muted hover:text-teal" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-center text-muted">
                      {view === "actueel" && cards.length > 0
                        ? "Geen actuele menukaarten. Vink er een aan in \"Alle menukaarten\"."
                        : "Nog geen menukaarten aangemaakt."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
</div>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

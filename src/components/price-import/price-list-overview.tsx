"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Overzicht van een ingevoerde prijslijst: wat is hoger, lager, gelijk of
 * nieuw (price_import_batch_changes, migratie 0142). Elke wijziging geeft een
 * prijsalarm. "Accepteren als nieuwe standaard" handelt die alarmen af
 * (accept_price_import_batch); de ontwikkeling blijft zichtbaar in de
 * historie en bij ingrediënten en recepten. Vanaf dan is de nieuwe prijs de
 * norm: alleen een afwijking dáárvan geeft nog een alarm.
 *
 * Bij een leverancier met vaste prijzen hoort er een geldigheidsperiode bij:
 * facturen in die periode moeten precies deze prijzen hebben; elke afwijking
 * wordt in de prijscontrole gemeld.
 */

type Kind = "hoger" | "lager" | "gelijk" | "nieuw";

interface Change {
  row_id: string;
  product_name: string;
  article_number: string | null;
  old_price: number | null;
  new_price: number | null;
  diff: number | null;
  diff_pct: number | null;
  change_kind: Kind;
  /** Regel is doorgevoerd (migratie 0144). */
  applied: boolean;
  /** Alarm van deze prijs is afgehandeld (geaccepteerd). */
  acknowledged: boolean;
}

const KINDS: { key: Kind; label: string }[] = [
  { key: "hoger", label: "Hoger" },
  { key: "lager", label: "Lager" },
  { key: "nieuw", label: "Nieuw" },
  { key: "gelijk", label: "Gelijk" },
];

const euro = (n: number | null) =>
  n === null ? "—" : `€ ${Number(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PriceListOverview({
  batchId,
  supplierId,
  priceDate,
  priceValidTo,
  acceptedAt,
  reloadToken,
}: {
  batchId: string;
  supplierId: string;
  priceDate: string | null;
  priceValidTo: string | null;
  acceptedAt: string | null;
  reloadToken: number;
}) {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [priceType, setPriceType] = useState<"dag" | "vast" | null>(null);
  const [filter, setFilter] = useState<Kind | "alle">("alle");
  const [from, setFrom] = useState(priceDate ?? "");
  const [to, setTo] = useState(priceValidTo ?? "");
  const [periodSaved, setPeriodSaved] = useState(false);
  const [accepted, setAccepted] = useState<string | null>(acceptedAt);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const [{ data }, { data: sup }] = await Promise.all([
        supabase.rpc("price_import_batch_changes", { p_batch_id: batchId }),
        supabase.from("suppliers").select("price_type").eq("id", supplierId).maybeSingle(),
      ]);
      if (cancelled) return;
      const list = ((data ?? []) as Change[]).map((c) => ({
        ...c,
        old_price: c.old_price === null ? null : Number(c.old_price),
        new_price: c.new_price === null ? null : Number(c.new_price),
        diff: c.diff === null ? null : Number(c.diff),
        diff_pct: c.diff_pct === null ? null : Number(c.diff_pct),
      }));
      setChanges(list);
      setPriceType((sup?.price_type as "dag" | "vast" | null) ?? null);
      // Standaard de wijzigingen tonen, als die er zijn.
      setFilter(list.some((c) => c.change_kind === "hoger" || c.change_kind === "lager") ? "hoger" : "alle");
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [batchId, supplierId, reloadToken, localReload]);

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { hoger: 0, lager: 0, gelijk: 0, nieuw: 0 };
    for (const x of changes ?? []) c[x.change_kind]++;
    return c;
  }, [changes]);

  const shown = useMemo(() => {
    const list = (changes ?? []).filter((c) => filter === "alle" || c.change_kind === filter);
    return [...list].sort(
      (a, b) => Math.abs(b.diff_pct ?? 0) - Math.abs(a.diff_pct ?? 0) || a.product_name.localeCompare(b.product_name, "nl"),
    );
  }, [changes, filter]);

  async function savePeriod(nextFrom: string, nextTo: string) {
    setError(null);
    if (nextFrom && nextTo && nextTo < nextFrom) {
      setError("De einddatum ligt voor de begindatum.");
      return;
    }
    const supabase = createClient();
    const { error: e } = await supabase
      .from("price_import_batches")
      .update({ price_date: nextFrom || null, price_valid_to: nextTo || null })
      .eq("id", batchId);
    if (e) setError("Periode opslaan mislukt: " + e.message);
    else {
      setPeriodSaved(true);
      setTimeout(() => setPeriodSaved(false), 1500);
    }
  }

  async function accept() {
    setAccepting(true);
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.rpc("accept_price_import_batch", { p_batch_id: batchId });
    setAccepting(false);
    if (e) {
      setError("Accepteren mislukt: " + e.message);
      return;
    }
    setAccepted(new Date().toISOString());
    setLocalReload((n) => n + 1);
  }

  if (changes === null) return null;
  // Accepteren kan pas als er prijzen zijn doorgevoerd. Staan er doorgevoerde
  // prijzen nog open (bv. eerder te vroeg geaccepteerd), dan komt de knop terug.
  const applied = changes.some((c) => c.applied);
  const openCount = changes.filter((c) => c.applied && !c.acknowledged && c.change_kind !== "gelijk").length;
  const changed = counts.hoger + counts.lager;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Overzicht prijslijst</CardTitle>
        {priceType && (
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium",
              priceType === "vast" ? "bg-teal/10 text-teal" : "bg-copper/10 text-copper",
            )}
          >
            {priceType === "vast" ? "Vaste prijzen" : "Dagprijzen"}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Geldigheid */}
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="space-y-1">
            <span className="block text-xs text-muted">Geldig vanaf</span>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                savePeriod(e.target.value, to);
              }}
              className="input h-9!"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted">
              Geldig t/m {priceType === "vast" ? "" : "(alleen bij vaste prijzen)"}
            </span>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                savePeriod(from, e.target.value);
              }}
              className="input h-9!"
            />
          </label>
          {periodSaved && <span className="pb-2 text-xs text-success">Opgeslagen</span>}
          {priceType === "vast" && !to && (
            <p className="basis-full text-xs text-copper">
              Vaste prijzen: vul in tot wanneer deze prijslijst geldt. Facturen in die periode
              moeten precies deze prijzen hebben; elke afwijking wordt gemeld.
            </p>
          )}
          {!priceType && (
            <p className="basis-full text-xs text-muted">
              Tip: stel bij de leverancier in of het om dagprijzen of vaste prijzen gaat.
            </p>
          )}
        </div>

        {!applied ? (
          <p className="text-sm text-muted">
            Voer eerst de prijzen door; daarna zie je hier wat er hoger, lager of nieuw is en kun je
            de lijst accepteren als nieuwe standaard.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <FilterChip active={filter === "alle"} onClick={() => setFilter("alle")}>
                Alles ({changes.length})
              </FilterChip>
              {KINDS.map((k) => (
                <FilterChip key={k.key} active={filter === k.key} onClick={() => setFilter(k.key)} kind={k.key}>
                  {k.label} ({counts[k.key]})
                </FilterChip>
              ))}
            </div>

            <div className="max-h-96 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 font-medium">Ingrediënt</th>
                    <th className="px-3 py-2 text-right font-medium">Was</th>
                    <th className="px-3 py-2 text-right font-medium">Nu</th>
                    <th className="px-3 py-2 text-right font-medium">Verschil</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.row_id} className="border-t border-border">
                      <td className="px-3 py-1.5">
                        {c.product_name}
                        {c.change_kind === "nieuw" && <span className="ml-2 text-xs text-muted">nieuw</span>}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right text-muted">{euro(c.old_price)}</td>
                      <td className="tabular px-3 py-1.5 text-right font-medium">{euro(c.new_price)}</td>
                      <td
                        className={cn(
                          "tabular whitespace-nowrap px-3 py-1.5 text-right",
                          c.change_kind === "hoger" && "text-danger",
                          c.change_kind === "lager" && "text-success",
                          c.change_kind === "gelijk" && "text-muted",
                        )}
                      >
                        {c.diff !== null && c.diff !== 0 ? (
                          <span className="inline-flex items-center gap-1">
                            {c.diff > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                            {c.diff > 0 ? "+" : ""}
                            {euro(c.diff)}
                            {c.diff_pct !== null && (
                              <span className="text-xs">
                                ({c.diff_pct > 0 ? "+" : ""}
                                {c.diff_pct.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%)
                              </span>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-muted">
                        Niets in deze categorie.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {accepted && openCount === 0 ? (
              <p className="flex items-start gap-2 rounded-md bg-success/10 p-3 text-sm text-success">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Geaccepteerd als nieuwe standaard op{" "}
                  {new Date(accepted).toLocaleDateString("nl-NL")}. De prijsalarmen voor deze
                  wijzigingen zijn afgehandeld; de ontwikkeling blijft zichtbaar in de historie.
                  Vanaf nu geeft alleen een afwijking van deze prijzen nog een alarm.
                </span>
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-teal/40 bg-teal/5 px-3 py-3">
                <p className="min-w-0 flex-1 text-sm">
                  {changed > 0
                    ? `${counts.hoger} prijzen hoger en ${counts.lager} lager. `
                    : "Geen prijswijzigingen. "}
                  Elke wijziging staat als prijsalarm klaar. Klopt het? Accepteer de lijst als nieuwe
                  standaard: de alarmen zijn dan afgehandeld en deze prijzen zijn vanaf nu de norm.
                  Halfproducten en gerechten rekenen al met de nieuwe prijzen.
                </p>
                <Button onClick={accept} disabled={accepting}>
                  {accepting ? "Bezig…" : "Accepteren als nieuwe standaard"}
                </Button>
              </div>
            )}
          </>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  kind,
  children,
}: {
  active: boolean;
  onClick: () => void;
  kind?: Kind;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium",
        active
          ? "border-teal bg-teal text-white"
          : cn(
              "border-border bg-surface hover:border-teal/50",
              kind === "hoger" && "text-danger",
              kind === "lager" && "text-success",
              (!kind || kind === "gelijk" || kind === "nieuw") && "text-foreground",
            ),
      )}
    >
      {children}
    </button>
  );
}

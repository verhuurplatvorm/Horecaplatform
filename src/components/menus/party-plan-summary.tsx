"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { partyLineFigures, type PartyLineInput } from "@/lib/party/party-calc";

export interface PartySummaryRow extends PartyLineInput {
  line_id: string;
  recipe_name: string;
  section_name: string;
  quantity_per_person: number;
  participation_pct: number;
}

const euro = (n: number) =>
  n.toLocaleString("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

/**
 * Partijgerechten in één oogopslag: netto nodig, wat de keuken maakt,
 * wat er naar verwachting overblijft en wat die productie kost.
 *
 * Alle getallen komen uit get_event_menu_party_plan, dus uit dezelfde
 * schaalberekening (event_line_plan) als de werklijst, de bestellijst en
 * de kostprijs van het menu. Kosten alleen met financiële rechten.
 */
export function PartyPlanSummary({
  rows,
  personCount,
  canViewFinancial,
  salesPricePerPerson,
  onToggleFull,
  title = "Partijgerechten — wat de keuken maakt",
}: {
  rows: PartySummaryRow[];
  personCount: number;
  canViewFinancial: boolean;
  /** Verkoopprijs staat op het totale menu/buffet (incl. btw, per persoon). */
  salesPricePerPerson?: number | null;
  /** Wisselen tussen volle vormen en laatste vorm aanpassen (alleen waar bewerken mag). */
  onToggleFull?: (lineId: string, full: boolean) => void;
  title?: string;
}) {
  if (rows.length === 0) return null;
  const figures = rows.map((r) => ({ r, f: partyLineFigures(r, canViewFinancial) }));
  const totalCost = figures.reduce((s, x) => s + (x.f.productionCost ?? 0), 0);
  const totalLeftoverCost = figures.reduce((s, x) => s + (x.f.leftoverCost ?? 0), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Partijgerecht</th>
                <th className="px-4 py-2 text-right font-medium">Netto nodig</th>
                <th className="px-4 py-2 font-medium">Keuken maakt</th>
                <th className="px-4 py-2 text-right font-medium">Verwacht over</th>
                {canViewFinancial && <th className="px-4 py-2 text-right font-medium">Productiekosten</th>}
              </tr>
            </thead>
            <tbody>
              {figures.map(({ r, f }) => (
                <tr key={r.line_id} className="border-t border-border align-top">
                  <td className="px-4 py-2">
                    <span className="font-medium">{r.recipe_name}</span>
                    <span className="ml-1 text-xs text-muted">{r.section_name}</span>
                    <div className="text-xs text-muted">
                      {personCount} gasten
                      {Number(r.participation_pct) !== 100 && <> × {Number(r.participation_pct)}%</>} ×{" "}
                      {Number(r.quantity_per_person).toLocaleString("nl-NL")} p.p.
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular">{f.needed}</td>
                  <td className="px-4 py-2">
                    <span className="tabular font-medium">{f.produced}</span>
                    <div className="text-xs text-muted">{f.distribution}</div>
                    {onToggleFull ? (
                      <button
                        type="button"
                        onClick={() => onToggleFull(r.line_id, !r.full_containers)}
                        className="text-xs text-teal underline decoration-dotted print:hidden"
                        title="Wisselen tussen volle vormen en de laatste vorm aanpassen"
                      >
                        {f.mode}
                      </button>
                    ) : (
                      <div className="text-xs text-muted">{f.mode}</div>
                    )}
                  </td>
                  <td className={cn("px-4 py-2 text-right tabular", f.leftover ? "text-copper" : "text-muted")}>
                    {f.leftover ?? "niets"}
                    {f.leftoverCost !== null && <div className="text-xs">{euro(f.leftoverCost)}</div>}
                  </td>
                  {canViewFinancial && (
                    <td className="px-4 py-2 text-right tabular">
                      {f.productionCost !== null ? euro(f.productionCost) : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {canViewFinancial && (
              <tfoot>
                <tr className="border-t border-border font-medium">
                  <td className="px-4 py-2" colSpan={3}>
                    Totaal partijgerechten
                  </td>
                  <td className="px-4 py-2 text-right tabular text-copper">
                    {totalLeftoverCost > 0 ? euro(totalLeftoverCost) : ""}
                  </td>
                  <td className="px-4 py-2 text-right tabular">{euro(totalCost)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="border-t border-border px-4 py-2 text-xs text-muted">
          Werklijst en bestellijst rekenen met wat de keuken maakt, niet met het netto benodigde.
          Partijgerechten hebben geen eigen verkoopprijs
          {canViewFinancial && salesPricePerPerson
            ? `; de verkoopprijs staat op het menu (${euro(salesPricePerPerson)} p.p.).`
            : "; de verkoopprijs staat op het totale menu of buffet."}
        </p>
      </CardContent>
    </Card>
  );
}

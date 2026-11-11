"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import {
  containerInfo,
  containerLabel,
  formatDistribution,
  personsPerContainer,
  planParty,
} from "@/lib/party/party-calc";

interface Row {
  id: string;
  name: string;
  container: string | null;
  capacity: number | null;
  unitKey: string | null;
  portion: number | null;
  full: boolean;
  cost: number | null;
}

const PARTY_FOLDER = "Partijgerechten";
const euro = (n: number) =>
  `€ ${n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) =>
  n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

/**
 * Keuken → Gerechten voor Partijen: alle gerechten in de map
 * Partijgerechten met hun vorm, capaciteit en standaardportie, plus een
 * snelle rekenhulp "hoeveel schalen bij X gasten".
 */
export default function PartijgerechtenPage() {
  const { activeCompanyIds } = useCompanyScope();
  const companyId = activeCompanyIds[0] ?? null;
  const { can } = usePermissions();
  const canViewFinancial = can("recepturen").canViewFinancial;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [guests, setGuests] = useState("100");
  const [pct, setPct] = useState("100");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const [{ data: recipes }, { data: units }] = await Promise.all([
        supabase
          .from("recipes")
          .select(
            "id, name, party_container, party_capacity, party_capacity_unit_id, party_portion, party_full_containers",
          )
          .eq("recipe_kind", "gerecht")
          .eq("category", PARTY_FOLDER)
          .neq("status", "vervallen")
          .order("name"),
        supabase.from("units").select("id, key"),
      ]);
      const unitKey = new Map(
        (units ?? []).map((u) => [u.id as string, u.key as string]),
      );
      const list = await Promise.all(
        (recipes ?? []).map(async (r) => {
          let cost: number | null = null;
          if (canViewFinancial && companyId) {
            const { data } = await supabase.rpc("calculate_recipe_cost", {
              p_recipe_id: r.id,
              p_company_id: companyId,
            });
            cost = (data as number | null) ?? null;
          }
          return {
            id: r.id as string,
            name: r.name as string,
            container: r.party_container ?? null,
            capacity:
              r.party_capacity !== null && r.party_capacity !== undefined
                ? Number(r.party_capacity)
                : null,
            unitKey: r.party_capacity_unit_id
              ? (unitKey.get(r.party_capacity_unit_id) ?? null)
              : null,
            portion:
              r.party_portion !== null && r.party_portion !== undefined
                ? Number(r.party_portion)
                : null,
            full: r.party_full_containers ?? true,
            cost,
          } satisfies Row;
        }),
      );
      if (!cancelled) {
        setRows(list);
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [companyId, canViewFinancial]);

  const g = Number(guests) || 0;
  const p = Number(pct) || 0;

  return (
    <>
      <Topbar title="Gerechten voor Partijen" />
      <main className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Rekenhulp:</span>
            <input
              type="number"
              min="0"
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
              className="input h-8! w-24!"
            />
            <span>gasten ×</span>
            <input
              type="number"
              min="0"
              max="100"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              className="input h-8! w-20!"
            />
            <span>% deelname</span>
          </div>
          <Link
            href={`/recepturen/nieuw?map=${encodeURIComponent(PARTY_FOLDER)}`}
            className="inline-flex items-center gap-1 rounded-md bg-teal px-3 py-2 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" />
            Nieuw partijgerecht
          </Link>
        </div>

        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Gerecht</th>
                  <th className="px-4 py-2 font-medium">Vorm</th>
                  <th className="px-4 py-2 text-right font-medium">
                    Hoofdproduct / vorm
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Portie p.p.
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Personen / vorm
                  </th>
                  {canViewFinancial && (
                    <th className="px-4 py-2 text-right font-medium">
                      Kosten / vorm
                    </th>
                  )}
                  {canViewFinancial && (
                    <th className="px-4 py-2 text-right font-medium">
                      Kosten / portie
                    </th>
                  )}
                  <th className="px-4 py-2 font-medium">Bij {num(g)} gasten</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const unit = r.unitKey ?? "";
                  const ready = r.capacity !== null && r.portion !== null;
                  const perC = ready
                    ? personsPerContainer(r.capacity!, r.portion!)
                    : null;
                  const plan = ready
                    ? planParty({
                        guests: g,
                        portion: r.portion!,
                        capacity: r.capacity!,
                        participationPct: p,
                        fullContainers: r.full,
                      })
                    : null;
                  return (
                    <tr key={r.id} className="hover:bg-background">
                      <td className="px-4 py-2">
                        <Link
                          href={`/recepturen/${r.id}/bewerken`}
                          className="font-medium hover:text-teal"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-muted">
                        {r.container ? containerInfo(r.container).label : "—"}
                        {ready && !r.full && (
                          <span className="ml-1 text-xs">
                            (laatste aangepast)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular">
                        {r.capacity !== null
                          ? `${num(r.capacity)} ${unit}`
                          : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular">
                        {r.portion !== null ? `${num(r.portion)} ${unit}` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular">
                        {perC !== null ? num(perC) : "—"}
                      </td>
                      {canViewFinancial && (
                        <td className="px-4 py-2 text-right tabular">
                          {r.cost !== null ? euro(r.cost) : "—"}
                        </td>
                      )}
                      {canViewFinancial && (
                        <td className="px-4 py-2 text-right tabular">
                          {r.cost !== null && perC ? euro(r.cost / perC) : "—"}
                        </td>
                      )}
                      <td className="px-4 py-2">
                        {plan && plan.containers > 0 ? (
                          <>
                            <span className="font-medium">
                              {plan.containers}{" "}
                              {containerLabel(r.container, plan.containers)}
                            </span>
                            <span className="ml-1 text-xs text-muted">
                              netto {num(plan.needed)} {unit} ·{" "}
                              {formatDistribution(plan.distribution, unit)}
                              {plan.difference > 0 &&
                                ` · +${num(plan.difference)} ${unit}`}
                            </span>
                          </>
                        ) : ready ? (
                          "—"
                        ) : (
                          <span className="text-xs text-copper">
                            Partij-instellingen invullen
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-muted"
                    >
                      {loading
                        ? "Laden…"
                        : "Nog geen gerechten in de map Partijgerechten."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <p className="text-xs text-muted">
          Het recept van een partijgerecht is één standaardvorm inclusief
          garnering. Verkoopprijs, foodcost en marge staan op het menu of
          buffet, niet op het gerecht.
        </p>
      </main>
    </>
  );
}

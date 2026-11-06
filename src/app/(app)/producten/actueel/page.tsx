"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { ProductViewTabs } from "@/components/products/product-view-tabs";
import { useCompanyScope } from "@/components/company-context";
import { usePermissions } from "@/components/permissions/permissions-context";
import { createClient } from "@/lib/supabase/client";
import { withReturnTo } from "@/lib/use-return-navigation";

interface CurrentProduct {
  product_id: string;
  name: string;
  custom_name: string | null;
  base_unit: string;
  is_provisional: boolean;
  price_per_base_unit: number | null;
  supplier_name: string | null;
  purchase_price: number | null;
  packaging_description: string | null;
  usage_count: number;
  used_in: string | null;
}

/** Prijs per kilo/liter voor g/ml, anders per stuk — zo leest een kok het. */
function displayPrice(price: number | null, baseUnit: string): string {
  if (price === null) return "—";
  if (baseUnit === "g") return `€ ${(price * 1000).toFixed(2)} / kg`;
  if (baseUnit === "ml") return `€ ${(price * 1000).toFixed(2)} / l`;
  return `€ ${price.toFixed(2)} / ${baseUnit}`;
}

/**
 * Actuele ingrediënten: automatisch afgeleid uit de actuele halfproducten
 * en de gerechten op actuele menukaarten (ook via halfproducten in
 * halfproducten). Niets om aan te vinken — dit volgt vanzelf de kaart.
 */
export default function ActueleIngredientenPage() {
  const { activeCompanyIds, loading: scopeLoading } = useCompanyScope();
  const { can } = usePermissions();
  const canViewFinancial = can("producten").canViewFinancial;
  const referenceCompanyId = activeCompanyIds[0] ?? null;

  const [rows, setRows] = useState<CurrentProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (scopeLoading) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .rpc("get_current_products", { p_company_id: referenceCompanyId })
      .then(({ data }) => {
        if (cancelled) return;
        setRows((data ?? []) as CurrentProduct[]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [referenceCompanyId, scopeLoading]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          (r.custom_name || r.name).toLowerCase().includes(q) ||
          (r.supplier_name ?? "").toLowerCase().includes(q) ||
          (r.used_in ?? "").toLowerCase().includes(q)
      )
    : rows;

  return (
    <>
      <Topbar title="Centrale ingrediëntendatabase" />
      <main className="space-y-4 p-6">
        <ProductViewTabs />
        <p className="text-xs text-muted">
          Ingrediënten die nu gebruikt worden: in de actuele halfproducten en in de
          gerechten op actieve menukaarten (ook via halfproducten). Deze lijst volgt
          vanzelf de kaart.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek op ingrediënt, leverancier of gerecht…"
              className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
            />
          </div>
          {!loading && <span className="text-xs text-muted">{filtered.length} ingrediënten</span>}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Ingrediënt</th>
                    <th className="px-4 py-3 font-medium">Leverancier</th>
                    <th className="px-4 py-3 font-medium">Verpakking</th>
                    {canViewFinancial && <th className="px-4 py-3 font-medium">Prijs</th>}
                    <th className="px-4 py-3 font-medium">Gebruikt in</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.product_id} className="border-t border-border align-top hover:bg-background">
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={withReturnTo(`/producten/${r.product_id}/bewerken`)}
                          className="hover:text-teal hover:underline"
                        >
                          {r.custom_name || r.name}
                        </Link>
                        {r.is_provisional && (
                          <span className="ml-2 rounded bg-copper/10 px-1.5 text-xs font-normal text-copper">
                            voorlopig
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {r.supplier_name ?? (r.price_per_base_unit !== null ? "Eigen prijs" : "—")}
                      </td>
                      <td className="px-4 py-3 text-muted">{r.packaging_description ?? "—"}</td>
                      {canViewFinancial && (
                        <td className="px-4 py-3 tabular">
                          {displayPrice(
                            r.price_per_base_unit === null ? null : Number(r.price_per_base_unit),
                            r.base_unit
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-xs text-muted" title={r.used_in ?? ""}>
                        <span className="font-medium text-foreground">{Number(r.usage_count)}×</span>{" "}
                        {r.used_in && r.used_in.length > 120 ? r.used_in.slice(0, 120) + "…" : r.used_in}
                      </td>
                    </tr>
                  ))}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={canViewFinancial ? 5 : 4} className="px-5 py-6 text-center text-muted">
                        {rows.length === 0
                          ? "Nog geen actuele ingrediënten. Zet halfproducten op de actuele kaart of maak een menukaart actief."
                          : "Geen ingrediënten gevonden."}
                      </td>
                    </tr>
                  )}
                  {loading && (
                    <tr>
                      <td colSpan={canViewFinancial ? 5 : 4} className="px-5 py-6 text-center text-muted">
                        Laden…
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

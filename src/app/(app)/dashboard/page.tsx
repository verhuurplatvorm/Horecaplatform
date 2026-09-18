"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import {
  MarginProblemsWidget,
  PriceChangesWidget,
  SuppliersWidget,
  UnmatchedIngredientsWidget,
  UpcomingMenusWidget,
  WasteWidget,
} from "@/components/dashboard/widgets";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface Summary {
  price_alerts: number;
  cost_problems: number;
  unmatched_ingredients: number;
  invoices_to_check: number;
  upcoming_menus: number;
  flagged_prices: number;
  recipe_count: number;
  halfproduct_count: number;
  product_count: number;
  supplier_count: number;
  menu_count: number;
  menu_card_count: number;
}

const PERIODS = [
  { days: 7, label: "Deze week" },
  { days: 30, label: "Deze maand" },
  { days: 90, label: "Kwartaal" },
  { days: 365, label: "Jaar" },
];

/**
 * Dashboard: wat is er veranderd, waar zit een probleem, waar moet ik iets
 * doen. Vat uitsluitend bestaande gegevens samen — er wordt hier niets
 * apart bijgehouden en er zit bewust geen voorraad in.
 *
 * Elk blok haalt zijn eigen gegevens op, zodat een traag blok de rest niet
 * ophoudt.
 */
export default function DashboardPage() {
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;

  const [summary, setSummary] = useState<Summary | null>(null);
  const [days, setDays] = useState(30);
  const [supplierName, setSupplierName] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [hiddenWidgets, setHiddenWidgets] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("dash:hidden");
      if (raw) setHiddenWidgets(JSON.parse(raw));
    } catch {
      /* geblokkeerde opslag mag het dashboard niet breken */
    }
  }, []);

  const hideWidget = useCallback((id: string) => {
    setHiddenWidgets((prev) => {
      const next = [...prev, id];
      try {
        localStorage.setItem("dash:hidden", JSON.stringify(next));
      } catch {
        /* niets aan te doen */
      }
      return next;
    });
  }, []);

  function resetWidgets() {
    setHiddenWidgets([]);
    try {
      localStorage.removeItem("dash:hidden");
    } catch {
      /* niets aan te doen */
    }
  }

  useEffect(() => {
    const supabase = createClient();
    supabase
      .rpc("dashboard_summary", { p_company_id: referenceCompanyId })
      .then(({ data }) => {
        if (data && data.length > 0) setSummary(data[0] as Summary);
      });
    supabase
      .from("suppliers")
      .select("name")
      .order("name")
      .then(({ data }) => setSuppliers((data ?? []).map((s) => s.name)));
    supabase
      .from("recipes")
      .select("category")
      .eq("recipe_kind", "gerecht")
      .not("category", "is", null)
      .then(({ data }) => {
        setCategories(
          [...new Set((data ?? []).map((r) => r.category).filter(Boolean) as string[])].sort()
        );
      });
  }, [referenceCompanyId]);

  const filters = { companyId: referenceCompanyId, days, supplierName, category };
  const isHidden = (id: string) => hiddenWidgets.includes(id);

  return (
    <>
      <Topbar title="Dashboard" />
      <main className="space-y-4 p-6">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Attention label="Prijsalarmen" value={summary?.price_alerts} href="/leveranciers/prijzen/wijzigingen" />
          <Attention label="Margeproblemen" value={summary?.cost_problems} href="/recepturen" />
          <Attention label="Niet herkend" value={summary?.unmatched_ingredients} href="/producten/opschonen" />
          <Attention label="Prijzen te controleren" value={summary?.flagged_prices} href="/producten/opschonen" />
          <Attention label="Facturen" value={summary?.invoices_to_check} href="/leveranciers/facturen/postvak-in" />
          <Attention label="Menu's op komst" value={summary?.upcoming_menus} href="/menus" neutral />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <span className="text-xs uppercase tracking-wide text-muted">Periode</span>
          <div className="flex gap-1 rounded-md bg-background p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  days === p.days
                    ? "bg-surface font-medium text-foreground shadow-sm"
                    : "text-muted hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <select
            value={supplierName ?? ""}
            onChange={(e) => setSupplierName(e.target.value || null)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="">Alle leveranciers</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={category ?? ""}
            onChange={(e) => setCategory(e.target.value || null)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="">Alle categorieën</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {hiddenWidgets.length > 0 && (
            <button
              onClick={resetWidgets}
              className="ml-auto flex items-center gap-1 text-xs text-muted hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              {hiddenWidgets.length} verborgen blok(ken) terughalen
            </button>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <PriceChangesWidget widgetId="alarmen" title="Prijsalarmen" direction="alle" alertsOnly filters={filters} hidden={isHidden("alarmen")} onHide={hideWidget} />
            <MarginProblemsWidget filters={filters} hidden={isHidden("marge")} onHide={hideWidget} />
            <PriceChangesWidget widgetId="stijgers" title="Grootste prijsstijgers" direction="stijging" filters={filters} hidden={isHidden("stijgers")} onHide={hideWidget} />
            <PriceChangesWidget widgetId="dalers" title="Grootste prijsdalers" direction="daling" filters={filters} hidden={isHidden("dalers")} onHide={hideWidget} />
          </div>

          <div className="space-y-4">
            <UpcomingMenusWidget filters={filters} hidden={isHidden("menus")} onHide={hideWidget} />
            <WasteWidget filters={filters} hidden={isHidden("afval")} onHide={hideWidget} />
            <UnmatchedIngredientsWidget hidden={isHidden("nietherkend")} onHide={hideWidget} />
            <SuppliersWidget hidden={isHidden("leveranciers")} onHide={hideWidget} />

            <Card>
              <CardContent className="pt-4">
                <p className="mb-3 text-sm font-medium">Statistieken</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Gerechten" value={summary?.recipe_count} href="/recepturen" />
                  <Stat label="Halfproducten" value={summary?.halfproduct_count} href="/halfproducten" />
                  <Stat label="Ingrediënten" value={summary?.product_count} href="/producten" />
                  <Stat label="Leveranciers" value={summary?.supplier_count} href="/leveranciers" />
                  <Stat label="Menu's & buffetten" value={summary?.menu_count} href="/menus" />
                  <Stat label="Menukaarten" value={summary?.menu_card_count} href="/menukaarten" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}

/** Tegel in de samenvatting; kleurt alleen als er daadwerkelijk iets te doen is. */
function Attention({
  label, value, href, neutral,
}: {
  label: string; value: number | undefined; href: string; neutral?: boolean;
}) {
  const needsAction = !neutral && (value ?? 0) > 0;
  return (
    <Link
      href={href}
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-colors",
        needsAction
          ? "border-copper/40 bg-copper/5 hover:bg-copper/10"
          : "border-border bg-surface hover:bg-background"
      )}
    >
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("tabular text-2xl font-semibold", needsAction ? "text-copper" : "text-foreground")}>
        {value ?? "—"}
      </p>
    </Link>
  );
}

function Stat({ label, value, href }: { label: string; value: number | undefined; href: string }) {
  return (
    <Link href={href} className="rounded-md px-2 py-1.5 hover:bg-background">
      <p className="tabular text-lg font-semibold">{value ?? "—"}</p>
      <p className="text-xs text-muted">{label}</p>
    </Link>
  );
}

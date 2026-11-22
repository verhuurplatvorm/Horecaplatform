"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileCheck2, RotateCcw } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import {
  MarginProblemsWidget,
  PriceAlertsWidget,
  UnmatchedIngredientsWidget,
  WasteWidget,
  type UnmatchedLine,
} from "@/components/dashboard/widgets";
import { PriceCheckWidget } from "@/components/dashboard/price-check-widget";
import { HaccpWidget } from "@/components/dashboard/haccp-widget";
import { HaccpLanding } from "@/components/haccp/haccp-landing";
import { StickerQuickButton } from "@/components/stickers/sticker-quick-button";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { dashboardHref, scopeCompanyIds, type DashboardScope } from "@/lib/dashboard-links";
import {
  countUnmatchedNames,
  fetchMarginProblems,
  fetchPriceAlerts,
  priceAlertCount,
  type PriceAlerts,
} from "@/lib/dashboard-data";
import type { DashboardMarginProblemRow } from "@/lib/types/database";

/** Werkvoorraden zonder periode: aantallen uit dezelfde functies als de bestemmingspagina's. */
interface QueueCounts {
  flagged_prices: number;
  invoices_to_check: number;
  mail_to_process: number;
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
  const { scope, activeCompanyIds, loading: companiesLoading } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;
  // Groepsweergave = alle bedrijven (null); anders precies de gekozen bedrijven.
  const companyIds = scopeCompanyIds(scope, activeCompanyIds);
  const companyKey = companyIds ? companyIds.join(",") : "alle";

  const [queueState, setQueueState] = useState<{ key: string; queues: QueueCounts; unmatched: UnmatchedLine[] } | null>(null);
  // Per filtercombinatie bewaard: een oud antwoord telt niet als "geladen".
  const [marginState, setMarginState] = useState<{ key: string; rows: DashboardMarginProblemRow[] } | null>(null);
  const [alertState, setAlertState] = useState<{ key: string; data: PriceAlerts } | null>(null);
  const [days, setDays] = useState(30);
  const [supplierName, setSupplierName] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [hiddenWidgets, setHiddenWidgets] = useState<string[]>([]);
  // Standaard alleen de actuele kaart; "Alles" blijft één klik weg.
  const [onlyCurrent, setOnlyCurrent] = useState(true);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem("dash:scope") === "alles") setOnlyCurrent(false);
    } catch {
      /* geblokkeerde opslag mag het dashboard niet breken */
    }
  }, []);

  function changeOnlyCurrent(value: boolean) {
    setOnlyCurrent(value);
    try {
      localStorage.setItem("dash:scope", value ? "actueel" : "alles");
    } catch {
      /* niets aan te doen */
    }
  }

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

  // Werkvoorraden en niet-gekoppelde regels (geen periode).
  const queueKey = `${companyKey}|${onlyCurrent}`;
  useEffect(() => {
    if (companiesLoading) return;
    let cancelled = false;
    const ids = companyKey === "alle" ? null : companyKey.split(",");
    const supabase = createClient();
    Promise.all([
      supabase.rpc("dashboard_flagged_price_ids", { p_company_ids: ids, p_only_current: onlyCurrent }),
      supabase.rpc("dashboard_invoice_ids", { p_company_ids: ids }),
      supabase.rpc("dashboard_mail_ids", { p_company_ids: ids }),
      supabase.rpc("dashboard_unmatched_lines", { p_company_ids: ids, p_only_current: onlyCurrent }),
    ]).then(([flagged, invoices, mail, lines]) => {
      // Alleen het antwoord van de laatst gekozen filters telt (geen oude
      // antwoorden die een nieuwere teller overschrijven).
      if (cancelled) return;
      setQueueState({
        key: queueKey,
        queues: {
          flagged_prices: flagged.data?.length ?? 0,
          invoices_to_check: invoices.data?.length ?? 0,
          mail_to_process: mail.data?.length ?? 0,
        },
        unmatched: ((lines.data ?? []) as UnmatchedLine[]).sort((a, b) =>
          (a.name ?? "").localeCompare(b.name ?? "", "nl"),
        ),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [queueKey, companyKey, onlyCurrent, companiesLoading]);
  const queues = queueState?.key === queueKey ? queueState.queues : null;
  const unmatched = queueState?.key === queueKey ? queueState.unmatched : null;

  // Margeproblemen: dezelfde rijen voor tegel, blok en de Gerechten-pagina.
  const marginKey = `${companyKey}|${onlyCurrent}|${category ?? ""}`;
  useEffect(() => {
    if (companiesLoading) return;
    let cancelled = false;
    fetchMarginProblems(createClient(), {
      companyIds: companyKey === "alle" ? null : companyKey.split(","),
      onlyCurrent,
      category,
    })
      .then((rows) => !cancelled && setMarginState({ key: marginKey, rows }))
      .catch(() => !cancelled && setMarginState({ key: marginKey, rows: [] }));
    return () => {
      cancelled = true;
    };
  }, [marginKey, companyKey, onlyCurrent, category, companiesLoading]);
  const marginRows = marginState?.key === marginKey ? marginState.rows : null;

  // Prijsalarmen: periode en leverancier tellen mee.
  const alertKey = `${companyKey}|${onlyCurrent}|${days}|${supplierName ?? ""}`;
  useEffect(() => {
    if (companiesLoading) return;
    let cancelled = false;
    fetchPriceAlerts(createClient(), {
      companyIds: companyKey === "alle" ? null : companyKey.split(","),
      onlyCurrent,
      days,
      supplierName,
    })
      .then((data) => !cancelled && setAlertState({ key: alertKey, data }))
      .catch(() => !cancelled && setAlertState({ key: alertKey, data: { alerts: [], agreed: [] } }));
    return () => {
      cancelled = true;
    };
  }, [alertKey, companyKey, onlyCurrent, days, supplierName, companiesLoading]);
  const alerts = alertState?.key === alertKey ? alertState.data : null;

  useEffect(() => {
    const supabase = createClient();
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
  }, []);

  const filters = { companyId: referenceCompanyId, days, supplierName, category, onlyCurrent };
  const queueScope: DashboardScope = { companyIds, onlyCurrent: false };
  const hrefs = {
    alerts: dashboardHref("/leveranciers/prijzen/wijzigingen", { companyIds, onlyCurrent, days, supplierName }, { filter: "alarmen" }),
    margin: dashboardHref("/recepturen", { companyIds, onlyCurrent, category }, { filter: "margeprobleem" }),
    unmatched: dashboardHref("/producten/opschonen", { companyIds, onlyCurrent }, { toon: "koppelingen" }),
    flagged: dashboardHref("/producten/opschonen", { companyIds, onlyCurrent }, { toon: "importprijzen" }),
    invoices: dashboardHref("/leveranciers/facturen", queueScope),
    mail: dashboardHref("/leveranciers/facturen/mailbox", queueScope, { tab: "verwerken" }),
  };
  const isHidden = (id: string) => hiddenWidgets.includes(id);

  return (
    <>
      <Topbar title="Dashboard" />
      <main className="space-y-4 p-6">
        <StickerQuickButton big />
        <Link
          href={hrefs.invoices}
          className={cn(
            "flex items-center justify-between rounded-lg border px-5 py-4 transition-colors",
            (queues?.invoices_to_check ?? 0) > 0
              ? "border-copper/40 bg-copper/5 hover:bg-copper/10"
              : "border-border bg-surface hover:bg-background"
          )}
        >
          <div className="flex items-center gap-3">
            <FileCheck2 className="h-6 w-6 text-copper" />
            <div>
              <p className="text-base font-semibold">Facturen controleren</p>
              <p className="text-xs text-muted">
                {(queues?.invoices_to_check ?? 0) > 0
                  ? `${queues?.invoices_to_check === 1 ? "1 factuur wacht" : `${queues?.invoices_to_check} facturen wachten`} op controle — kijk alleen de afwijkingen na`
                  : "Alle facturen zijn gecontroleerd"}
                {(queues?.mail_to_process ?? 0) > 0 &&
                  ` · daarnaast ${queues?.mail_to_process} e-mailfactu${queues?.mail_to_process === 1 ? "ur" : "ren"} te verwerken`}
              </p>
            </div>
          </div>
          <span className="tabular text-3xl font-semibold text-copper">
            {queues?.invoices_to_check ?? "—"}
          </span>
        </Link>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Attention
            label="Prijsalarmen"
            value={alerts ? priceAlertCount(alerts) : undefined}
            hint={`laatste ${days} dagen`}
            href={hrefs.alerts}
          />
          <Attention
            label="Gerechten met een margeprobleem"
            value={marginRows?.length}
            hint={onlyCurrent ? "actuele kaart" : "alle gerechten"}
            href={hrefs.margin}
          />
          <Attention
            label="Niet-gekoppelde receptregels"
            value={unmatched?.length}
            hint={unmatched ? `${countUnmatchedNames(unmatched)} namen` : undefined}
            href={hrefs.unmatched}
          />
          <Attention
            label="Importprijzen te controleren"
            value={queues?.flagged_prices}
            hint="onzeker bij import"
            href={hrefs.flagged}
          />
          <Attention label="Facturen ter controle" value={queues?.invoices_to_check} href={hrefs.invoices} />
          <Attention label="E-mailfacturen te verwerken" value={queues?.mail_to_process} href={hrefs.mail} />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <div className="flex gap-1 rounded-md bg-background p-0.5" title="Actueel = gerechten op actieve menukaarten en de actuele halfproducten, met hun ingrediënten">
            {(
              [
                [true, "Actuele kaart"],
                [false, "Alles"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                onClick={() => changeOnlyCurrent(value)}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  onlyCurrent === value
                    ? "bg-surface font-medium text-foreground shadow-sm"
                    : "text-muted hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
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

        <HaccpLanding />
        <HaccpWidget hidden={isHidden("haccp")} onHide={hideWidget} />

        <PriceCheckWidget filters={filters} hidden={isHidden("prijscontrole")} onHide={hideWidget} />

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <PriceAlertsWidget
              data={alerts ?? { alerts: [], agreed: [] }}
              loading={alerts === null}
              href={hrefs.alerts}
              hidden={isHidden("alarmen")}
              onHide={hideWidget}
              onDismissed={(id) =>
                setAlertState(
                  (prev) =>
                    prev && {
                      ...prev,
                      data: { ...prev.data, alerts: prev.data.alerts.filter((a) => a.price_row_id !== id) },
                    },
                )
              }
            />
            <MarginProblemsWidget
              rows={marginRows ?? []}
              loading={marginRows === null}
              href={hrefs.margin}
              hidden={isHidden("marge")}
              onHide={hideWidget}
            />
          </div>

          <div className="space-y-4">
            <WasteWidget filters={filters} hidden={isHidden("afval")} onHide={hideWidget} />
            <UnmatchedIngredientsWidget
              lines={unmatched ?? []}
              loading={unmatched === null}
              href={hrefs.unmatched}
              hidden={isHidden("nietherkend")}
              onHide={hideWidget}
            />

          </div>
        </div>
      </main>
    </>
  );
}

/** Tegel in de samenvatting; kleurt alleen als er daadwerkelijk iets te doen is. */
function Attention({
  label, value, href, neutral, hint,
}: {
  label: string; value: number | undefined; href: string; neutral?: boolean; hint?: string;
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
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </Link>
  );
}


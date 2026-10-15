"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { ProductViewTabs } from "@/components/products/product-view-tabs";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  diagnosePackaging,
  fmt,
  isUnitKey,
  type Diagnosis,
  type KeyBridge,
  type PackagingPrices,
  type PackagingStatus,
  type UnitKey,
} from "@/lib/packaging";

/**
 * Verpakkingscontrole: scant ALLE actieve leveranciersprijzen met de centrale
 * rekenmodule (src/lib/packaging) en toont de uitkomst als Groen / Oranje /
 * Rood. Oranje correcties worden eerst als voorbeeld getoond en pas
 * toegepast nadat de gebruiker ze expliciet bevestigt. Het zijn technische
 * correcties: alleen het verpakkingsaantal en de -omschrijving veranderen,
 * nooit de inkoopprijs, nooit verkoopprijzen.
 */

interface ScanRow {
  priceId: string;
  productId: string;
  supplierId: string;
  companyId: string | null;
  productName: string;
  supplierName: string;
  baseUnit: UnitKey;
  description: string | null;
  count: number;
  price: number;
  diagnosis: Diagnosis;
}

interface ImpactRow {
  recipe_id: string;
  recipe_name: string;
  recipe_kind: "gerecht" | "halfproduct";
  old_cost: number;
  new_cost: number;
  old_foodcost_pct: number | null;
  new_foodcost_pct: number | null;
}

const euro = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function priceLine(p: PackagingPrices, base: UnitKey): string {
  const parts: string[] = [];
  if (p.perPiece !== null) parts.push(`${euro.format(p.perPiece)} / stuk`);
  if (p.perKg !== null) parts.push(`${euro.format(p.perKg)} / kg`);
  if (p.perLiter !== null) parts.push(`${euro.format(p.perLiter)} / l`);
  if (parts.length === 0 && p.perBase !== null) parts.push(`${euro.format(p.perBase)} / ${base}`);
  return parts.join(" · ") || "—";
}

const PAGE_SIZE = 1000;

const STATUS_LABEL: Record<PackagingStatus, string> = {
  groen: "Groen — betrouwbaar",
  oranje: "Oranje — correctie voorgesteld",
  rood: "Rood — handmatig controleren",
  geen_prijs: "Zonder prijs",
};

export default function VerpakkingscontrolePage() {
  const { activeCompanyIds } = useCompanyScope();
  const referenceCompanyId = activeCompanyIds[0] ?? null;

  const [rows, setRows] = useState<ScanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [tab, setTab] = useState<PackagingStatus>("oranje");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [impact, setImpact] = useState<Record<string, ImpactRow[] | "laden" | "fout">>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      const supabase = createClient();

      const { data: unitsData, error: unitsError } = await supabase.from("units").select("id, key");
      if (unitsError || !unitsData) {
        if (!cancelled) {
          setError("Kan eenheden niet ophalen: " + (unitsError?.message ?? "onbekend"));
          setLoading(false);
        }
        return;
      }
      const keyById = new Map<string, string>(unitsData.map((u) => [u.id as string, u.key as string]));

      const all: ScanRow[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error: fetchError } = await supabase
          .from("supplier_products")
          .select(
            "id, product_id, supplier_id, company_id, packaging_description, packaging_unit_count, purchase_price, suppliers(name), products!inner(name, base_unit_id, avg_unit_quantity, avg_unit_id, net_unit_quantity, is_active)"
          )
          .is("valid_to", null)
          .eq("products.is_active", true)
          .order("id")
          .range(from, from + PAGE_SIZE - 1);
        if (fetchError) {
          if (!cancelled) {
            setError("Kan prijzen niet ophalen: " + fetchError.message);
            setLoading(false);
          }
          return;
        }
        for (const r of data ?? []) {
          // geneste relaties zitten niet in het handmatige Database-type
          const product = (r as unknown as { products: Record<string, unknown> }).products;
          const supplier = (r as unknown as { suppliers: { name: string } | null }).suppliers;
          const baseKey = keyById.get(product.base_unit_id as string);
          if (!isUnitKey(baseKey)) continue;
          const avgKey = product.avg_unit_id ? keyById.get(product.avg_unit_id as string) : null;
          const bridge: KeyBridge | null =
            product.avg_unit_quantity && isUnitKey(avgKey)
              ? {
                  quantity: Number(product.avg_unit_quantity),
                  unit: avgKey,
                  netQuantity: product.net_unit_quantity ? Number(product.net_unit_quantity) : null,
                }
              : null;
          const count = Number(r.packaging_unit_count);
          const price = Number(r.purchase_price);
          all.push({
            priceId: r.id as string,
            productId: r.product_id as string,
            supplierId: r.supplier_id as string,
            companyId: (r.company_id as string | null) ?? null,
            productName: product.name as string,
            supplierName: supplier?.name ?? "onbekend",
            baseUnit: baseKey,
            description: (r.packaging_description as string | null) ?? null,
            count,
            price,
            diagnosis: diagnosePackaging({
              name: product.name as string,
              baseUnit: baseKey,
              bridge,
              description: (r.packaging_description as string | null) ?? null,
              count,
              price,
            }),
          });
        }
        if ((data?.length ?? 0) < PAGE_SIZE) break;
      }
      if (cancelled) return;
      setRows(all);
      setSelected(new Set());
      setImpact({});
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const byStatus = useMemo(() => {
    const groups: Record<PackagingStatus, ScanRow[]> = { groen: [], oranje: [], rood: [], geen_prijs: [] };
    for (const r of rows) groups[r.diagnosis.status].push(r);
    return groups;
  }, [rows]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = byStatus[tab];
    if (!term) return list;
    return list.filter(
      (r) => r.productName.toLowerCase().includes(term) || r.supplierName.toLowerCase().includes(term)
    );
  }, [byStatus, tab, search]);

  const groenMetNotitie = byStatus.groen.filter((r) => r.diagnosis.notes.length > 0);
  const selectedRows = byStatus.oranje.filter((r) => selected.has(r.priceId));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function loadImpact(row: ScanRow) {
    if (!referenceCompanyId || !row.diagnosis.proposal?.prices.perBase) return;
    setImpact((prev) => ({ ...prev, [row.priceId]: "laden" }));
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("get_price_change_impact", {
      p_product_id: row.productId,
      p_company_id: referenceCompanyId,
      p_new_price_per_base_unit: row.diagnosis.proposal.prices.perBase,
    });
    setImpact((prev) => ({ ...prev, [row.priceId]: rpcError ? "fout" : ((data as ImpactRow[]) ?? []) }));
  }

  async function applySelected() {
    setApplying(true);
    setError(null);
    setResultMessage(null);
    const supabase = createClient();
    const batchId = crypto.randomUUID();
    let corrected = 0;
    let historyRows = 0;
    const failures: string[] = [];

    for (const row of selectedRows) {
      const proposal = row.diagnosis.proposal;
      if (!proposal) continue;
      try {
        // Alle regels van dezelfde leverancier/ingrediënt/bedrijf met dezelfde
        // foute verpakking (ook gesloten historie) mee corrigeren, zodat oude
        // en nieuwe prijs vergelijkbaar blijven.
        let query = supabase
          .from("supplier_products")
          .select("id, packaging_unit_count, packaging_description, price_per_base_unit, purchase_price")
          .eq("product_id", row.productId)
          .eq("supplier_id", row.supplierId);
        query = row.companyId ? query.eq("company_id", row.companyId) : query.is("company_id", null);
        const { data: related, error: relatedError } = await query;
        if (relatedError) throw new Error(relatedError.message);

        const targets = (related ?? []).filter(
          (r) => Math.abs(Number(r.packaging_unit_count) - row.count) < 0.0001
        );
        if (!targets.some((t) => t.id === row.priceId)) throw new Error("prijsregel is intussen gewijzigd");

        for (const target of targets) {
          const newPerBase =
            Number(target.purchase_price) > 0 ? Number(target.purchase_price) / proposal.count : null;
          const { error: logError } = await supabase.from("packaging_corrections").insert({
            batch_id: batchId,
            product_id: row.productId,
            supplier_product_id: target.id,
            supplier_id: row.supplierId,
            kind: "technisch",
            old_packaging_unit_count: target.packaging_unit_count,
            new_packaging_unit_count: proposal.count,
            old_packaging_description: target.packaging_description,
            new_packaging_description: proposal.description || target.packaging_description,
            old_price_per_base_unit: target.price_per_base_unit,
            new_price_per_base_unit: newPerBase,
            reason: row.diagnosis.reason,
          });
          if (logError) throw new Error("logboek: " + logError.message);

          const { error: updateError } = await supabase
            .from("supplier_products")
            .update({
              packaging_unit_count: proposal.count,
              packaging_description: proposal.description || target.packaging_description,
              flagged_for_review: false,
            })
            .eq("id", target.id);
          if (updateError) throw new Error(updateError.message);
          if (target.id !== row.priceId) historyRows++;
        }
        corrected++;
      } catch (e) {
        failures.push(`${row.productName}: ${(e as Error).message}`);
      }
    }

    setApplying(false);
    setConfirmOpen(false);
    setResultMessage(
      `${corrected} correctie(s) toegepast` +
        (historyRows > 0 ? ` (inclusief ${historyRows} oudere prijsregel(s) met dezelfde fout)` : "") +
        ". Kostprijzen van halfproducten, gerechten, menu's en menukaarten volgen automatisch; verkoopprijzen zijn niet gewijzigd." +
        (failures.length > 0 ? ` Mislukt: ${failures.join("; ")}` : "")
    );
    setLoading(true);
    setReloadToken((t) => t + 1);
  }

  const tabs: { key: PackagingStatus; label: string; className: string }[] = [
    { key: "oranje", label: "Oranje", className: "text-warning" },
    { key: "rood", label: "Rood", className: "text-danger" },
    { key: "groen", label: "Groen", className: "text-success" },
    { key: "geen_prijs", label: "Zonder prijs", className: "text-muted" },
  ];

  return (
    <>
      <Topbar title="Ingrediënten — verpakkingscontrole" />
      <main className="max-w-6xl space-y-4 p-6">
        <ProductViewTabs />

        <Card>
          <CardContent className="space-y-2 pt-6 text-sm">
            <p>
              Alle actieve leveranciersprijzen worden gecontroleerd met één centrale rekenregel: een
              verpakking van <strong>18 × 260 gram</strong> bevat <strong>18 stuks van 260 gram</strong>,
              niet 4.680 stuks. Hier wordt <strong>niets automatisch gewijzigd</strong>: oranje
              correcties worden pas toegepast nadat jij ze selecteert en bevestigt. Alleen het
              verpakkingsaantal en de omschrijving worden aangepast. Inkoopprijzen en
              verkoopprijzen blijven gelijk en er komt geen prijsalarm.
            </p>
          </CardContent>
        </Card>

        {error && <p className="rounded-md bg-danger/10 p-3 text-sm text-danger">{error}</p>}
        {resultMessage && <p className="rounded-md bg-success/10 p-3 text-sm text-success">{resultMessage}</p>}

        {loading ? (
          <p className="text-sm text-muted">Alle prijzen worden gecontroleerd…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <SummaryCard
                icon={<CheckCircle2 className="h-5 w-5 text-success" />}
                label="Groen"
                value={byStatus.groen.length}
                hint={`${groenMetNotitie.length} met opmerking`}
              />
              <SummaryCard
                icon={<CircleAlert className="h-5 w-5 text-warning" />}
                label="Oranje"
                value={byStatus.oranje.length}
                hint="correctie voorgesteld"
              />
              <SummaryCard
                icon={<TriangleAlert className="h-5 w-5 text-danger" />}
                label="Rood"
                value={byStatus.rood.length}
                hint="handmatig controleren"
              />
              <SummaryCard
                icon={<CircleAlert className="h-5 w-5 text-muted" />}
                label="Zonder prijs"
                value={byStatus.geen_prijs.length}
                hint="€ 0 ingevuld"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-border">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "border-b-2 px-3 py-2 text-sm transition-colors",
                    tab === t.key ? "border-teal font-medium text-teal" : "border-transparent text-muted hover:text-foreground"
                  )}
                >
                  {t.label} ({byStatus[t.key].length})
                </button>
              ))}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Zoek op ingrediënt of leverancier"
                className="input ml-auto h-8 w-64"
              />
            </div>

            <p className="text-sm text-muted">{STATUS_LABEL[tab]}</p>

            {tab === "oranje" && byStatus.oranje.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setSelected(new Set(visible.map((r) => r.priceId)))}>
                  Alles selecteren
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
                  Niets selecteren
                </Button>
                <Button size="sm" disabled={selectedRows.length === 0} onClick={() => setConfirmOpen(true)}>
                  Geselecteerde correcties toepassen ({selectedRows.length})
                </Button>
              </div>
            )}

            {visible.length === 0 ? (
              <p className="text-sm text-muted">Geen regels in deze groep.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background text-left text-xs uppercase tracking-wide text-muted">
                      {tab === "oranje" && <th className="px-3 py-2" />}
                      <th className="px-3 py-2 font-medium">Ingrediënt</th>
                      <th className="px-3 py-2 font-medium">Leverancier</th>
                      <th className="px-3 py-2 font-medium">Huidige verpakking</th>
                      {tab === "oranje" && <th className="px-3 py-2 font-medium">Voorgestelde verpakking</th>}
                      <th className="px-3 py-2 font-medium">Kostprijs nu</th>
                      {tab === "oranje" && <th className="px-3 py-2 font-medium">Correcte kostprijs</th>}
                      <th className="px-3 py-2 font-medium">{tab === "groen" ? "Opmerking" : "Reden"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.slice(0, 300).map((r) => (
                      <RowView
                        key={r.priceId}
                        row={r}
                        tab={tab}
                        checked={selected.has(r.priceId)}
                        onToggle={() => toggle(r.priceId)}
                        impact={impact[r.priceId]}
                        canShowImpact={Boolean(referenceCompanyId)}
                        onShowImpact={() => loadImpact(r)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {visible.length > 300 && (
              <p className="text-xs text-muted">
                De eerste 300 van {visible.length} regels worden getoond. Gebruik het zoekveld om te verfijnen.
              </p>
            )}
          </>
        )}
      </main>

      {confirmOpen && (
      <Modal onClose={() => !applying && setConfirmOpen(false)} title="Correcties toepassen?">
        <div className="space-y-3 text-sm">
          <p>
            Je past <strong>{selectedRows.length}</strong> technische verpakkingscorrectie(s) toe. Alleen het
            verpakkingsaantal en de omschrijving veranderen. Inkoopprijzen, verkoopprijzen en
            prijsgeschiedenis blijven gelijk. De oude waarden worden bewaard in het logboek.
          </p>
          <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5">
            {selectedRows.map((r) => (
              <li key={r.priceId}>
                {r.productName}: {fmt(r.count)} → {fmt(r.diagnosis.proposal?.count)} {r.baseUnit}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={applying}>
              Annuleren
            </Button>
            <Button onClick={applySelected} disabled={applying}>
              {applying ? "Bezig…" : "Ja, toepassen"}
            </Button>
          </div>
        </div>
      </Modal>
      )}
    </>
  );
}

function SummaryCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number; hint: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-xs text-muted">{hint}</div>
      </CardContent>
    </Card>
  );
}

function RowView({
  row,
  tab,
  checked,
  onToggle,
  impact,
  canShowImpact,
  onShowImpact,
}: {
  row: ScanRow;
  tab: PackagingStatus;
  checked: boolean;
  onToggle: () => void;
  impact: ImpactRow[] | "laden" | "fout" | undefined;
  canShowImpact: boolean;
  onShowImpact: () => void;
}) {
  const d = row.diagnosis;
  const colSpan = tab === "oranje" ? 8 : 5;
  return (
    <>
      <tr className="border-t border-border align-top">
        {tab === "oranje" && (
          <td className="px-3 py-2">
            <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Selecteer ${row.productName}`} />
          </td>
        )}
        <td className="px-3 py-2">
          <Link href={`/producten/${row.productId}`} className="font-medium text-teal hover:underline">
            {row.productName}
          </Link>
        </td>
        <td className="px-3 py-2 text-muted">{row.supplierName}</td>
        <td className="px-3 py-2">
          <div>{row.description ?? "—"}</div>
          <div className="text-xs text-muted">
            opgeslagen: {fmt(row.count)} {row.baseUnit} · {euro.format(row.price)} per verpakking
          </div>
        </td>
        {tab === "oranje" && (
          <td className="px-3 py-2">
            <div>{d.proposal?.description || row.description}</div>
            <div className="text-xs text-muted">
              nieuw: {fmt(d.proposal?.count)} {row.baseUnit}
            </div>
          </td>
        )}
        <td className="px-3 py-2">{priceLine(d.current, row.baseUnit)}</td>
        {tab === "oranje" && (
          <td className="px-3 py-2 font-medium">{d.proposal ? priceLine(d.proposal.prices, row.baseUnit) : "—"}</td>
        )}
        <td className="px-3 py-2 text-muted">
          {tab === "groen" ? d.notes.join(" ") || "—" : d.reason}
          {d.alternative && <div className="mt-1 text-foreground">{d.alternative}</div>}
          {tab === "oranje" && canShowImpact && (
            <div className="mt-1">
              <button type="button" onClick={onShowImpact} className="text-teal hover:underline">
                Toon effect op recepten
              </button>
            </div>
          )}
        </td>
      </tr>
      {impact !== undefined && (
        <tr className="bg-background">
          <td colSpan={colSpan} className="px-3 py-2 text-xs">
            {impact === "laden" && "Effect wordt berekend…"}
            {impact === "fout" && "Effect kon niet worden berekend."}
            {Array.isArray(impact) &&
              (impact.length === 0 ? (
                "Dit ingrediënt wordt in geen enkel recept gebruikt."
              ) : (
                <ul className="space-y-0.5">
                  {impact.map((i) => (
                    <li key={i.recipe_id}>
                      {i.recipe_name} ({i.recipe_kind}): kostprijs {euro.format(i.old_cost)} → {euro.format(i.new_cost)}
                      {i.new_foodcost_pct !== null && ` · foodcost ${fmt(i.old_foodcost_pct, 1)}% → ${fmt(i.new_foodcost_pct, 1)}%`}
                    </li>
                  ))}
                </ul>
              ))}
          </td>
        </tr>
      )}
    </>
  );
}

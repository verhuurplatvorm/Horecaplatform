"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Download, Plus } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ConsumptionType, WasteReason } from "@/lib/types/database";

interface Row {
  id: string;
  registered_at: string;
  quantity: number;
  waste_value: number | null;
  note: string | null;
  is_cancelled: boolean;
  productName: string | null;
  recipeName: string | null;
  unitName: string | null;
  reasonName: string | null;
  staffName: string | null;
  companyName: string | null;
}

const PERIODS = [
  { key: "vandaag", label: "Vandaag" },
  { key: "week", label: "Deze week" },
  { key: "vorigeweek", label: "Vorige week" },
  { key: "maand", label: "Deze maand" },
] as const;

function periodRange(key: string): { from: string; to: string } {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (key === "vandaag") return { from: iso(today), to: iso(today) };
  if (key === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return { from: iso(start), to: iso(today) };
  }
  if (key === "vorigeweek") {
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: iso(start), to: iso(end) };
  }
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: iso(start), to: iso(today) };
}

/**
 * Overzicht van geregistreerd afval, met filters en totalen onderaan.
 * Toont uitsluitend wat daadwerkelijk geregistreerd is; er wordt niets
 * afgeleid uit voorraad.
 */
export default function AfvalPage() {
  const { activeCompanyIds } = useCompanyScope();
  const companyId = activeCompanyIds[0] ?? null;

  const [regType, setRegType] = useState<ConsumptionType>("afval");
  const [period, setPeriod] = useState<string>("maand");
  const [reasonId, setReasonId] = useState<string>("");
  const [staffId, setStaffId] = useState<string>("");
  const [reasons, setReasons] = useState<WasteReason[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("waste_reasons")
      .select("*")
      .order("sort_order")
      .then(({ data }) => setReasons((data as WasteReason[]) ?? []));
    supabase
      .from("user_profiles")
      .select("id, full_name")
      .order("full_name")
      .then(({ data }) => setStaff(data ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { from, to } = periodRange(period);

    let q = supabase
      .from("waste_registrations")
      .select("*")
      .gte("registered_at", `${from}T00:00:00`)
      .lte("registered_at", `${to}T23:59:59`)
      .order("registered_at", { ascending: false })
      .limit(500);
    q = q.eq("registration_type", regType);
    if (companyId) q = q.eq("company_id", companyId);
    if (reasonId) q = q.eq("reason_id", reasonId);
    if (staffId) q = q.eq("registered_by", staffId);

    const { data } = await q;
    const list = data ?? [];

    // Namen erbij halen in enkele queries, niet per regel.
    const productIds = [...new Set(list.map((r) => r.product_id).filter(Boolean))] as string[];
    const recipeIds = [...new Set(list.map((r) => r.recipe_id).filter(Boolean))] as string[];
    const [{ data: products }, { data: recipes }, { data: units }, { data: companies }] =
      await Promise.all([
        productIds.length
          ? supabase.from("products").select("id, name, custom_name").in("id", productIds)
          : Promise.resolve({ data: [] }),
        recipeIds.length
          ? supabase.from("recipes").select("id, name").in("id", recipeIds)
          : Promise.resolve({ data: [] }),
        supabase.from("units").select("id, name"),
        supabase.from("companies").select("id, name"),
      ]);

    const productName = new Map((products ?? []).map((p) => [p.id, p.custom_name?.trim() || p.name]));
    const recipeName = new Map((recipes ?? []).map((r) => [r.id, r.name]));
    const unitName = new Map((units ?? []).map((u) => [u.id, u.name]));
    const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
    const reasonName = new Map(reasons.map((r) => [r.id, r.name]));
    const staffName = new Map(staff.map((s) => [s.id, s.full_name]));

    setRows(
      list.map((r) => ({
        id: r.id,
        registered_at: r.registered_at,
        quantity: r.quantity,
        waste_value: r.waste_value,
        note: r.note,
        is_cancelled: r.is_cancelled,
        productName: r.product_id ? productName.get(r.product_id) ?? null : null,
        recipeName: r.recipe_id ? recipeName.get(r.recipe_id) ?? null : null,
        unitName: r.unit_id ? unitName.get(r.unit_id) ?? null : null,
        reasonName: r.reason_id ? reasonName.get(r.reason_id) ?? null : null,
        staffName: r.registered_by ? staffName.get(r.registered_by) ?? null : null,
        companyName: r.company_id ? companyName.get(r.company_id) ?? null : null,
      }))
    );
    setLoading(false);
  }, [period, reasonId, staffId, companyId, reasons, staff, regType]);

  useEffect(() => {
    load();
  }, [load]);

  const active = rows.filter((r) => !r.is_cancelled);
  const totalValue = active.reduce((s, r) => s + (r.waste_value ?? 0), 0);

  function exportCsv() {
    const header = [
      "Datum", "Tijd", "Medewerker", "Product", "Type", "Hoeveelheid",
      "Eenheid", "Reden", "Afvalwaarde", "Locatie", "Opmerking",
    ];
    const lines = active.map((r) => {
      const d = new Date(r.registered_at);
      return [
        d.toLocaleDateString("nl-NL"), d.toLocaleTimeString("nl-NL"),
        r.staffName ?? "", r.productName ?? r.recipeName ?? "",
        r.productName ? "ingrediënt" : "halfproduct",
        String(r.quantity), r.unitName ?? "", r.reasonName ?? "",
        r.waste_value?.toFixed(2) ?? "", r.companyName ?? "", r.note ?? "",
      ];
    });
    const csv = [header, ...lines]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = regType === "afval" ? "afvalregistraties.csv" : "personeelsmaaltijden.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Topbar title="Afval & personeelsmaaltijden" />
      <main className="space-y-4 p-6">
        <nav className="flex gap-1 border-b border-border">
          {(
            [
              ["afval", "Afval / derving"],
              ["personeelsmaaltijd", "Personeelsmaaltijden"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRegType(key)}
              className={cn(
                "border-b-2 px-3 py-2 text-sm",
                regType === key
                  ? "border-teal font-medium text-teal"
                  : "border-transparent text-muted hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {regType === "afval"
              ? "Wat is er weggegooid, waarom, en wat kostte dat. Losstaand van voorraad."
              : "Wat is er intern door personeel gegeten, en wat kostte dat."}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={exportCsv}>
              <Download className="h-4 w-4" />
              Exporteren
            </Button>
            <Link href="/afval/nieuw">
              <Button>
                <Plus className="h-4 w-4" />
                Registreren
              </Button>
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
          <div className="flex gap-1 rounded-md bg-background p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs",
                  period === p.key
                    ? "bg-surface font-medium text-foreground shadow-sm"
                    : "text-muted hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {regType === "afval" && (
            <select
              value={reasonId}
              onChange={(e) => setReasonId(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="">Alle redenen</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
          <select
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="">Alle medewerkers</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name}</option>
            ))}
          </select>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2 font-medium">Datum/tijd</th>
                    <th className="px-4 py-2 font-medium">Medewerker</th>
                    <th className="px-4 py-2 font-medium">Product</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 text-right font-medium">Hoeveelheid</th>
                    {regType === "afval" && (
                      <th className="px-4 py-2 font-medium">Reden</th>
                    )}
                    <th className="px-4 py-2 text-right font-medium">
                      {regType === "afval" ? "Afvalwaarde" : "Kosten"}
                    </th>
                    <th className="px-4 py-2 font-medium">Locatie</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-4 py-2 text-muted">
                        {new Date(r.registered_at).toLocaleString("nl-NL", {
                          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-2">{r.staffName ?? "—"}</td>
                      <td className="px-4 py-2 font-medium">
                        {r.productName ?? r.recipeName ?? "—"}
                        {r.note && (
                          <span className="ml-2 text-xs font-normal text-muted">{r.note}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted">
                        {r.productName ? "ingrediënt" : "halfproduct"}
                      </td>
                      <td className="px-4 py-2 text-right tabular">
                        {r.quantity} {r.unitName ?? ""}
                      </td>
                      {regType === "afval" && (
                        <td className="px-4 py-2 text-muted">{r.reasonName ?? "—"}</td>
                      )}
                      <td className="px-4 py-2 text-right tabular font-medium">
                        {r.waste_value != null ? `€ ${r.waste_value.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-2 text-muted">{r.companyName ?? "—"}</td>
                    </tr>
                  ))}
                  {active.length === 0 && (
                    <tr>
                      <td colSpan={regType === "afval" ? 8 : 7} className="px-4 py-8 text-center text-muted">
                        {loading
                          ? "Registraties laden…"
                          : "Geen afvalregistraties in deze periode."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-3">
              <span className="text-sm text-muted">
                {active.length} registratie(s)
              </span>
              <span className="tabular text-lg font-semibold text-danger">
                € {totalValue.toFixed(2)}{" "}
                {regType === "afval" ? "afvalwaarde" : "personeelskosten"}
              </span>
            </div>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

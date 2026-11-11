"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Printer, RotateCcw, Search } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useCompanyScope } from "@/components/company-context";
import { StaffSwitcher } from "@/components/haccp/staff-switcher";
import {
  haccpError,
  readStaffSession,
  writeStaffSession,
} from "@/lib/haccp/cleaning";
import { addDaysISO, formatDateNL, todayISO } from "@/lib/stickers/stickers";
import {
  StickerLabel,
  StickerPrintArea,
  type StickerLabelData,
} from "@/components/stickers/sticker-label";
import type { StickerPrint } from "@/lib/types/database";

const TYPE_LABEL: Record<StickerPrint["sticker_type"], string> = {
  productie: "Productiedatum",
  vers: "Vers",
  diepvries: "Diepvries",
};

function toLabel(r: StickerPrint): StickerLabelData {
  return {
    type: r.sticker_type,
    productName: r.product_name,
    productionDate: r.production_date,
    productionTime: r.production_time,
    expiryDate: r.expiry_date,
    storageTemp: r.storage_temp,
    employeeName: r.employee_name,
    companyName: r.company_name,
    batchNumber: r.batch_number,
    quantity: r.quantity,
    note: r.note,
  };
}

function printedAt(iso: string) {
  return new Date(iso).toLocaleString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StickerHistoriePage() {
  const { activeCompanyIds, companies } = useCompanyScope();
  const [from, setFrom] = useState(() => addDaysISO(todayISO(), -30));
  const [to, setTo] = useState(() => todayISO());
  const [type, setType] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<StickerPrint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<StickerPrint | null>(null);

  const load = useCallback(async () => {
    if (activeCompanyIds.length === 0) return;
    const supabase = createClient();
    let query = supabase
      .from("sticker_prints")
      .select("*")
      .in("company_id", activeCompanyIds)
      .gte("printed_at", `${from}T00:00:00`)
      .lt("printed_at", `${addDaysISO(to, 1)}T00:00:00`)
      .order("printed_at", { ascending: false })
      .limit(2000);
    if (type)
      query = query.eq("sticker_type", type as StickerPrint["sticker_type"]);
    if (employeeId) query = query.eq("employee_id", employeeId);
    if (q.trim())
      query = query.ilike("product_name", `%${q.trim().replace(/[%_]/g, "")}%`);
    const { data, error: err } = await query;
    if (err) {
      setError(haccpError(err));
      return;
    }
    setError(null);
    setRows((data as StickerPrint[]) ?? []);
  }, [activeCompanyIds, from, to, type, employeeId, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const employees = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows ?? []) m.set(r.employee_id, r.employee_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    return {
      count: list.length,
      stickers: list.reduce((s, r) => s + r.sticker_count, 0),
      reprints: list.filter((r) => r.reprint_of).length,
      changed: list.filter((r) => !r.reprint_of && r.term_changed).length,
    };
  }, [rows]);

  return (
    <>
      <Topbar title="Stickerhistorie" />
      <main className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-xs font-medium text-muted">
              Product
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="input pl-8!"
                placeholder="Zoek product"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Van
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Tot en met
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Stickertype
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="input"
            >
              <option value="">Alle</option>
              <option value="productie">Productiedatum</option>
              <option value="vers">Vers</option>
              <option value="diepvries">Diepvries</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Medewerker
            </label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="input"
            >
              <option value="">Iedereen</option>
              {employees.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <Link href="/stickers" className="ml-auto">
            <Button>
              <Printer className="h-4 w-4" /> Sticker afdrukken
            </Button>
          </Link>
        </div>

        <p className="text-sm text-muted">
          {totals.count} registraties · {totals.stickers} stickers ·{" "}
          {totals.reprints} herdrukken · {totals.changed} met aangepaste termijn
          {activeCompanyIds.length > 1 &&
            " · bedrijf kiezen via de bedrijfsselector rechtsboven"}
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-medium">Afgedrukt</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Productie / invries</th>
                <th className="px-3 py-2 font-medium">Houdbaar tot</th>
                <th className="px-3 py-2 font-medium">Medewerker</th>
                {companies.length > 1 && (
                  <th className="px-3 py-2 font-medium">Bedrijf</th>
                )}
                <th className="px-3 py-2 text-right font-medium">Aantal</th>
                <th className="px-3 py-2 font-medium">Bijzonderheden</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-muted">
                    Laden…
                  </td>
                </tr>
              )}
              {rows?.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-muted">
                    Geen stickers in deze periode.
                  </td>
                </tr>
              )}
              {rows?.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setDetail(r)}
                  className="cursor-pointer border-t border-border hover:bg-background"
                >
                  <td className="whitespace-nowrap px-3 py-2 tabular">
                    {printedAt(r.printed_at)}
                  </td>
                  <td className="px-3 py-2 font-medium text-foreground">
                    {r.product_name}
                  </td>
                  <td className="px-3 py-2">{TYPE_LABEL[r.sticker_type]}</td>
                  <td className="px-3 py-2 tabular">
                    {formatDateNL(r.production_date)}
                  </td>
                  <td className="px-3 py-2 tabular">
                    {r.expiry_date ? formatDateNL(r.expiry_date) : "—"}
                  </td>
                  <td className="px-3 py-2">{r.employee_name}</td>
                  {companies.length > 1 && (
                    <td className="px-3 py-2">{r.company_name}</td>
                  )}
                  <td className="px-3 py-2 text-right tabular">
                    {r.sticker_count}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.reprint_of && (
                      <span className="mr-1 rounded bg-navy/10 px-1.5 py-0.5">
                        herdruk door {r.printed_by_name}
                      </span>
                    )}
                    {!r.reprint_of && r.term_changed && (
                      <span className="mr-1 rounded bg-copper/15 px-1.5 py-0.5 text-copper">
                        {r.term_source === "handmatig"
                          ? "handmatige datum"
                          : "termijn aangepast"}
                      </span>
                    )}
                    {!r.reprint_of && r.approved_by_name && (
                      <span className="rounded bg-teal/10 px-1.5 py-0.5 text-teal">
                        goedgekeurd: {r.approved_by_name}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {detail && (
        <StickerDetail
          row={detail}
          onClose={() => setDetail(null)}
          onReprinted={() => void load()}
        />
      )}
    </>
  );
}

function StickerDetail({
  row,
  onClose,
  onReprinted,
}: {
  row: StickerPrint;
  onClose: () => void;
  onReprinted: () => void;
}) {
  const originalId = row.reprint_of ?? row.id;
  const [original, setOriginal] = useState<StickerPrint | null>(
    row.reprint_of ? null : row,
  );
  const [reprints, setReprints] = useState<StickerPrint[]>([]);
  const [count, setCount] = useState(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [printJob, setPrintJob] = useState<{
    data: StickerLabelData;
    count: number;
    format: string;
    nonce: number;
  } | null>(null);
  const [reqId, setReqId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      supabase
        .from("sticker_prints")
        .select("*")
        .eq("id", originalId)
        .maybeSingle(),
      supabase
        .from("sticker_prints")
        .select("*")
        .eq("reprint_of", originalId)
        .order("printed_at"),
    ]).then(([o, r]) => {
      if (cancelled) return;
      setOriginal((o.data as StickerPrint) ?? null);
      setReprints((r.data as StickerPrint[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [originalId, printJob]);

  useEffect(() => {
    if (!printJob) return;
    const t = setTimeout(() => window.print(), 50);
    return () => clearTimeout(t);
  }, [printJob]);

  async function reprint() {
    if (!original) return;
    setBusy(true);
    setError(null);
    const session = readStaffSession(original.company_id);
    const { error: err } = await createClient().rpc("sticker_reprint", {
      p_id: reqId,
      p_original_id: original.id,
      p_session_id: session?.sessionId ?? null,
      p_count: count,
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (err) {
      const msg = haccpError(err);
      if (/medewerker|sessie verlopen/i.test(msg)) {
        writeStaffSession(null, original.company_id);
        setSwitching(true);
      }
      setError(msg);
      return;
    }
    setReqId(crypto.randomUUID());
    setPrintJob((prev) => ({
      data: toLabel(original),
      count,
      format: original.sticker_format ?? "60x30mm",
      nonce: (prev?.nonce ?? 0) + 1,
    }));
    onReprinted();
  }

  const r = original ?? row;
  const fields: [string, React.ReactNode][] = [
    ["Product", r.product_name],
    ["Stickertype", TYPE_LABEL[r.sticker_type]],
    ["Productgroep", r.product_group ?? "—"],
    [
      r.sticker_type === "diepvries" ? "Invriesdatum" : "Productiedatum",
      `${formatDateNL(r.production_date)}${r.production_time ? ` ${r.production_time.slice(0, 5)}` : ""}`,
    ],
    [
      "Oorspronkelijke THT/TGT",
      r.original_expiry
        ? `${r.original_expiry_kind ?? ""} ${formatDateNL(r.original_expiry)} (${r.original_source === "batch" ? "batch" : "handmatig"})`
        : "—",
    ],
    [
      "Standaardtermijn",
      r.standard_term != null
        ? `${r.standard_term} ${r.term_unit}`
        : r.sticker_type === "productie"
          ? "—"
          : "geen (handmatig)",
    ],
    [
      "Toegepaste termijn",
      r.applied_term != null
        ? `${r.applied_term} ${r.term_unit}`
        : r.sticker_type === "productie"
          ? "—"
          : "afwijkend",
    ],
    ["Houdbaarheidsdatum", r.expiry_date ? formatDateNL(r.expiry_date) : "—"],
    ["Onderbouwing", r.change_reason ?? "—"],
    ["Goedgekeurd door", r.approved_by_name ?? "—"],
    ["Bewaartemperatuur", r.storage_temp ?? "—"],
    [
      "Batch / hoeveelheid",
      [r.batch_number, r.quantity].filter(Boolean).join(" · ") || "—",
    ],
    ["Opmerking", r.note ?? "—"],
    ["Medewerker", r.employee_name],
    ["Bedrijf", r.company_name],
    [
      "Afgedrukt",
      `${printedAt(r.printed_at)} · ${r.sticker_count}× · ${r.sticker_format ?? ""}`,
    ],
  ];

  return (
    <Modal title="Stickerregistratie" onClose={onClose}>
      <div className="grid gap-5 md:grid-cols-[1fr_auto]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-3">
          {original && (
            <div className="inline-block rounded border border-border">
              <StickerLabel
                data={toLabel(original)}
                format={original.sticker_format ?? "60x30mm"}
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <p className="mb-2 text-sm font-medium text-foreground">
          Herdrukken ({reprints.length})
        </p>
        {reprints.length > 0 && (
          <ul className="mb-3 space-y-1 text-sm text-muted">
            {reprints.map((x) => (
              <li key={x.id}>
                {printedAt(x.printed_at)} — {x.sticker_count}× door{" "}
                {x.printed_by_name}
                {x.reprint_reason ? ` (${x.reprint_reason})` : ""}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted">Aantal</label>
            <input
              type="number"
              min={1}
              max={200}
              value={count}
              onChange={(e) =>
                setCount(Math.max(1, Number(e.target.value) || 1))
              }
              className="input w-20!"
            />
          </div>
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-xs text-muted">
              Reden (optioneel)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="bv. sticker beschadigd"
              className="input"
            />
          </div>
          <Button onClick={() => void reprint()} disabled={busy || !original}>
            <RotateCcw className="h-4 w-4" />{" "}
            {busy ? "Bezig…" : "Opnieuw afdrukken"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Een herdruk gebruikt altijd de oorspronkelijke gegevens; de datums en
          de verantwoordelijke medewerker blijven gelijk.
        </p>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>

      <StickerPrintArea
        key={printJob?.nonce}
        data={printJob?.data ?? null}
        format={printJob?.format ?? "60x30mm"}
        count={printJob?.count ?? 1}
      />

      {switching && original && (
        <StaffSwitcher
          companyId={original.company_id}
          accountName={null}
          excludeShared
          onClose={() => setSwitching(false)}
          onChosen={(s) => {
            writeStaffSession(s, original.company_id);
            setSwitching(false);
            setError(null);
          }}
        />
      )}
    </Modal>
  );
}

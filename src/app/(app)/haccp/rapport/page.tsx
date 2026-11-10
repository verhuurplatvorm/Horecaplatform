"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Printer } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { SingleCompany } from "@/components/haccp/single-company";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  describeFrequency,
  formatDateNL,
  formatDateTimeNL,
  formatTimeNL,
  haccpError,
  periodRange,
  todayISO,
} from "@/lib/haccp/cleaning";
import {
  CORRECTION_NL,
  EVENT_TYPE_NL,
  exportHaccpExcel,
  reportStatus,
} from "@/lib/haccp/report";
import type {
  HaccpClosedDay,
  HaccpDeviationRow,
  HaccpPlanVersionRow,
  HaccpReportEventRow,
  HaccpReportRow,
} from "@/lib/types/database";

export default function HaccpRapportPage() {
  return (
    <>
      <div className="print:hidden">
        <Topbar title="Inspectierapport schoonmaak" />
      </div>
      <SingleCompany>
        {(companyId) => <Rapport key={companyId} companyId={companyId} />}
      </SingleCompany>
    </>
  );
}

type PeriodKey = "week" | "vorige_week" | "maand" | "vorige_maand" | "eigen";
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "week", label: "Deze week" },
  { key: "vorige_week", label: "Vorige week" },
  { key: "maand", label: "Deze maand" },
  { key: "vorige_maand", label: "Vorige maand" },
  { key: "eigen", label: "Periode…" },
];

const DEV_STATUS: Record<string, string> = {
  open: "Open",
  in_behandeling: "Maatregel genomen",
  opgelost: "Opgelost",
  afgesloten: "Afgesloten",
};

interface Data {
  rows: HaccpReportRow[];
  events: HaccpReportEventRow[];
  plan: HaccpPlanVersionRow[];
  deviations: HaccpDeviationRow[];
  closed: HaccpClosedDay[];
}

/**
 * Inspectierapport: welk schoonmaakplan gold, wat gepland was, wat is
 * uitgevoerd en door wie, welke controles zijn gedaan en welke
 * afwijkingen en corrigerende maatregelen zijn geregistreerd.
 */
function Rapport({ companyId }: { companyId: string }) {
  const { companies } = useCompanyScope();
  const companyName = companies.find((c) => c.id === companyId)?.name ?? "";
  const [today] = useState(() => todayISO());
  const [period, setPeriod] = useState<PeriodKey>("vorige_maand");
  const [range, setRange] = useState(() => periodRange("vorige_maand"));
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withAll, setWithAll] = useState(true);
  const [author, setAuthor] = useState("");
  const [generatedAt, setGeneratedAt] = useState("");

  const load = useCallback(async () => {
    setData(null);
    const supabase = createClient();
    const args = {
      p_company_id: companyId,
      p_from: range.from,
      p_to: range.to,
    };
    const [r, e, p, d, c, u] = await Promise.all([
      supabase.rpc("haccp_report", args),
      supabase.rpc("haccp_report_events", args),
      supabase.rpc("haccp_plan_versions", args),
      supabase.rpc("haccp_deviation_list", {
        p_company_id: companyId,
        p_include_closed: true,
      }),
      supabase
        .from("haccp_closed_days")
        .select("*")
        .eq("company_id", companyId)
        .gte("day", range.from)
        .lte("day", range.to)
        .order("day"),
      supabase.auth.getUser(),
    ]);
    const err = r.error ?? e.error ?? p.error ?? d.error ?? c.error;
    if (err) {
      setError(haccpError(err));
      return;
    }
    setError(null);
    const deviations = ((d.data as HaccpDeviationRow[]) ?? []).filter((x) => {
      const day = x.reported_at.slice(0, 10);
      return (
        (day >= range.from && day <= range.to) ||
        (day <= range.to && x.status !== "afgesloten")
      );
    });
    setData({
      rows: (r.data as HaccpReportRow[]) ?? [],
      events: (e.data as HaccpReportEventRow[]) ?? [],
      plan: (p.data as HaccpPlanVersionRow[]) ?? [],
      deviations,
      closed: (c.data as HaccpClosedDay[]) ?? [],
    });
    if (u.data.user) {
      const { data: prof } = await supabase
        .from("user_profiles")
        .select("full_name")
        .eq("id", u.data.user.id)
        .single();
      setAuthor(prof?.full_name ?? "");
    }
    setGeneratedAt(formatDateTimeNL(new Date().toISOString()));
  }, [companyId, range]);

  useEffect(() => {
    // load() zet pas state na het ophalen (asynchroon).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function choosePeriod(k: PeriodKey) {
    setPeriod(k);
    if (k !== "eigen") setRange(periodRange(k));
  }

  const stats = useMemo(() => {
    const rows = (data?.rows ?? []).filter((r) => !r.is_on_demand);
    const counted = rows.filter((r) => r.status !== "vervallen");
    const onTime = counted.filter(
      (r) => r.status === "uitgevoerd" && !r.done_late,
    ).length;
    const late = counted.filter(
      (r) => r.status === "uitgevoerd" && r.done_late,
    ).length;
    const notDone = counted.filter(
      (r) => r.status === "niet_uitgevoerd",
    ).length;
    const openLate = counted.filter(
      (r) => r.status === "open" && r.due_date < today,
    ).length;
    const openToday = counted.filter(
      (r) => r.status === "open" && r.due_date >= today,
    ).length;
    const voided = rows.filter((r) => r.status === "vervallen").length;
    const all = data?.rows ?? [];
    return {
      planned: counted.length,
      onTime,
      late,
      notDone,
      openLate,
      openToday,
      voided,
      pct: counted.length
        ? Math.round(((onTime + late) / counted.length) * 100)
        : null,
      onDemand: all.filter((r) => r.is_on_demand && r.status === "uitgevoerd")
        .length,
      checksOk: all.filter((r) => r.check_status === "akkoord").length,
      checksBad: all.filter((r) => r.check_status === "afgekeurd").length,
    };
  }, [data, today]);

  const perArea = useMemo(() => {
    const m = new Map<
      string,
      {
        sort: number;
        planned: number;
        done: number;
        late: number;
        notDone: number;
      }
    >();
    for (const r of data?.rows ?? []) {
      if (r.is_on_demand || r.status === "vervallen") continue;
      const a = m.get(r.area_name) ?? {
        sort: r.area_sort,
        planned: 0,
        done: 0,
        late: 0,
        notDone: 0,
      };
      a.planned++;
      if (r.status === "uitgevoerd") a.done++;
      if (r.status === "uitgevoerd" && r.done_late) a.late++;
      if (
        r.status === "niet_uitgevoerd" ||
        (r.status === "open" && r.due_date < today)
      )
        a.notDone++;
      m.set(r.area_name, a);
    }
    return [...m.entries()].sort(
      (a, b) => a[1].sort - b[1].sort || a[0].localeCompare(b[0]),
    );
  }, [data, today]);

  const planByArea = useMemo(() => {
    const m = new Map<string, HaccpPlanVersionRow[]>();
    for (const p of data?.plan ?? []) {
      const list = m.get(p.area_name) ?? [];
      list.push(p);
      m.set(p.area_name, list);
    }
    return [...m.entries()];
  }, [data]);

  const versionCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data?.plan ?? [])
      m.set(p.task_id, (m.get(p.task_id) ?? 0) + 1);
    return m;
  }, [data]);

  return (
    <div className="mx-auto max-w-5xl p-3 sm:p-6 print:max-w-none print:p-0">
      {/* Bediening (niet afdrukken) */}
      <div className="mb-5 space-y-3 print:hidden">
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => choosePeriod(p.key)}
              className={cn(
                "h-9 rounded-full border px-3 text-sm",
                period === p.key
                  ? "border-navy bg-navy text-white"
                  : "border-border bg-surface text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {period === "eigen" && (
            <>
              <input
                type="date"
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
                value={range.from}
                max={range.to}
                onChange={(e) =>
                  e.target.value &&
                  setRange((r) => ({ ...r, from: e.target.value }))
                }
              />
              <span className="text-sm text-muted">t/m</span>
              <input
                type="date"
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
                value={range.to}
                min={range.from}
                onChange={(e) =>
                  e.target.value &&
                  setRange((r) => ({ ...r, to: e.target.value }))
                }
              />
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={withAll}
              onChange={(e) => setWithAll(e.target.checked)}
            />
            Alle afzonderlijke registraties opnemen
          </label>
          <div className="ml-auto flex gap-2">
            <Button
              variant="secondary"
              disabled={!data}
              onClick={() =>
                data &&
                exportHaccpExcel({
                  companyName,
                  from: range.from,
                  to: range.to,
                  rows: data.rows,
                  events: data.events,
                  today,
                })
              }
            >
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button disabled={!data} onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Afdrukken / PDF
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted">
          Tip: kies bij afdrukken &quot;Opslaan als PDF&quot; om het rapport als
          PDF-bestand te bewaren of te mailen.
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-md bg-danger/10 px-4 py-3 text-sm text-danger print:hidden">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className="text-sm text-muted">Rapport samenstellen…</p>
      )}

      {data && (
        <article className="haccp-report rounded-lg border border-border bg-white p-6 text-[13px] leading-snug text-black print:rounded-none print:border-0 print:p-0">
          <header className="mb-4 border-b-2 border-black pb-3">
            <h1 className="text-xl font-bold">HACCP-schoonmaakregistratie</h1>
            <div className="mt-1 grid gap-x-6 sm:grid-cols-2">
              <div>
                <b>Bedrijf:</b> {companyName}
              </div>
              <div>
                <b>Periode:</b> {formatDateNL(range.from, false)} t/m{" "}
                {formatDateNL(range.to, false)} {range.to.slice(0, 4)}
              </div>
              <div>
                <b>Opgesteld:</b> {generatedAt}
                {author && ` door ${author}`}
              </div>
              <div>
                <b>Bron:</b> CuliLogic, module HACCP → Schoonmaak &amp; Controle
              </div>
            </div>
          </header>

          <p className="mb-5 border border-black/30 bg-black/[0.03] p-2 text-[12px]">
            Dit rapport toont het geldende schoonmaakplan en de digitale
            registraties. Een afmelding betekent dat de genoemde medewerker de
            taak heeft afgevinkt; het is geen bewijs dat de reiniging
            inhoudelijk goed is uitgevoerd. Daarvoor dienen de controles door
            leidinggevenden en de registratie van afwijkingen en corrigerende
            maatregelen. Registraties kunnen niet achteraf ongemerkt worden
            gewijzigd: tijden zijn servertijden en correcties staan als aparte
            regel vermeld (zie §5).
          </p>

          <Section n={1} title="Samenvatting">
            <table className="report-table mb-3">
              <tbody>
                <Row
                  label="Geplande schoonmaakmomenten"
                  value={stats.planned}
                />
                <Row label="Uitgevoerd op tijd" value={stats.onTime} />
                <Row label="Te laat uitgevoerd" value={stats.late} />
                <Row
                  label="Niet uitgevoerd (afgesloten met reden)"
                  value={stats.notDone}
                />
                <Row
                  label="Niet uitgevoerd (te laat, nog open)"
                  value={stats.openLate}
                />
                {stats.openToday > 0 && (
                  <Row label="Nog open (vandaag)" value={stats.openToday} />
                )}
                <Row
                  label="Percentage uitgevoerd"
                  value={stats.pct === null ? "—" : `${stats.pct}%`}
                />
                <Row
                  label="Taken 'na gebruik' afgemeld"
                  value={stats.onDemand}
                />
                <Row
                  label="Controles door leidinggevende: akkoord / afgekeurd"
                  value={`${stats.checksOk} / ${stats.checksBad}`}
                />
                <Row
                  label="Afwijkingen (gemeld in of open tijdens periode)"
                  value={`${data.deviations.length} (waarvan ${data.deviations.filter((d) => d.status === "afgesloten").length} afgesloten)`}
                />
                <Row
                  label="Gesloten dagen"
                  value={
                    data.closed.length === 0
                      ? "geen"
                      : data.closed
                          .map(
                            (c) =>
                              formatDateNL(c.day) +
                              (c.reason ? ` (${c.reason})` : ""),
                          )
                          .join(", ")
                  }
                />
              </tbody>
            </table>
            {perArea.length > 0 && (
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Ruimte</th>
                    <th className="num">Gepland</th>
                    <th className="num">Uitgevoerd</th>
                    <th className="num">%</th>
                    <th className="num">Waarvan te laat</th>
                    <th className="num">Niet uitgevoerd</th>
                  </tr>
                </thead>
                <tbody>
                  {perArea.map(([name, a]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="num">{a.planned}</td>
                      <td className="num">{a.done}</td>
                      <td className="num">
                        {a.planned ? Math.round((a.done / a.planned) * 100) : 0}
                        %
                      </td>
                      <td className="num">{a.late}</td>
                      <td className="num">{a.notDone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section
            n={2}
            title="Schoonmaakplan dat in deze periode van toepassing was"
          >
            {planByArea.length === 0 ? (
              <p>Geen schoonmaakplan vastgelegd.</p>
            ) : (
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Ruimte</th>
                    <th>Onderdeel</th>
                    <th>Frequentie</th>
                    <th>Verantwoordelijke</th>
                    <th>Werkinstructie / middel</th>
                  </tr>
                </thead>
                <tbody>
                  {planByArea.flatMap(([area, list]) =>
                    list.map((p, i) => (
                      <tr key={`${p.task_id}-${p.version_no}`}>
                        <td>{i === 0 ? area : ""}</td>
                        <td>
                          {p.title}
                          {(versionCount.get(p.task_id) ?? 0) > 1 && (
                            <span className="block text-[11px] text-black/60">
                              versie {p.version_no}:{" "}
                              {formatDateTimeNL(p.valid_from)}
                              {p.valid_to
                                ? ` t/m ${formatDateTimeNL(p.valid_to)}`
                                : " – heden"}
                            </span>
                          )}
                          {p.requires_check && (
                            <span className="block text-[11px]">
                              controle door leidinggevende
                            </span>
                          )}
                        </td>
                        <td>{describeFrequency(p)}</td>
                        <td>{p.department_name ?? "Iedereen"}</td>
                        <td>
                          {p.instruction}
                          {p.cleaning_agent && (
                            <span className="block">
                              Middel: {p.cleaning_agent}
                            </span>
                          )}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            )}
          </Section>

          <Section n={3} title="Afwijkingen en corrigerende maatregelen">
            {data.deviations.length === 0 ? (
              <p>Geen afwijkingen geregistreerd.</p>
            ) : (
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Gemeld</th>
                    <th>Ruimte / taak</th>
                    <th>Afwijking</th>
                    <th>Corrigerende maatregel</th>
                    <th>Oplossing</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.deviations.map((d) => (
                    <tr key={d.id}>
                      <td>
                        {formatDateTimeNL(d.reported_at)}
                        <span className="block">{d.reported_by}</span>
                      </td>
                      <td>
                        {[d.area_name, d.task_title]
                          .filter(Boolean)
                          .join(" / ")}
                      </td>
                      <td>
                        {d.description}
                        {d.photo_count > 0 && (
                          <span className="block text-[11px]">
                            {d.photo_count} foto(&apos;s)
                          </span>
                        )}
                      </td>
                      <td>
                        {d.corrective_action ?? "—"}
                        {d.responsible && (
                          <span className="block text-[11px]">
                            verantw.: {d.responsible}
                          </span>
                        )}
                      </td>
                      <td>
                        {d.resolution ?? "—"}
                        {d.resolved_by && (
                          <span className="block text-[11px]">
                            {d.resolved_by}, {formatDateTimeNL(d.resolved_at)}
                          </span>
                        )}
                      </td>
                      <td>
                        {DEV_STATUS[d.status]}
                        {d.closed_by && (
                          <span className="block text-[11px]">
                            {d.closed_by}, {formatDateTimeNL(d.closed_at)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section n={4} title="Niet uitgevoerde taken">
            {(() => {
              const list = data.rows.filter(
                (r) =>
                  r.status === "niet_uitgevoerd" ||
                  (r.status === "open" && r.due_date < today),
              );
              if (list.length === 0)
                return <p>Alle geplande taken zijn uitgevoerd.</p>;
              const reason = new Map(
                data.events
                  .filter((e) => e.event_type === "niet_uitgevoerd")
                  .map((e) => [
                    `${e.due_date}|${e.title}`,
                    `${e.note ?? ""} (${e.recorded_by ?? ""})`,
                  ]),
              );
              return (
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Gepland</th>
                      <th>Ruimte</th>
                      <th>Taak</th>
                      <th>Status / reden</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.occurrence_id}>
                        <td>{formatDateNL(r.due_date)}</td>
                        <td>{r.area_name}</td>
                        <td>{r.title}</td>
                        <td>
                          {reportStatus(r, today)}
                          {r.status === "niet_uitgevoerd" &&
                            reason.get(`${r.due_date}|${r.title}`) && (
                              <span className="block text-[11px]">
                                {reason.get(`${r.due_date}|${r.title}`)}
                              </span>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </Section>

          <Section n={5} title="Correcties en bijzonderheden">
            {data.events.length === 0 ? (
              <p>Geen correcties of bijzonderheden.</p>
            ) : (
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Tijdstip</th>
                    <th>Taak (gepland)</th>
                    <th>Registratie</th>
                    <th>Vastgelegd door</th>
                    <th>Reden / toelichting</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e, i) => (
                    <tr key={i}>
                      <td>{formatDateTimeNL(e.recorded_at)}</td>
                      <td>
                        {e.title}
                        <span className="block text-[11px]">
                          {e.area_name}, {formatDateNL(e.due_date)}
                        </span>
                      </td>
                      <td>
                        {EVENT_TYPE_NL[e.event_type] ?? e.event_type}
                        {e.kind && (
                          <span className="block text-[11px]">
                            {CORRECTION_NL[e.kind] ?? e.kind}
                          </span>
                        )}
                        {e.event_type === "correctie" && e.performed_by && (
                          <span className="block text-[11px]">
                            nieuwe uitvoerder: {e.performed_by}
                          </span>
                        )}
                      </td>
                      <td>{e.recorded_by}</td>
                      <td>{e.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {withAll && (
            <Section n={6} title="Alle registraties">
              {data.rows.length === 0 ? (
                <p>Geen registraties in deze periode.</p>
              ) : (
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Gepland</th>
                      <th>Ruimte</th>
                      <th>Taak</th>
                      <th>Status</th>
                      <th>Uitgevoerd door</th>
                      <th>Afgemeld</th>
                      <th>Controle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.occurrence_id}>
                        <td>
                          {formatDateNL(r.due_date)}
                          {r.slots_total > 1 && ` (${r.slot}/${r.slots_total})`}
                        </td>
                        <td>{r.area_name}</td>
                        <td>
                          {r.title}
                          {r.is_on_demand && " (na gebruik)"}
                        </td>
                        <td>
                          {reportStatus(r, today)}
                          {r.has_corrections && " *"}
                        </td>
                        <td>
                          {r.completed_by ?? ""}
                          {r.clicked_by && r.clicked_by !== r.completed_by && (
                            <span className="block text-[11px]">
                              via {r.clicked_by}
                            </span>
                          )}
                        </td>
                        <td>
                          {r.done_late
                            ? formatDateTimeNL(r.completed_at)
                            : formatTimeNL(r.completed_at)}
                        </td>
                        <td>
                          {r.check_status
                            ? `${r.check_status} (${r.checked_by ?? ""})`
                            : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-2 text-[11px]">* = gecorrigeerd; zie §5.</p>
            </Section>
          )}

          <footer className="mt-6 border-t border-black/30 pt-2 text-[11px] text-black/60">
            {companyName} · HACCP-schoonmaakregistratie ·{" "}
            {formatDateNL(range.from, false)} t/m{" "}
            {formatDateNL(range.to, false)} {range.to.slice(0, 4)} · opgesteld{" "}
            {generatedAt}
          </footer>
        </article>
      )}

      <style jsx global>{`
        .report-table {
          width: 100%;
          border-collapse: collapse;
        }
        .report-table th,
        .report-table td {
          border: 1px solid rgba(0, 0, 0, 0.25);
          padding: 3px 6px;
          text-align: left;
          vertical-align: top;
        }
        .report-table th {
          background: rgba(0, 0, 0, 0.05);
          font-weight: 600;
        }
        .report-table .num {
          text-align: right;
        }
        .report-table tr {
          break-inside: avoid;
        }
        @media print {
          @page {
            size: A4;
            margin: 12mm;
          }
          body * {
            visibility: hidden;
          }
          .haccp-report,
          .haccp-report * {
            visibility: visible;
          }
          .haccp-report {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .report-table thead {
            display: table-header-group;
          }
        }
      `}</style>
    </div>
  );
}

function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2
        className="mb-2 text-[15px] font-bold"
        style={{ breakAfter: "avoid" }}
      >
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <tr>
      <td className="w-2/3">{label}</td>
      <td>{value}</td>
    </tr>
  );
}

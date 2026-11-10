import * as XLSX from "xlsx";
import type { HaccpReportEventRow, HaccpReportRow } from "@/lib/types/database";
import { formatDateTimeNL } from "@/lib/haccp/cleaning";

/** Statuslabel zoals in rapport en export. */
export function reportStatus(
  r: Pick<HaccpReportRow, "status" | "done_late" | "due_date" | "void_reason">,
  today: string,
) {
  if (r.status === "uitgevoerd")
    return r.done_late ? "Te laat uitgevoerd" : "Uitgevoerd";
  if (r.status === "open")
    return r.due_date < today ? "Niet uitgevoerd (te laat, open)" : "Open";
  if (r.status === "niet_uitgevoerd") return "Niet uitgevoerd";
  if (r.void_reason === "gesloten") return "Vervallen (gesloten)";
  if (r.void_reason === "planwijziging") return "Vervallen (planwijziging)";
  if (r.void_reason === "correctie") return "Vervallen (gecorrigeerd)";
  return "Vervallen";
}

export const EVENT_TYPE_NL: Record<string, string> = {
  correctie: "Correctie",
  niet_uitgevoerd: "Afgesloten als niet uitgevoerd",
  ingetrokken: "Afmelding direct ingetrokken",
  probleem: "Probleem gemeld",
  gecontroleerd_afgekeurd: "Controle afgekeurd",
};

export const CORRECTION_NL: Record<string, string> = {
  ongeldig: "afmelding ongeldig gemaakt",
  andere_medewerker: "uitvoerder aangepast",
  heropenen: "weer opengezet",
};

/** Excel-bestand met alle registraties en bijzonderheden in de periode. */
export function exportHaccpExcel(opts: {
  companyName: string;
  from: string;
  to: string;
  rows: HaccpReportRow[];
  events: HaccpReportEventRow[];
  today: string;
}) {
  const reg = opts.rows.map((r) => ({
    "Geplande datum": r.due_date,
    Moment: r.is_on_demand
      ? "na gebruik"
      : r.slots_total > 1
        ? `${r.slot} van ${r.slots_total}`
        : "",
    Ruimte: r.area_name,
    Taak: r.title,
    Taakversie: r.version_no,
    Afdeling: r.department_name ?? "",
    Status: reportStatus(r, opts.today),
    "Uitgevoerd door": r.completed_by ?? "",
    "Afgemeld op": r.completed_at ? formatDateTimeNL(r.completed_at) : "",
    "Via account": r.clicked_by ?? "",
    Controle: r.check_status ?? "",
    "Gecontroleerd door": r.checked_by ?? "",
    "Gecontroleerd op": r.checked_at ? formatDateTimeNL(r.checked_at) : "",
    Correctie: r.has_corrections ? "ja" : "",
    Problemen: r.problem_count || "",
    "Foto's": r.photo_count || "",
  }));
  const ev = opts.events.map((e) => ({
    "Geplande datum": e.due_date,
    Ruimte: e.area_name,
    Taak: e.title,
    Registratie: EVENT_TYPE_NL[e.event_type] ?? e.event_type,
    Soort: e.kind ? (CORRECTION_NL[e.kind] ?? e.kind) : "",
    Medewerker: e.performed_by ?? "",
    "Vastgelegd door": e.recorded_by ?? "",
    Tijdstip: formatDateTimeNL(e.recorded_at),
    "Reden / toelichting": e.note ?? "",
  }));

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(reg);
  ws1["!cols"] = [
    12, 10, 16, 32, 8, 12, 26, 16, 16, 16, 10, 16, 16, 9, 9, 7,
  ].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws1, "Registraties");
  const ws2 = XLSX.utils.json_to_sheet(
    ev.length ? ev : [{ Opmerking: "Geen bijzonderheden in deze periode" }],
  );
  XLSX.utils.book_append_sheet(wb, ws2, "Bijzonderheden");
  const safe = opts.companyName.replace(/[^\w-]+/g, "_");
  XLSX.writeFile(wb, `HACCP_schoonmaak_${safe}_${opts.from}_${opts.to}.xlsx`);
}

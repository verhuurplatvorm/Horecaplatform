import type { HaccpBoardRow, HaccpOverdueRow } from "@/lib/types/database";

export type Tone = "danger" | "copper" | "teal" | "muted";

const DEVIATION_LABEL: Record<string, string> = {
  open: "probleem gemeld",
  gemeld: "probleem gemeld",
  maatregel: "maatregel genomen",
  opgelost: "probleem opgelost",
  afgesloten: "afwijking afgesloten",
  heropend: "afwijking heropend",
};

function nlDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Amsterdam",
  });
}

function nlTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });
}

/**
 * Opvolging van een achterstallige taak in één regel:
 * nog open, alsnog gedaan (door wie, wanneer), niet gedaan (reden, door
 * welke leidinggevende) en eventuele gemelde problemen met maatregel.
 */
export function overdueFollowUp(r: HaccpOverdueRow): { lines: string[]; tone: Tone; open: boolean } {
  const lines: string[] = [];
  let tone: Tone = "muted";
  const open = r.status === "open";
  if (r.status === "open") {
    lines.push("Nog niet gedaan");
    tone = "danger";
  } else if (r.status === "uitgevoerd" && r.completed_at) {
    lines.push(
      `Alsnog gedaan${r.completed_by ? ` door ${r.completed_by}` : ""} op ${nlDate(r.completed_at)} ${nlTime(r.completed_at)}`,
    );
    tone = "teal";
    if (r.requires_check) lines.push(checkLabel(r.check_status, r.checked_by));
  } else if (r.status === "niet_uitgevoerd") {
    lines.push(
      `Afgesloten als niet gedaan${r.not_done_by ? ` door ${r.not_done_by}` : ""}${r.not_done_reason ? `: ${r.not_done_reason}` : ""}`,
    );
    tone = "copper";
  }
  if (r.deviation_count > 0) {
    const status = r.last_deviation_status ? (DEVIATION_LABEL[r.last_deviation_status] ?? r.last_deviation_status) : "probleem gemeld";
    lines.push(
      `${r.deviation_count === 1 ? "1 probleem" : `${r.deviation_count} problemen`} · ${status}${r.last_corrective_action ? ` — maatregel: ${r.last_corrective_action}` : ""}`,
    );
    if (r.open_deviation_count > 0 && tone !== "danger") tone = "copper";
  }
  return { lines, tone, open };
}

/** Controle door de leidinggevende, los van het afvinken door de medewerker. */
export function checkLabel(
  status: HaccpBoardRow["check_status"],
  by: string | null,
): string {
  if (status === "akkoord") return `Gecontroleerd${by ? ` door ${by}` : ""} ✓`;
  if (status === "afgekeurd") return `Afgekeurd${by ? ` door ${by}` : ""} — zie Controle`;
  return "Wacht op controle leidinggevende";
}

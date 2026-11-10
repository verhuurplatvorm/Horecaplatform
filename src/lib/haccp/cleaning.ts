import type { HaccpFrequency, HaccpTask } from "@/lib/types/database";

/** Frequenties in de volgorde waarin ze in keuzelijsten staan. */
export const FREQUENCIES: { value: HaccpFrequency; label: string }[] = [
  { value: "na_gebruik", label: "Na gebruik" },
  { value: "meerdere_per_dag", label: "Meerdere keren per dag" },
  { value: "dagelijks", label: "Dagelijks" },
  { value: "wekelijks", label: "Wekelijks" },
  { value: "maandelijks", label: "Maandelijks" },
  { value: "kwartaal", label: "Per kwartaal" },
  { value: "jaarlijks", label: "Jaarlijks" },
  { value: "handmatig", label: "Handmatig" },
];

export const WEEKDAYS = [
  "maandag",
  "dinsdag",
  "woensdag",
  "donderdag",
  "vrijdag",
  "zaterdag",
  "zondag",
];

export const MONTHS = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

/** Korte omschrijving, bv. "Wekelijks op maandag" of "3× per dag". */
export function describeFrequency(
  t: Pick<
    HaccpTask,
    "frequency" | "times_per_day" | "weekday" | "month_day" | "month"
  >,
): string {
  switch (t.frequency) {
    case "na_gebruik":
      return "Na gebruik";
    case "meerdere_per_dag":
      return `${t.times_per_day}× per dag`;
    case "dagelijks":
      return "Dagelijks";
    case "wekelijks":
      return `Wekelijks op ${WEEKDAYS[(t.weekday ?? 1) - 1]}`;
    case "maandelijks":
      return `Maandelijks op de ${t.month_day ?? 1}e`;
    case "kwartaal":
      return `Per kwartaal (vanaf ${t.month_day ?? 1} ${MONTHS[(t.month ?? 1) - 1]})`;
    case "jaarlijks":
      return `Jaarlijks op ${t.month_day ?? 1} ${MONTHS[(t.month ?? 1) - 1]}`;
    case "handmatig":
      return "Handmatig";
  }
}

export interface StandardTask {
  area: string;
  title: string;
  frequency: HaccpFrequency;
  times_per_day?: number;
  weekday?: number;
  month_day?: number;
  month?: number;
  /** Naam van de afdeling die het meestal doet (wordt gekoppeld als die bestaat). */
  team: "Keuken" | "Bediening" | "Bar";
  instruction?: string;
}

/**
 * Standaardtaken om snel een schoonmaakplan op te zetten. Worden pas
 * toegevoegd als de beheerder ze aanvinkt; daarna vrij aan te passen.
 */
export const STANDARD_TASKS: StandardTask[] = [
  {
    area: "Warme keuken",
    title: "Werkbanken reinigen",
    frequency: "dagelijks",
    team: "Keuken",
  },
  {
    area: "Warme keuken",
    title: "Fornuis en bakplaat reinigen",
    frequency: "dagelijks",
    team: "Keuken",
  },
  {
    area: "Warme keuken",
    title: "Vloer reinigen",
    frequency: "dagelijks",
    team: "Keuken",
  },
  {
    area: "Warme keuken",
    title: "Frituurolie verversen en bak reinigen",
    frequency: "wekelijks",
    weekday: 1,
    team: "Keuken",
  },
  {
    area: "Warme keuken",
    title: "Afzuigkapfilters reinigen",
    frequency: "wekelijks",
    weekday: 1,
    team: "Keuken",
  },
  {
    area: "Warme keuken",
    title: "Oven/combisteamer reinigen",
    frequency: "wekelijks",
    weekday: 1,
    team: "Keuken",
  },
  {
    area: "Warme keuken",
    title: "Wanden en tegels reinigen",
    frequency: "maandelijks",
    month_day: 1,
    team: "Keuken",
  },
  {
    area: "Koude keuken",
    title: "Werkbanken reinigen",
    frequency: "dagelijks",
    team: "Keuken",
  },
  {
    area: "Koude keuken",
    title: "Snijmachine reinigen",
    frequency: "na_gebruik",
    team: "Keuken",
  },
  {
    area: "Koude keuken",
    title: "Snijplanken reinigen",
    frequency: "na_gebruik",
    team: "Keuken",
  },
  {
    area: "Koude keuken",
    title: "Koelwerkbank reinigen",
    frequency: "wekelijks",
    weekday: 1,
    team: "Keuken",
  },
  {
    area: "Spoelkeuken",
    title: "Vaatwasser leegmaken en reinigen",
    frequency: "dagelijks",
    team: "Keuken",
  },
  {
    area: "Spoelkeuken",
    title: "Afvoerputjes reinigen",
    frequency: "wekelijks",
    weekday: 1,
    team: "Keuken",
  },
  {
    area: "Spoelkeuken",
    title: "Vaatwasser ontkalken",
    frequency: "maandelijks",
    month_day: 1,
    team: "Keuken",
  },
  {
    area: "Koelcellen",
    title: "Koelcelvloer reinigen",
    frequency: "wekelijks",
    weekday: 1,
    team: "Keuken",
  },
  {
    area: "Koelcellen",
    title: "Deurrubbers en schappen reinigen",
    frequency: "maandelijks",
    month_day: 1,
    team: "Keuken",
  },
  {
    area: "Vriezers",
    title: "Vriezer grondig reinigen",
    frequency: "kwartaal",
    month: 1,
    month_day: 1,
    team: "Keuken",
  },
  {
    area: "Magazijn",
    title: "Vloer en schappen reinigen",
    frequency: "wekelijks",
    weekday: 1,
    team: "Keuken",
  },
  {
    area: "Magazijn",
    title: "Controle op ongedierte",
    frequency: "maandelijks",
    month_day: 1,
    team: "Keuken",
  },
  {
    area: "Bar",
    title: "Werkblad en spoelbak reinigen",
    frequency: "dagelijks",
    team: "Bar",
  },
  {
    area: "Bar",
    title: "Koelingen reinigen",
    frequency: "wekelijks",
    weekday: 1,
    team: "Bar",
  },
  {
    area: "Bar",
    title: "IJsblokjesmachine reinigen",
    frequency: "maandelijks",
    month_day: 1,
    team: "Bar",
  },
  {
    area: "Restaurant",
    title: "Tafels reinigen",
    frequency: "na_gebruik",
    team: "Bediening",
  },
  {
    area: "Restaurant",
    title: "Vloer reinigen",
    frequency: "dagelijks",
    team: "Bediening",
  },
  {
    area: "Toiletten",
    title: "Toiletten controleren",
    frequency: "meerdere_per_dag",
    times_per_day: 3,
    team: "Bediening",
  },
  {
    area: "Toiletten",
    title: "Toiletten grondig reinigen",
    frequency: "dagelijks",
    team: "Bediening",
  },
  {
    area: "Terras",
    title: "Terras en meubilair reinigen",
    frequency: "dagelijks",
    team: "Bediening",
  },
  {
    area: "Personeelsruimtes",
    title: "Personeelsruimte reinigen",
    frequency: "wekelijks",
    weekday: 1,
    team: "Bediening",
  },
];

/** Volgorde waarin standaardruimtes verschijnen. */
export const STANDARD_AREAS = [
  "Warme keuken",
  "Koude keuken",
  "Spoelkeuken",
  "Koelcellen",
  "Vriezers",
  "Magazijn",
  "Bar",
  "Restaurant",
  "Toiletten",
  "Terras",
  "Personeelsruimtes",
];

/** Leesbare foutmelding uit een Supabase-fout. */
export function haccpError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "Er ging iets mis";
}

const SESSION_KEY = "haccp:medewerker";

export interface StaffSession {
  companyId: string;
  sessionId: string;
  staffId: string;
  name: string;
  expiresAt: number;
}

/** Wie werkt er op deze tablet (na pincode). Verloopt na 12 uur, net als op de server. */
/** Iets korter dan op de server (12 uur), zodat de tablet nooit met een verlopen sessie werkt. */
export function staffSessionExpiry(): number {
  return Date.now() + 11.5 * 60 * 60 * 1000;
}

export function readStaffSession(companyId: string): StaffSession | null {
  try {
    const raw = window.localStorage.getItem(`${SESSION_KEY}:${companyId}`);
    if (!raw) return null;
    const s = JSON.parse(raw) as StaffSession;
    if (s.companyId !== companyId || s.expiresAt < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function writeStaffSession(s: StaffSession | null, companyId: string) {
  try {
    if (s)
      window.localStorage.setItem(
        `${SESSION_KEY}:${companyId}`,
        JSON.stringify(s),
      );
    else window.localStorage.removeItem(`${SESSION_KEY}:${companyId}`);
  } catch {
    /* geen opslag: dan telt de ingelogde gebruiker */
  }
}

// ---------------------------------------------------------------------
// Datums (yyyy-mm-dd, lokale tijd = Nederland)
// ---------------------------------------------------------------------

export function toISODate(d: Date): string {
  return d.toLocaleDateString("sv-SE");
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Periode-snelkeuzes voor Historie. */
export function periodRange(
  key:
    "vandaag" | "gisteren" | "week" | "vorige_week" | "maand" | "vorige_maand",
): { from: string; to: string } {
  const today = todayISO();
  const d = new Date(`${today}T12:00:00`);
  const isoDow = ((d.getDay() + 6) % 7) + 1; // 1 = maandag
  switch (key) {
    case "vandaag":
      return { from: today, to: today };
    case "gisteren": {
      const y = addDaysISO(today, -1);
      return { from: y, to: y };
    }
    case "week":
      return { from: addDaysISO(today, 1 - isoDow), to: today };
    case "vorige_week": {
      const mon = addDaysISO(today, 1 - isoDow - 7);
      return { from: mon, to: addDaysISO(mon, 6) };
    }
    case "maand":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "vorige_maand": {
      const first = new Date(d.getFullYear(), d.getMonth() - 1, 1, 12);
      const last = new Date(d.getFullYear(), d.getMonth(), 0, 12);
      return { from: toISODate(first), to: toISODate(last) };
    }
  }
}

export function formatDateNL(iso: string, withWeekday = true): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("nl-NL", {
    weekday: withWeekday ? "short" : undefined,
    day: "numeric",
    month: "short",
  });
}

export function formatTimeNL(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTimeNL(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Snelle redenen voor "niet uitgevoerd". */
export const NOT_DONE_REASONS = [
  "Geen dienst / gesloten",
  "Vergeten",
  "Geen tijd (te druk)",
  "Ruimte of apparaat niet in gebruik",
  "Defect / niet mogelijk",
];

// ---------------------------------------------------------------------
// Startscherm: medewerkers en gedeelde tablets openen op Schoonmaak vandaag
// ---------------------------------------------------------------------

const TABLET_HOME_KEY = "haccp:tablet-start";
const LANDED_KEY = "haccp:startscherm-gedaan";

export function isTabletHome(): boolean {
  try {
    return window.localStorage.getItem(TABLET_HOME_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTabletHome(on: boolean) {
  try {
    if (on) window.localStorage.setItem(TABLET_HOME_KEY, "1");
    else window.localStorage.removeItem(TABLET_HOME_KEY);
  } catch {
    /* geen opslag: dan gewoon het dashboard */
  }
}

/** Eén keer per sessie doorsturen, zodat je daarna gewoon naar het dashboard kunt. */
export function takeLandingRedirect(): boolean {
  try {
    if (window.sessionStorage.getItem(LANDED_KEY)) return false;
    window.sessionStorage.setItem(LANDED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

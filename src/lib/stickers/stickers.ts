/**
 * Stickerfunctie: datumberekening, termijnen en herkenning van
 * diepvriescategorieën. Dezelfde regels gelden op de server
 * (sticker_standard_term / sticker_print in migratie 0117); de server
 * controleert alles opnieuw.
 */

export type StickerType = "productie" | "vers" | "diepvries";

export const STICKER_TYPES: {
  key: StickerType;
  label: string;
  hint: string;
}[] = [
  { key: "productie", label: "Productiedatum", hint: "Alleen productiedatum" },
  { key: "vers", label: "Vers", hint: "Standaard 3 dagen" },
  { key: "diepvries", label: "Diepvries", hint: "THT per productgroep" },
];

/** Standaard verse termijn: productiedatum + 3 kalenderdagen. */
export const DEFAULT_FRESH_DAYS = 3;
export const DEFAULT_FREEZER_TEMP = "-18 °C of kouder";

// ------------------------------------------------------------------
// Datums (altijd als yyyy-mm-dd, zonder tijdzone-gedoe)
// ------------------------------------------------------------------

function parseISO(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function toISO(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDaysISO(iso: string, days: number): string {
  const p = parseISO(iso);
  if (!p) return "";
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Kalendermaanden optellen. Bestaat de dag niet in de doelmaand, dan de
 * laatste dag van die maand (31-01 + 1 maand = 28-02, of 29-02 in een
 * schrikkeljaar) — precies zoals PostgreSQL `date + interval 'n months'`.
 */
export function addMonthsISO(iso: string, months: number): string {
  const p = parseISO(iso);
  if (!p) return "";
  const total = p[0] * 12 + (p[1] - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return toISO(y, m, Math.min(p[2], daysInMonth(y, m)));
}

export function addTerm(
  iso: string,
  term: number,
  unit: "dagen" | "maanden",
): string {
  return unit === "maanden" ? addMonthsISO(iso, term) : addDaysISO(iso, term);
}

/** 2026-11-11 → 11-11-2026 */
export function formatDateNL(iso: string | null | undefined): string {
  const p = iso ? parseISO(iso.slice(0, 10)) : null;
  if (!p) return "—";
  return `${String(p[2]).padStart(2, "0")}-${String(p[1]).padStart(2, "0")}-${p[0]}`;
}

/** Vandaag als yyyy-mm-dd in lokale tijd. */
export function todayISO(now = new Date()): string {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// ------------------------------------------------------------------
// Standaardtermijn
// ------------------------------------------------------------------

export interface TermInput {
  type: StickerType;
  /** Houdbaarheidsregel van een halfproduct/gerecht (recipes.shelf_life_rule). */
  recipeRule?: string | null;
  recipeDays?: number | null;
  isRecipe?: boolean;
  /** Productspecifieke instellingen (sticker_product_settings). */
  productFreshDays?: number | null;
  productFreezerMonths?: number | null;
  /** Gekozen diepvriescategorie. */
  categoryMonths?: number | null;
  categoryApproved?: boolean;
}

export interface StandardTerm {
  term: number | null;
  unit: "dagen" | "maanden" | null;
  source: "product" | "categorie" | "standaard" | "handmatig" | null;
  /** Uitleg voor de medewerker als er geen automatische datum is. */
  reason?: string;
}

export function standardTerm(i: TermInput): StandardTerm {
  if (i.type === "productie") return { term: null, unit: null, source: null };

  if (i.type === "vers") {
    if (i.isRecipe && i.recipeRule !== "ingevroren_3m") {
      if (i.recipeRule === "handmatig") {
        return {
          term: null,
          unit: "dagen",
          source: "handmatig",
          reason: "Voor dit product wordt de datum per sticker ingevuld.",
        };
      }
      if (i.recipeRule === "zelfde_dag")
        return { term: 1, unit: "dagen", source: "product" };
      if (i.recipeRule === "gekoeld_2d" && (i.recipeDays ?? 2) === 2)
        return { term: 3, unit: "dagen", source: "product" };
      if (i.recipeDays != null)
        return { term: i.recipeDays + 1, unit: "dagen", source: "product" };
    }
    if (i.productFreshDays != null)
      return { term: i.productFreshDays, unit: "dagen", source: "product" };
    return { term: DEFAULT_FRESH_DAYS, unit: "dagen", source: "standaard" };
  }

  // Diepvries: productspecifiek gaat altijd voor de algemene categorie.
  if (i.productFreezerMonths != null)
    return { term: i.productFreezerMonths, unit: "maanden", source: "product" };
  if (i.isRecipe && i.recipeRule === "ingevroren_3m")
    return { term: 3, unit: "maanden", source: "product" };
  if (i.categoryMonths != null && i.categoryApproved)
    return { term: i.categoryMonths, unit: "maanden", source: "categorie" };
  return {
    term: null,
    unit: "maanden",
    source: "handmatig",
    reason:
      i.categoryMonths != null
        ? "Deze bewaartermijn is nog niet goedgekeurd door een beheerder. Vul de datum zelf in."
        : "Voor deze productgroep is geen vaste termijn. Vul de datum zelf in.",
  };
}

/** Wat de server ervan vindt: is extra onderbouwing of goedkeuring nodig? */
export function expiryCheck(opts: {
  type: StickerType;
  productionDate: string;
  expiryDate: string;
  standard: StandardTerm;
  originalExpiry?: string | null;
  originalKind?: "TGT" | "THT" | null;
  originalFromBatch?: boolean;
}): {
  error: string | null;
  needsReason: boolean;
  needsApproval: boolean;
  changed: boolean;
} {
  const { type, productionDate, expiryDate, standard } = opts;
  const out = {
    error: null as string | null,
    needsReason: false,
    needsApproval: false,
    changed: false,
  };
  if (type === "productie") return out;
  if (!expiryDate) {
    out.error = "Vul de houdbaarheidsdatum in.";
    return out;
  }
  if (expiryDate < productionDate) {
    out.error = "Houdbaarheidsdatum ligt vóór de productie-/invriesdatum.";
    return out;
  }
  if (standard.term != null && standard.unit) {
    const expected = addTerm(productionDate, standard.term, standard.unit);
    if (expiryDate > expected) out.needsApproval = true;
    if (expiryDate !== expected) out.changed = true;
  } else {
    out.needsReason = true;
    out.changed = true;
  }
  const orig = opts.originalExpiry;
  if (orig) {
    if (type === "diepvries") {
      if (opts.originalKind === "TGT" && productionDate >= orig) {
        out.error =
          "De invriesdatum ligt op of na de oorspronkelijke TGT — dit product mag niet meer worden ingevroren.";
        return out;
      }
      if (productionDate > orig) {
        out.error =
          "De invriesdatum ligt na de oorspronkelijke THT — dit product mag niet meer worden ingevroren.";
        return out;
      }
    }
    if (
      expiryDate > orig &&
      !(type === "diepvries" && opts.originalFromBatch)
    ) {
      out.needsApproval = true;
    }
  }
  if (out.needsApproval) out.needsReason = true;
  return out;
}

// ------------------------------------------------------------------
// Herkenning diepvriescategorie
// ------------------------------------------------------------------

/** Trefwoorden per categoriesleutel (sticker_freezer_categories.key). Volgorde = prioriteit. */
const CATEGORY_KEYWORDS: [string, string[]][] = [
  [
    "soepen_sauzen",
    [
      "jus",
      "fond",
      "soep",
      "saus",
      "bouillon",
      "bisque",
      "dressing",
      "gravy",
      "velouté",
      "veloute",
      "ragout",
      "glaze",
      "crème",
      "creme",
      "puree",
      "coulis",
      "chutney",
      "salsa",
    ],
  ],
  [
    "maaltijden",
    [
      "stoof",
      "stamppot",
      "curry",
      "lasagne",
      "chili",
      "hachee",
      "risotto",
      "maaltijd",
      "pasta",
    ],
  ],
  [
    "gehakt",
    ["gehakt", "hamburger", "burger", "tartaar", "köfte", "kofte", "slavink"],
  ],
  [
    "worst",
    [
      "worst",
      "chorizo",
      "salami",
      "bacon",
      "spek",
      "ham",
      "pancetta",
      "vleeswaren",
    ],
  ],
  [
    "schaaldieren",
    [
      "garnaal",
      "garnalen",
      "gamba",
      "scampi",
      "kreeft",
      "krab",
      "mossel",
      "oester",
      "schaaldier",
      "langoustine",
      "inktvis",
      "calamari",
      "octopus",
    ],
  ],
  [
    "vette_vis",
    [
      "zalm",
      "makreel",
      "haring",
      "paling",
      "forel",
      "sardine",
      "ansjovis",
      "tonijn",
      "heilbot",
    ],
  ],
  [
    "magere_vis",
    [
      "kabeljauw",
      "schol",
      "koolvis",
      "tong",
      "zeebaars",
      "dorade",
      "heek",
      "wijting",
      "pollak",
      "skrei",
      "tarbot",
      "griet",
      "zeeduivel",
      "schelvis",
      "vis",
    ],
  ],
  [
    "gevogelte",
    [
      "kip",
      "kalkoen",
      "eend",
      "gevogelte",
      "parelhoen",
      "poulet",
      "duif",
      "fazant",
    ],
  ],
  ["lam", ["lam", "lams"]],
  [
    "varken",
    [
      "varken",
      "spareribs",
      "procureur",
      "karbonade",
      "speklap",
      "buikspek",
      "fricandeau",
      "pulled pork",
    ],
  ],
  [
    "rund",
    [
      "rund",
      "biefstuk",
      "ossenhaas",
      "entrecote",
      "ribeye",
      "rib-eye",
      "kalfs",
      "kalf",
      "sukade",
      "riblap",
      "picanha",
      "steak",
      "carpaccio",
      "bavette",
    ],
  ],
  [
    "brood",
    [
      "brood",
      "broodje",
      "broodjes",
      "bagel",
      "baguette",
      "ciabatta",
      "focaccia",
      "bun",
      "pistolet",
      "croissant",
      "wrap",
    ],
  ],
  [
    "rauw_deeg",
    ["deeg", "pizzabodem", "bladerdeeg", "kruimeldeeg", "pizzadeeg"],
  ],
  ["boter", ["boter", "margarine", "kruidenboter"]],
  [
    "harde_kaas",
    [
      "kaas",
      "parmezaan",
      "parmigiano",
      "pecorino",
      "cheddar",
      "gruyère",
      "gruyere",
      "comté",
      "comte",
    ],
  ],
  [
    "groenten",
    [
      "groente",
      "boon",
      "bonen",
      "erwt",
      "doperwt",
      "spinazie",
      "broccoli",
      "bloemkool",
      "wortel",
      "spruit",
      "mais",
      "paprika",
      "courgette",
      "aubergine",
      "asperge",
    ],
  ],
  [
    "fruit",
    [
      "fruit",
      "aardbei",
      "framboos",
      "frambozen",
      "bes",
      "bessen",
      "mango",
      "ananas",
      "appel",
      "peer",
      "kers",
      "kersen",
      "perzik",
      "banaan",
    ],
  ],
];

const BEREID_HINTS = [
  "gegaard",
  "gebraden",
  "gebakken",
  "gegrild",
  "gestoofd",
  "sous vide",
  "sous-vide",
  "confit",
  "pulled",
  "rosbief",
  "rollade",
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ");
}

function hasWord(text: string, word: string, anywhere = false): boolean {
  const w = normalize(word).trim();
  if (!w) return false;
  // Lange woorden en sauzen/soepen mogen overal staan (kalfsjus,
  // tomatensoep, rundergehakt). Korte woorden alleen aan het begin van
  // een woord, zodat "ham" niet in "champignon" en "kip" wel in
  // "kipfilet" wordt gevonden.
  if (anywhere || w.length >= 5) return text.includes(w);
  return new RegExp(`(^|\\s)${w.replace(/\s+/g, "\\s+")}`).test(text);
}

/**
 * Meest waarschijnlijke diepvriescategorie (sleutel) bij een productnaam.
 * `isPrepared` = halfproduct of gerecht (zelf bereid).
 */
export function guessFreezerCategory(
  name: string,
  opts: { isPrepared?: boolean; productGroup?: string | null } = {},
): string | null {
  const text = ` ${normalize(`${name} ${opts.productGroup ?? ""}`)} `.replace(
    /\s+/g,
    " ",
  );
  const prepared =
    opts.isPrepared || BEREID_HINTS.some((h) => hasWord(text, h));

  for (const [key, words] of CATEGORY_KEYWORDS) {
    if (!words.some((w) => hasWord(text, w, key === "soepen_sauzen"))) continue;
    // Bereid vlees/gevogelte/gehakt → gebakken/gebraden vlees.
    if (
      prepared &&
      ["gevogelte", "rund", "varken", "lam", "gehakt"].includes(key)
    ) {
      return "gebraden_vlees";
    }
    return key;
  }
  if (opts.isPrepared) return "maaltijden";
  return null;
}

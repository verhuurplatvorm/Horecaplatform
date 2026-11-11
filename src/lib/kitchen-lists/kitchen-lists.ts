/**
 * Keukenlijsten: rekenwerk bovenop kitchen_list() (migratie 0119).
 * Puur en zonder database, zodat het getest kan worden.
 *
 * Regels: elke regel uit kitchen_list() heeft precies één partie
 * (station_id). Filteren per partie en samenvoegen per ingrediënt-ID
 * telt dus nooit dubbel.
 */

export type KitchenRowKind =
  "product" | "halfproduct" | "ongekoppeld" | "geen_receptuur" | "lus";

export interface KitchenRow {
  dish_id: string;
  line_id: string | null;
  recipe_id: string;
  path: string[];
  depth: number;
  kind: KitchenRowKind;
  product_id: string | null;
  sub_recipe_id: string | null;
  unmatched_name: string | null;
  line_quantity: number | null;
  line_unit: string | null;
  station_id: string | null;
  station_source: string | null;
  using_station_id: string | null;
  quantity_base: number | null;
  problem: string | null;
}

/** Sleutel voor "niet ingedeeld". */
export const NO_STATION = "geen";

export function stationKey(id: string | null | undefined): string {
  return id ?? NO_STATION;
}

/** Valt deze regel binnen de gekozen parties? (leeg = alle) */
export function inStations(
  id: string | null | undefined,
  selected: Set<string>,
): boolean {
  return selected.size === 0 || selected.has(stationKey(id));
}

export interface IngredientAgg {
  productId: string;
  stations: Set<string>;
  dishes: Set<string>;
  halfproducts: Set<string>;
  /** Som van berekende hoeveelheden (basiseenheid); null = niet berekend. */
  quantity: number | null;
  /** Er is een regel zonder berekenbare hoeveelheid terwijl er wel porties zijn. */
  incomplete: boolean;
  lines: number;
}

export function aggregateIngredients(
  rows: KitchenRow[],
  selected: Set<string>,
  withQuantities: boolean,
): Map<string, IngredientAgg> {
  const out = new Map<string, IngredientAgg>();
  for (const r of rows) {
    if (r.kind !== "product" || !r.product_id) continue;
    if (!inStations(r.station_id, selected)) continue;
    let a = out.get(r.product_id);
    if (!a) {
      a = {
        productId: r.product_id,
        stations: new Set(),
        dishes: new Set(),
        halfproducts: new Set(),
        quantity: null,
        incomplete: false,
        lines: 0,
      };
      out.set(r.product_id, a);
    }
    a.lines += 1;
    a.stations.add(stationKey(r.station_id));
    a.dishes.add(r.dish_id);
    if (r.depth > 0) a.halfproducts.add(r.recipe_id);
    if (withQuantities) {
      if (r.quantity_base != null && Number.isFinite(r.quantity_base)) {
        a.quantity = (a.quantity ?? 0) + r.quantity_base;
      } else {
        a.incomplete = true;
      }
    }
  }
  return out;
}

export interface HalfproductAgg {
  recipeId: string;
  /** Partie die het maakt. */
  stations: Set<string>;
  /** Parties die het gebruiken. */
  usedBy: Set<string>;
  dishes: Set<string>;
  quantity: number | null;
  incomplete: boolean;
}

/** Halfproducten die de gekozen parties maken óf gebruiken. */
export function aggregateHalfproducts(
  rows: KitchenRow[],
  selected: Set<string>,
  withQuantities: boolean,
): Map<string, HalfproductAgg> {
  const out = new Map<string, HalfproductAgg>();
  for (const r of rows) {
    if (r.kind !== "halfproduct" || !r.sub_recipe_id) continue;
    if (
      !inStations(r.station_id, selected) &&
      !(r.using_station_id !== null && inStations(r.using_station_id, selected))
    )
      continue;
    let a = out.get(r.sub_recipe_id);
    if (!a) {
      a = {
        recipeId: r.sub_recipe_id,
        stations: new Set(),
        usedBy: new Set(),
        dishes: new Set(),
        quantity: null,
        incomplete: false,
      };
      out.set(r.sub_recipe_id, a);
    }
    a.stations.add(stationKey(r.station_id));
    a.usedBy.add(stationKey(r.using_station_id));
    a.dishes.add(r.dish_id);
    if (withQuantities) {
      if (r.quantity_base != null && Number.isFinite(r.quantity_base)) {
        a.quantity = (a.quantity ?? 0) + r.quantity_base;
      } else {
        a.incomplete = true;
      }
    }
  }
  return out;
}

/** Gerechten met minstens één regel (of de hoofdpartie) binnen de gekozen parties. */
export function dishesInStations(
  rows: KitchenRow[],
  dishStation: Map<string, string | null>,
  selected: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const [dish, st] of dishStation) {
    if (inStations(st, selected)) out.add(dish);
  }
  for (const r of rows) {
    if (inStations(r.station_id, selected)) out.add(r.dish_id);
  }
  return out;
}

/**
 * Halfproducten zonder eigen partie die door meer dan één partie worden
 * gebruikt: "kies wie het maakt".
 */
export function sharedWithoutOwnStation(
  rows: KitchenRow[],
  ownStation: Map<string, string | null>,
): string[] {
  const users = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.kind !== "halfproduct" || !r.sub_recipe_id) continue;
    if (ownStation.get(r.sub_recipe_id)) continue;
    if (r.station_source === "regel") continue;
    const s = users.get(r.sub_recipe_id) ?? new Set<string>();
    s.add(stationKey(r.using_station_id));
    users.set(r.sub_recipe_id, s);
  }
  return [...users.entries()].filter(([, s]) => s.size > 1).map(([id]) => id);
}

// ------------------------------------------------------------------
// Leverancier
// ------------------------------------------------------------------

export interface SupplierArticle {
  supplier_id: string;
  supplier_name: string;
  supplier_article_code: string | null;
  packaging_description: string | null;
  purchase_price: number | null;
  price_per_base_unit: number | null;
  valid_from: string | null;
}

/** Vaste voorkeursleverancier; anders het meest recent geprijsde artikel. */
export function chooseArticle(
  articles: SupplierArticle[],
  preferredSupplierId: string | null,
): { article: SupplierArticle | null; others: number; preferred: boolean } {
  if (articles.length === 0)
    return { article: null, others: 0, preferred: false };
  const suppliers = new Set(articles.map((a) => a.supplier_id));
  const pick = (list: SupplierArticle[]) =>
    [...list].sort((a, b) =>
      (b.valid_from ?? "").localeCompare(a.valid_from ?? ""),
    )[0];
  if (preferredSupplierId) {
    const pref = articles.filter((a) => a.supplier_id === preferredSupplierId);
    if (pref.length > 0)
      return {
        article: pick(pref),
        others: suppliers.size - 1,
        preferred: true,
      };
  }
  return {
    article: pick(articles),
    others: suppliers.size - 1,
    preferred: false,
  };
}

/** Inhoud van één verpakking in basiseenheid (prijs / prijs per eenheid). */
export function packSizeBase(a: SupplierArticle | null): number | null {
  if (!a || !a.purchase_price || !a.price_per_base_unit) return null;
  if (a.purchase_price <= 0 || a.price_per_base_unit <= 0) return null;
  const v = a.purchase_price / a.price_per_base_unit;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Aantal verpakkingen (naar boven afgerond); null als onbekend. */
export function packsNeeded(
  quantity: number | null,
  packBase: number | null,
): number | null {
  if (quantity == null || !packBase || quantity <= 0) return null;
  return Math.ceil(quantity / packBase - 1e-9);
}

// ------------------------------------------------------------------
// Weergave
// ------------------------------------------------------------------

/** 3500 g → "3,5 kg"; 250 ml → "250 ml"; 3 stuk → "3 stuk". */
export function formatQuantity(
  q: number | null,
  unit: string | null | undefined,
): string {
  if (q == null) return "";
  const u = (unit ?? "").trim().toLowerCase();
  const nf = (n: number, d: number) =>
    n.toLocaleString("nl-NL", {
      maximumFractionDigits: d,
      minimumFractionDigits: 0,
    });
  if ((u === "g" || u === "gram") && q >= 1000) return `${nf(q / 1000, 2)} kg`;
  if (u === "ml" && q >= 1000) return `${nf(q / 1000, 2)} l`;
  return `${nf(q, q < 10 ? 1 : 0)} ${unit ?? ""}`.trim();
}

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b\d+([.,]\d+)?\s*(g|gr|kg|ml|cl|l|ltr|stuks?|st)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Groepen ingrediënt-ID's met (genormaliseerd) dezelfde naam. */
export function possibleDuplicates(
  products: { id: string; name: string }[],
): string[][] {
  const by = new Map<string, string[]>();
  for (const p of products) {
    const k = normalizeName(p.name);
    if (!k) continue;
    by.set(k, [...(by.get(k) ?? []), p.id]);
  }
  return [...by.values()].filter((ids) => ids.length > 1);
}

// ------------------------------------------------------------------
// Partie-voorstel
// ------------------------------------------------------------------

const KEYWORDS: [string, string[]][] = [
  [
    "Pâtisserie",
    [
      "dessert",
      "taart",
      "ijs",
      "mousse",
      "fondant",
      "tiramisu",
      "brownie",
      "ganache",
      "cheesecake",
      "crème brûlée",
      "creme brulee",
      "pannacotta",
      "sorbet",
      "sabayon",
      "parfait",
      "coupe",
      "dame blanche",
      "wafel",
      "pannenkoek",
    ],
  ],
  [
    "Garde-manger",
    [
      "carpaccio",
      "tartaar",
      "tartare",
      "ceviche",
      "oester",
      "salade",
      "sashimi",
      "rillette",
      "terrine",
      "paté",
      "pate",
      "vitello",
      "gravad",
      "gerookte",
      "kaviaar",
      "fruits de mer",
      "plateau",
      "bruschetta",
    ],
  ],
  [
    "Entremetier",
    [
      "risotto",
      "groente",
      "aardappel",
      "puree",
      "friet",
      "frites",
      "patat",
      "garnituur",
      "polenta",
      "couscous",
      "pasta",
      "rijst",
      "soep",
      "loaded fries",
    ],
  ],
  [
    "Roti",
    [
      "filet",
      "steak",
      "tournedos",
      "burger",
      "gegrild",
      "biefstuk",
      "ossenhaas",
      "entrecote",
      "kip",
      "zalm",
      "kabeljauw",
      "zeebaars",
      "tong",
      "vis",
      "vlees",
      "spareribs",
      "saté",
      "sate",
      "schnitzel",
      "gamba",
      "scampi",
      "kreeft",
      "mossel",
      "lamsrack",
      "eend",
    ],
  ],
];

const CATEGORY_MAP: [RegExp, string][] = [
  [/dessert|ijs|zoet/i, "Pâtisserie"],
  [/voorgerecht|salade|bites|koud/i, "Garde-manger"],
  [/side|friet|bijgerecht/i, "Entremetier"],
  [/hoofdgerecht|burger|lunch|warm|grill/i, "Roti"],
];

function norm(s: string): string {
  return ` ${s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
}

/**
 * Voorstel voor de partie van een gerecht (naam = stationnaam) op basis van
 * trefwoorden in de naam en daarna de soortmap. null = geen voorstel.
 */
export function suggestStation(
  dishName: string,
  category: string | null | undefined,
): string | null {
  const text = norm(dishName);
  for (const [station, words] of KEYWORDS) {
    for (const w of words) {
      const k = norm(w).trim();
      if (
        k.length <= 4 ? new RegExp(`[^a-z]${k}`).test(text) : text.includes(k)
      ) {
        return station;
      }
    }
  }
  if (category) {
    for (const [re, station] of CATEGORY_MAP)
      if (re.test(category)) return station;
  }
  return null;
}

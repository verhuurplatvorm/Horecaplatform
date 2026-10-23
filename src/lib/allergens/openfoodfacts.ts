import { ALLERGEN_LIST, type AllergenKey } from "./infer";

/**
 * Vertaalt Open Food Facts-gegevens (opgezocht op EAN) naar onze 14
 * EU-allergenen. Open Food Facts wordt door gebruikers ingevuld en kan
 * fouten bevatten: het resultaat is dus altijd een VOORSTEL dat een mens
 * controleert, nooit een feit dat automatisch wordt opgeslagen.
 */

const TAG_TO_KEY: Record<string, AllergenKey> = {
  "en:gluten": "gluten",
  "en:crustaceans": "schaaldieren",
  "en:eggs": "eieren",
  "en:fish": "vis",
  "en:peanuts": "pinda",
  "en:soybeans": "soja",
  "en:milk": "melk",
  "en:nuts": "noten",
  "en:celery": "selderij",
  "en:mustard": "mosterd",
  "en:sesame-seeds": "sesam",
  "en:sulphur-dioxide-and-sulphites": "sulfiet",
  "en:lupin": "lupine",
  "en:molluscs": "weekdieren",
};

export type WebAllergenStatus = "gevonden" | "onvolledig" | "niet_gevonden" | "fout";

export interface WebAllergenResult {
  status: WebAllergenStatus;
  allergens: AllergenKey[];
  traces: AllergenKey[];
  productName?: string;
}

function mapTags(tags: unknown): AllergenKey[] {
  if (!Array.isArray(tags)) return [];
  const out = new Set<AllergenKey>();
  for (const t of tags) {
    const key = typeof t === "string" ? TAG_TO_KEY[t.toLowerCase()] : undefined;
    if (key) out.add(key);
  }
  return ALLERGEN_LIST.filter((a) => out.has(a));
}

/** Zet het antwoord van de Open Food Facts product-API om naar een resultaat. */
export function parseOpenFoodFacts(json: unknown): WebAllergenResult {
  const j = json as {
    status?: number;
    product?: {
      product_name?: string;
      allergens_tags?: unknown;
      traces_tags?: unknown;
      ingredients_text?: string;
    };
  } | null;
  if (!j || j.status !== 1 || !j.product) {
    return { status: "niet_gevonden", allergens: [], traces: [] };
  }
  const p = j.product;
  const allergens = mapTags(p.allergens_tags);
  const traces = mapTags(p.traces_tags).filter((a) => !allergens.includes(a));
  const hasIngredients = typeof p.ingredients_text === "string" && p.ingredients_text.trim().length > 0;
  const hasAnyTag = Array.isArray(p.allergens_tags) && p.allergens_tags.length > 0;
  // Zonder ingrediëntenlijst en zonder allergeentags weten we niets: een
  // lege lijst betekent dan "niet ingevuld", niet "geen allergenen".
  const status: WebAllergenStatus = hasIngredients || hasAnyTag ? "gevonden" : "onvolledig";
  return { status, allergens, traces, productName: p.product_name || undefined };
}

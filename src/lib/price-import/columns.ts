/**
 * Herkent kolomkoppen in leveranciersprijslijsten. Leveranciers noemen
 * hun kolommen niet allemaal hetzelfde, dus we matchen op een aantal
 * bekende varianten (NL/EN) in plaats van exacte namen te eisen.
 */

import { parsePackagingText, parseCombinedArticleLine, UNIT_TO_BASE_FACTOR } from "./packaging-parser";

export interface ParsedPriceRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  eanCode: string | null;
  articleNumber: string | null;
  description: string | null;
  brand: string | null;
  packagingDescription: string | null;
  packagingUnitCount: number | null;
  /** In welke eenheid packagingUnitCount is uitgedrukt (meestal 'g', 'ml'
   * of 'stuk' — de kleinste eenheid). Null = de waarde komt rechtstreeks
   * uit een kolom zonder herkenbare eenheid, en wordt bij toepassen
   * beschouwd als al in de basiseenheid van het gekoppelde product. */
  packagingUnitKey: string | null;
  purchasePrice: number | null;
}

/** Canonieke velden waar een kolom naartoe gekoppeld kan worden, met
 * Nederlandse weergavenamen voor het kolommen-koppelscherm (spec §4). */
export const CANONICAL_FIELDS: { value: string; label: string }[] = [
  { value: "ean", label: "EAN-code" },
  { value: "articleNumber", label: "Artikelnummer" },
  { value: "description", label: "Artikelnaam" },
  { value: "brand", label: "Merk" },
  {
    value: "combinedLine",
    label: "Artikelregel (naam + verpakking + code samen)",
  },
  { value: "packagingDescription", label: "Verpakking" },
  { value: "packagingUnitCount", label: "Aantal / inhoud" },
  { value: "purchasePrice", label: "Prijs" },
  { value: "ignore", label: "Niet importeren" },
];


const HEADER_ALIASES: Record<string, string[]> = {
  ean: ["ean", "ean_code", "eancode", "barcode", "gtin", "ean13"],
  articleNumber: [
    "artikelnummer",
    "artikelnr",
    "artikelcode",
    "article_number",
    "articlenumber",
    "sku",
    "productcode",
    "leverancierscode",
    "leveranciersartikelnummer",
    "itemnumber",
    "item_number",
    "code",
    "nr",
  ],
  description: [
    "omschrijving",
    "beschrijving",
    "naam",
    "artikel",
    "artikelnaam",
    "artikelomschrijving",
    "productomschrijving",
    "product_omschrijving",
    "omschrijving_artikel",
    "description",
    "name",
    "product",
    "productnaam",
    "itemdescription",
    "item_description",
  ],
  brand: ["merk", "brand", "fabricaat", "fabrikant"],
  packagingDescription: [
    "verpakking",
    "verpakkingseenheid",
    "verpakkingsinhoud",
    "packaging",
    "packaging_description",
    "eenheid",
    "packsize",
    "pack_size",
    "inhoud_verpakking",
  ],
  packagingUnitCount: [
    "inhoud",
    "aantal",
    "aantalperverpakking",
    "aantal_per_verpakking",
    "inhoud_per_verpakking",
    "packaging_unit_count",
    "quantity",
    "content",
    "netinhoud",
    "netto_inhoud",
    "gewicht",
    "volume",
    "netweight",
    "net_weight",
  ],
  purchasePrice: [
    "prijs",
    "inkoopprijs",
    "nettoprijs",
    "netto_prijs",
    "bruto_prijs",
    "brutoprijs",
    "prijs_per_eenheid",
    "prijsper_eenheid",
    "prijs_per_stuk",
    "eenheidsprijs",
    "verkoopprijs",
    "price",
    "purchase_price",
    "unit_price",
    "unitprice",
    "net_price",
    "netprice",
  ],
};

/** Bouwt de headerMap die normalizeRow verwacht, op basis van een door de
 * gebruiker bevestigde koppeling (kolomnaam -> canoniek veld). 'ignore'
 * wordt weggelaten. */
export function buildHeaderMapFromMapping(
  mapping: Record<string, string>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [header, canonical] of Object.entries(mapping)) {
    if (canonical && canonical !== "ignore") map.set(header, canonical);
  }
  return map;
}

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Bouwt een lookup van genormaliseerde brondkolomnaam -> canonieke
 * veldnaam. Matcht eerst exact, en — als er dan nog canonieke velden
 * onbezet zijn — daarna op basis van een los woord dat voorkomt in de
 * kolomkop (bv. "Artikel omschrijving NL" bevat het woord "omschrijving").
 * Dit is een best-effort suggestie; de gebruiker bevestigt of corrigeert
 * 'm altijd zelf in het kolommen-koppelscherm. */
export function buildHeaderMap(headers: string[]): Map<string, string> {
  const normalized = headers.map((h) => ({
    original: h,
    normalized: normalizeHeader(h),
    words: normalizeHeader(h).split("_").filter(Boolean),
  }));

  const map = new Map<string, string>();
  const usedHeaders = new Set<string>();

  // Ronde 1: exacte match (hoogste betrouwbaarheid).
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    const match = normalized.find(
      (h) => !usedHeaders.has(h.original) && aliases.includes(h.normalized)
    );
    if (match) {
      map.set(match.original, canonical);
      usedHeaders.add(match.original);
    }
  }

  // Ronde 2: los woord uit de kolomkop komt overeen met een alias.
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if ([...map.values()].includes(canonical)) continue;
    const match = normalized.find(
      (h) => !usedHeaders.has(h.original) && h.words.some((w) => aliases.includes(w))
    );
    if (match) {
      map.set(match.original, canonical);
      usedHeaders.add(match.original);
    }
  }

  return map;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const cleaned = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "") // duizendtalpunten weg
    .replace(",", "."); // komma als decimaalteken
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/** Zet een rij ruwe kolomwaarden (op originele headernaam) om naar een
 * genormaliseerde rij, gegeven de eerder gebouwde header-map. */
export function normalizeRow(
  rowNumber: number,
  raw: Record<string, unknown>,
  headerMap: Map<string, string>
): ParsedPriceRow {
  const byCanonical: Record<string, unknown> = {};
  for (const [original, canonical] of headerMap.entries()) {
    byCanonical[canonical] = raw[original];
  }

  const packagingDescription = toText(byCanonical.packagingDescription);
  let packagingUnitCount = toNumber(byCanonical.packagingUnitCount);
  let packagingUnitKey: string | null = null;
  let description = toText(byCanonical.description);
  let articleNumber = toText(byCanonical.articleNumber);
  let effectivePackagingDescription = packagingDescription;

  // Eén kolom met alles erin, bv. "CREME FRAICHE 30% 1x1ltr #25072#" —
  // haal naam, verpakking en artikelcode eruit. Vult alleen aan wat nog
  // niet expliciet via een andere kolom is gekoppeld.
  const combinedLine = toText(byCanonical.combinedLine);
  let combinedPackagingText: string | null = null;
  if (combinedLine) {
    const parsedLine = parseCombinedArticleLine(combinedLine);
    if (!description) description = parsedLine.name;
    if (!articleNumber && parsedLine.articleCode) articleNumber = parsedLine.articleCode;
    combinedPackagingText = parsedLine.packagingText;
  }

  // Bepaal de hoeveelheid uit welke bron dan ook daadwerkelijk een getal
  // oplevert — een "Eenheid"-kolom als "DOOS" of "BAK" heeft geen
  // hoeveelheid en mag de herkenning uit de artikelregel niet blokkeren.
  // parsePackagingText geeft de hoeveelheid in de herkende eenheid (bv.
  // liter, kg) — die moet naar de systeem-basiseenheid (ml, g, stuk)
  // omgerekend worden, anders wordt "1x2ltr" als "2" in plaats van 2000
  // (ml) opgeslagen. packagingUnitKey onthoudt in wélke eenheid dat is,
  // zodat later — bij toepassen — omgerekend kan worden naar de
  // werkelijke basiseenheid van het gekoppelde product (die kan afwijken
  // van de kleinste eenheid, bv. een product met "kg" als basiseenheid).
  if (packagingUnitCount === null) {
    const fromExplicit = packagingDescription
      ? parsePackagingText(packagingDescription)
      : null;
    if (fromExplicit) {
      const baseUnit = UNIT_TO_BASE_FACTOR[fromExplicit.unit];
      packagingUnitCount = fromExplicit.totalQuantity * (baseUnit?.factor ?? 1);
      packagingUnitKey = baseUnit?.baseUnitKey ?? null;
      effectivePackagingDescription = packagingDescription;
    } else if (combinedPackagingText) {
      const fromCombined = parsePackagingText(combinedPackagingText);
      if (fromCombined) {
        const baseUnit = UNIT_TO_BASE_FACTOR[fromCombined.unit];
        packagingUnitCount = fromCombined.totalQuantity * (baseUnit?.factor ?? 1);
        packagingUnitKey = baseUnit?.baseUnitKey ?? null;
        effectivePackagingDescription = packagingDescription
          ? `${packagingDescription} · ${combinedPackagingText}`
          : combinedPackagingText;
      }
    } else if (description) {
      // Laatste terugval: de verpakking staat vaak gewoon IN de
      // artikelnaam zelf (bv. "KERSEN ZONDER PIT 1x1,5kg #9264#"), ook
      // wanneer die kolom als gewone "Artikelnaam" gekoppeld is i.p.v.
      // als "Artikelregel". Zo hangt herkenning niet af van welke van
      // de twee de gebruiker koos bij het koppelscherm.
      const fromDescription = parsePackagingText(description);
      if (fromDescription) {
        const baseUnit = UNIT_TO_BASE_FACTOR[fromDescription.unit];
        packagingUnitCount = fromDescription.totalQuantity * (baseUnit?.factor ?? 1);
        packagingUnitKey = baseUnit?.baseUnitKey ?? null;
        effectivePackagingDescription = fromDescription.explanation;
      }
    }
  }

  return {
    rowNumber,
    raw,
    eanCode: toText(byCanonical.ean),
    articleNumber,
    description,
    brand: toText(byCanonical.brand),
    packagingDescription: effectivePackagingDescription,
    packagingUnitCount,
    packagingUnitKey,
    purchasePrice: toNumber(byCanonical.purchasePrice),
  };
}

/**
 * CENTRALE REKENMODULE voor verpakkingen, eenheden en kostprijzen.
 *
 * Alles wat met "hoeveel zit er in een verpakking" en "wat kost een stuk /
 * kilo / liter" te maken heeft loopt via dit bestand: handmatig aangemaakte
 * ingrediënten, Excel- en leveranciersimports, factuurverwerking, prijs-
 * updates, receptberekeningen, halfproducten, productie- en bestellijsten.
 * Er mag nergens anders een eigen verpakkings- of eenhedenberekening staan.
 *
 * Basisregel (de fout die dit voorkomt): een verpakking van 18 × 260 gram
 * bevat 18 STUKS van 260 gram. Het totaalgewicht (4.680 g) is nooit het
 * aantal stuks. Hoeveel er in de verpakking zit wordt altijd uitgedrukt in
 * de BASISEENHEID van het product (packaging_unit_count), en de prijs per
 * basiseenheid is prijs / packaging_unit_count.
 *
 * Alle functies zijn puur (geen database) zodat ze overal en in tests
 * gebruikt kunnen worden. Omrekenen tussen stuk en gewicht/inhoud gaat via
 * dezelfde `convertQuantity` als de rest van het platform (de "brug":
 * 1 stuk = X gram).
 */
import { parsePackagingText } from "@/lib/price-import/packaging-parser";
import { convertQuantity, type UnitBridge, type UnitLike } from "@/lib/units/convert";

export type UnitKey = "mg" | "g" | "kg" | "ml" | "cl" | "dl" | "l" | "stuk";
export type Dimension = "gewicht" | "inhoud" | "aantal";

/** Statische eenhedentabel — spiegelt public.units (factor_to_base). */
export const UNIT_TABLE: Record<UnitKey, { dimension: Dimension; factor: number }> = {
  mg: { dimension: "gewicht", factor: 0.001 },
  g: { dimension: "gewicht", factor: 1 },
  kg: { dimension: "gewicht", factor: 1000 },
  ml: { dimension: "inhoud", factor: 1 },
  cl: { dimension: "inhoud", factor: 10 },
  dl: { dimension: "inhoud", factor: 100 },
  l: { dimension: "inhoud", factor: 1000 },
  stuk: { dimension: "aantal", factor: 1 },
};

/** Eenheden als UnitLike met id = key, zodat convertQuantity zonder database werkt. */
export const STATIC_UNITS_BY_KEY: Map<string, UnitLike> = new Map(
  (Object.keys(UNIT_TABLE) as UnitKey[]).map((key) => [
    key,
    { id: key, dimension: UNIT_TABLE[key].dimension, factor_to_base: UNIT_TABLE[key].factor } as UnitLike,
  ])
);

export function isUnitKey(value: string | null | undefined): value is UnitKey {
  return !!value && value in UNIT_TABLE;
}

function unitOf(key: UnitKey): UnitLike {
  return STATIC_UNITS_BY_KEY.get(key)!;
}

/** De brug "1 stuk = X [eenheid]" in sleutel-vorm (zonder database-id's). */
export interface KeyBridge {
  /** Gewicht/inhoud van één stuk, in `unit`. */
  quantity: number | null | undefined;
  unit: UnitKey | null | undefined;
  /** Netto bruikbaar per stuk (kostprijsbasis), optioneel. */
  netQuantity?: number | null;
}

function toUnitBridge(bridge: KeyBridge | null | undefined): UnitBridge | null {
  if (!bridge?.quantity || !bridge.unit) return null;
  return {
    avgUnitQuantity: bridge.quantity,
    avgUnitId: bridge.unit,
    netUnitQuantity: bridge.netQuantity ?? null,
  };
}

/**
 * Reken een hoeveelheid om tussen twee eenheden (sleutels) volgens de
 * centrale regel. `null` = kan niet (nooit stilletjes 0 of 1).
 */
export function convert(
  quantity: number,
  from: UnitKey,
  to: UnitKey,
  bridge?: KeyBridge | null,
  forCost = false
): number | null {
  return convertQuantity(quantity, unitOf(from), unitOf(to), toUnitBridge(bridge), STATIC_UNITS_BY_KEY, forCost);
}

// ---------------------------------------------------------------------------
// 1. Verpakkingsomschrijving ontleden
// ---------------------------------------------------------------------------

export interface PackagingSpec {
  /** Aantal stuks/verpakkingen (18 bij "18x260gr"). null = niet bekend (bv. "10kg"). */
  packs: number | null;
  /** Inhoud per stuk in `unit` (260 bij "18x260gr"). null = onbekend (bv. "100 stuks"). */
  perPack: number | null;
  /** Totale inhoud in `unit` (4680 bij "18x260gr"). */
  total: number;
  unit: UnitKey;
  kind: "multi" | "triple" | "container" | "single";
  explanation: string;
}

/**
 * Ontleedt "18x260gr", "6 x 1 ltr", "2×2,5kg", "12 × 6 × 30 g = 2160 g",
 * "100 stuks", "10kg", "1 × 1000 Gram" tot een gestructureerde specificatie.
 *
 *   18x260gr  → 18 stuks van 260 g (totaal 4680 g)
 *   100 stuks → 100 stuks, gewicht per stuk onbekend
 *   10kg      → totaal 10 kg, aantal onbekend
 */
export function parsePackaging(text: string | null | undefined): PackagingSpec | null {
  if (!text) return null;
  const parsed = parsePackagingText(text);
  if (!parsed || !isUnitKey(parsed.unit)) return null;
  const unit = parsed.unit;
  const isCount = UNIT_TABLE[unit].dimension === "aantal";
  const lower = text.toLowerCase();
  // De uitleg van de parser bevat alleen een "×" als er echt een
  // vermenigvuldiging is herkend (niet bij een losse maat in de tekst).
  const hasMultiplier = parsed.explanation.includes("×");

  if (hasMultiplier) {
    const triple = (parsed.explanation.match(/×/g) ?? []).length >= 2;
    return {
      packs: parsed.count,
      perPack: parsed.unitQuantity,
      total: parsed.totalQuantity,
      unit,
      kind: triple ? "triple" : "multi",
      explanation: parsed.explanation,
    };
  }
  if (isCount) {
    // "100 stuks": 100 stuks, gewicht per stuk onbekend.
    return {
      packs: parsed.totalQuantity,
      perPack: null,
      total: parsed.totalQuantity,
      unit,
      kind: "single",
      explanation: parsed.explanation,
    };
  }
  // "10kg" / "zak 5 kg": totale inhoud, aantal onbekend.
  const container = /(doos|zak|krat|blik|pak|box|bag)/.test(lower);
  return {
    packs: null,
    perPack: null,
    total: parsed.totalQuantity,
    unit,
    kind: container ? "container" : "single",
    explanation: parsed.explanation,
  };
}

/** Totale inhoud van een specificatie in een andere eenheid (zelfde dimensie). */
export function specTotalIn(spec: PackagingSpec, to: UnitKey, bridge?: KeyBridge | null): number | null {
  if (UNIT_TABLE[spec.unit].dimension === "aantal" && spec.packs !== null && spec.perPack === null) {
    return convert(spec.packs, "stuk", to, bridge);
  }
  return convert(spec.total, spec.unit, to, bridge);
}

// ---------------------------------------------------------------------------
// 2. Hoeveelheid per verpakking in de BASISEENHEID van het product
// ---------------------------------------------------------------------------

export interface CountResult {
  /** packaging_unit_count: inhoud van de verpakking in de basiseenheid. */
  count: number | null;
  /** Leesbare uitleg hoe dit getal is afgeleid. */
  explanation: string;
  /** Gewicht/inhoud per stuk dat uit de omschrijving volgt (voor het instellen van de brug). */
  impliedBridge: KeyBridge | null;
  /** true = aanname nodig (brug gebruikt / onzeker) — laat een mens controleren. */
  assumption: boolean;
}

const REL_TOLERANCE = 0.01;
export function approxEqual(a: number, b: number, tol = REL_TOLERANCE): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b) return true;
  const base = Math.max(Math.abs(a), Math.abs(b));
  return base === 0 ? true : Math.abs(a - b) / base <= tol;
}

/**
 * Hoeveel basiseenheden zitten er in deze verpakking? Dé plek waar
 * "18 × 260 gram" met basiseenheid stuk → 18 stuks wordt (en met
 * basiseenheid gram → 4680 g). Het totaalgewicht wordt nooit als aantal
 * stuks gelezen.
 */
export function countInBaseUnit(
  spec: PackagingSpec,
  base: UnitKey,
  bridge?: KeyBridge | null
): CountResult {
  const baseDim = UNIT_TABLE[base].dimension;
  const specDim = UNIT_TABLE[spec.unit].dimension;
  const noResult = (explanation: string): CountResult => ({
    count: null,
    explanation,
    impliedBridge: null,
    assumption: false,
  });

  if (specDim === baseDim) {
    const total = spec.total;
    const count = convert(total, spec.unit, base);
    return {
      count,
      explanation: `${spec.explanation} = ${fmt(count)} ${base}`,
      impliedBridge: null,
      assumption: false,
    };
  }

  // Verpakking in stuks, product in gewicht/inhoud (bv. "6 × 1 stuks" van een product in ml).
  if (specDim === "aantal" && baseDim !== "aantal") {
    const pieces = spec.total;
    const perPiece = convert(1, "stuk", base, bridge);
    if (perPiece === null) return noResult(`${spec.explanation}: gewicht/inhoud per stuk onbekend`);
    return {
      count: pieces * perPiece,
      explanation: `${fmt(pieces)} stuks × ${fmt(perPiece)} ${base}`,
      impliedBridge: null,
      assumption: true,
    };
  }

  // Verpakking in gewicht/inhoud, product in stuks: aantal stuks, NIET het totaalgewicht.
  if (specDim !== "aantal" && baseDim === "aantal") {
    const hasBridge = !!toUnitBridge(bridge);
    if (spec.packs !== null && spec.perPack !== null) {
      // 18 × 260 g → 18 stuks van 260 g.
      const impliedBridge: KeyBridge = { quantity: spec.perPack, unit: spec.unit };
      if (hasBridge) {
        const bridgePerPiece = convert(1, "stuk", spec.unit, bridge);
        if (bridgePerPiece !== null && !approxEqual(bridgePerPiece, spec.perPack)) {
          return {
            count: null,
            explanation: `${spec.explanation}: ${fmt(spec.perPack)} ${spec.unit} per stuk wijkt af van het ingestelde gewicht per stuk (${fmt(bridgePerPiece)} ${spec.unit})`,
            impliedBridge,
            assumption: true,
          };
        }
      }
      return {
        count: spec.packs,
        explanation: `${fmt(spec.packs)} stuks van ${fmt(spec.perPack)} ${spec.unit}`,
        impliedBridge,
        assumption: false,
      };
    }
    // Alleen een totaalgewicht ("10kg"): aantal stuks alleen met brug.
    if (hasBridge) {
      const pieces = convert(spec.total, spec.unit, "stuk", bridge);
      if (pieces !== null) {
        return {
          count: pieces,
          explanation: `${fmt(spec.total)} ${spec.unit} ÷ gewicht per stuk`,
          impliedBridge: null,
          assumption: true,
        };
      }
    }
    return noResult(`${spec.explanation}: aantal stuks niet af te leiden zonder gewicht per stuk`);
  }

  return noResult(`${spec.explanation}: gewicht en inhoud kunnen niet in elkaar worden omgerekend`);
}

// ---------------------------------------------------------------------------
// 3. Prijzen afleiden uit prijs + verpakking
// ---------------------------------------------------------------------------

export interface PackagingPrices {
  /** Prijs per basiseenheid (= purchase_price / packaging_unit_count). */
  perBase: number | null;
  /** Prijs per stuk (alleen als stuk de basiseenheid is, of een gewicht-per-stuk bekend is). */
  perPiece: number | null;
  perKg: number | null;
  perLiter: number | null;
}

/**
 * Afgeleide prijzen. `count` is packaging_unit_count in de basiseenheid.
 * Alles komt uit dezelfde bron (prijs / count) en dezelfde `convert`.
 */
export function pricesFromCount(
  price: number,
  count: number,
  base: UnitKey,
  bridge?: KeyBridge | null
): PackagingPrices {
  if (!Number.isFinite(price) || !Number.isFinite(count) || count <= 0) {
    return { perBase: null, perPiece: null, perKg: null, perLiter: null };
  }
  const perBase = price / count;
  const perUnit = (to: UnitKey): number | null => {
    // Hoeveel basiseenheden is 1 `to`? Dan is de prijs per `to` = perBase × dat.
    const baseOfOne = convert(1, to, base, bridge, true);
    return baseOfOne === null ? null : perBase * baseOfOne;
  };
  return {
    perBase,
    perPiece: perUnit("stuk"),
    perKg: perUnit("kg"),
    perLiter: perUnit("l"),
  };
}

/**
 * Kosten van een gebruikshoeveelheid: 100 g, 1 stuk, 0,5 l … van een
 * ingrediënt met prijs per basiseenheid. `null` = niet te berekenen.
 */
export function costForUsage(
  pricePerBase: number,
  base: UnitKey,
  quantity: number,
  unit: UnitKey,
  bridge?: KeyBridge | null
): number | null {
  const inBase = convert(quantity, unit, base, bridge, true);
  return inBase === null ? null : pricePerBase * inBase;
}

/**
 * Basiseenheid wijzigen (bv. gram → stuk): reken het verpakkingsaantal mee
 * om. Vroeger bleef het getal staan, waardoor 4680 gram ineens 4680 stuks
 * werd. `null` = niet omrekenbaar zonder gewicht per stuk — dan moet de
 * gebruiker eerst het gewicht per stuk invullen.
 */
export function convertCountToNewBase(
  count: number,
  oldBase: UnitKey,
  newBase: UnitKey,
  bridge?: KeyBridge | null
): number | null {
  return convert(count, oldBase, newBase, bridge);
}

/**
 * Voor invoerschermen: wat zou packaging_unit_count moeten zijn voor deze
 * omschrijving en basiseenheid? Geeft een voorstel + uitleg, of null.
 */
export function suggestCountForDescription(
  description: string | null | undefined,
  base: UnitKey,
  bridge?: KeyBridge | null
): CountResult | null {
  const spec = parsePackaging(description);
  if (!spec) return null;
  const result = countInBaseUnit(spec, base, bridge);
  return result.count === null ? null : result;
}

export function fmt(n: number | null | undefined, digits = 4): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Number(n.toFixed(digits)).toString();
}

// ---------------------------------------------------------------------------
// 4. Hulpfuncties voor imports (Excel, leveranciersbestanden, facturen)
// ---------------------------------------------------------------------------

/** Kleinste basiseenheid van een eenheid: kg → g (×1000), l → ml (×1000), stuk → stuk. */
export function toSmallestUnit(unit: UnitKey): { baseKey: "g" | "ml" | "stuk"; factor: number } {
  const dim = UNIT_TABLE[unit].dimension;
  const baseKey = dim === "gewicht" ? "g" : dim === "inhoud" ? "ml" : "stuk";
  return { baseKey, factor: UNIT_TABLE[unit].factor / UNIT_TABLE[baseKey].factor };
}

export interface ImportPackaging {
  /** Totale inhoud in de kleinste eenheid (g / ml / stuk). Importers rekenen dit daarna naar de basiseenheid van het gekoppelde product. */
  count: number;
  unitKey: "g" | "ml" | "stuk";
  explanation: string;
  spec: PackagingSpec;
}

/**
 * Verpakking uit een tekst (factuurregel, leveranciersomschrijving, productnaam)
 * voor imports. De conversie naar de basiseenheid van het product gebeurt
 * daarna met `convert` / `convertQuantity` (apply_price_import_row in SQL),
 * zodat 18 × 260 g bij een stuk-product 18 stuks wordt en niet 4680.
 */
export function importPackagingFromText(text: string | null | undefined): ImportPackaging | null {
  const spec = parsePackaging(text);
  if (!spec) return null;
  const { baseKey, factor } = toSmallestUnit(spec.unit);
  return { count: spec.total * factor, unitKey: baseKey, explanation: spec.explanation, spec };
}

const NAME_UNIT_ALIASES: Record<string, UnitKey> = {
  ml: "ml",
  cl: "cl",
  dl: "dl",
  l: "l",
  lt: "l",
  ltr: "l",
  liter: "l",
  litre: "l",
  g: "g",
  gr: "g",
  gram: "g",
  kg: "kg",
  kilo: "kg",
};

/**
 * Probeert de inhoud uit een ingrediëntnaam af te leiden (bv. "emmer 10 ltr",
 * "2x5l", "750ml"), voor regels waar het bronbestand geen bruikbare inhoud gaf.
 * Bij meerdere maten wint de laatste. Geeft de totale inhoud in g of ml.
 */
export function contentFromName(
  name: string
): { baseKey: "ml" | "g"; quantityInBase: number; matchedText: string } | null {
  const regex =
    /(?:(\d+(?:[.,]\d+)?)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|ltr|lt|liter|litre|l|kg|kilo|gram|gr|g)(?![a-z])/gi;
  let best: { baseKey: "ml" | "g"; quantityInBase: number; matchedText: string } | null = null;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(name)) !== null) {
    const count = match[1] ? Number(match[1].replace(",", ".")) : 1;
    const amount = Number(match[2].replace(",", "."));
    const unit = NAME_UNIT_ALIASES[match[3].toLowerCase()];
    if (!unit || !Number.isFinite(count) || !Number.isFinite(amount)) continue;
    const { baseKey, factor } = toSmallestUnit(unit);
    const quantityInBase = count * amount * factor;
    if (quantityInBase <= 0 || baseKey === "stuk") continue;
    best = { baseKey, quantityInBase, matchedText: match[0].trim() };
  }
  return best;
}

/**
 * Inhoud of gewicht PER STUK uit een productnaam, voor producten die in stuks
 * worden ingekocht maar nog geen "1 stuk = x g/ml" kennen. "Crème panna 1 litre"
 * → 1000 ml per stuk; "Tomatenpuree 6x1 ltr" → 1000 ml per stuk (6 stuks).
 * `packsInName` is het aantal vóór de "x" (6), zodat de aanroeper kan
 * controleren of dat bij het aantal stuks van de verpakking past. Bij
 * meerdere verschillende maten in de naam is het niet zeker: `ambiguous`.
 */
export function sizePerPieceFromName(
  name: string
): { baseKey: "ml" | "g"; perPiece: number; packsInName: number | null; matchedText: string; ambiguous: boolean } | null {
  const regex =
    /(?:(\d+(?:[.,]\d+)?)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|ltr|lt|liter|litre|l|kg|kilo|gram|gr|g)(?![a-z])/gi;
  const found: { baseKey: "ml" | "g"; perPiece: number; packsInName: number | null; matchedText: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(name)) !== null) {
    const packs = match[1] ? Number(match[1].replace(",", ".")) : null;
    const amount = Number(match[2].replace(",", "."));
    const unit = NAME_UNIT_ALIASES[match[3].toLowerCase()];
    if (!unit || !Number.isFinite(amount) || amount <= 0) continue;
    const { baseKey, factor } = toSmallestUnit(unit);
    if (baseKey === "stuk") continue;
    found.push({ baseKey, perPiece: amount * factor, packsInName: packs, matchedText: match[0].trim() });
  }
  if (found.length === 0) return null;
  const last = found[found.length - 1];
  const ambiguous = found.some((f) => f.baseKey !== last.baseKey || Math.abs(f.perPiece - last.perPiece) > 1e-9);
  return { ...last, ambiguous };
}


/**
 * Aantal stuks per verpakking uit een productnaam als "Croquetas 48x30"
 * (48 stuks van 30 gram), "Mix macarons (5x14 st)" (70 stuks) of
 * "Roggebrood 1x5 plk" (5 plakken). Geeft null als de naam geen aantal
 * bevat of als achter het getal een afmeting staat ("150x45cm", "300x118mm").
 *
 * Zonder eenheid achter het tweede getal is het eerste getal het aantal
 * (48x30 → 48). Met een telwoord (st, stuks, vel, plk, rol, pcs) is het
 * totaal het product van beide getallen (5x14 st → 70).
 */
export function pieceCountFromName(
  name: string | null | undefined
): { count: number; matchedText: string } | null {
  if (!name) return null;
  const regex = /(?<![\d.,/])(\d{1,4})\s*[x×]\s*(\d{1,4})(?:[.,]\d+)?\s*([a-z]+\.?)?/gi;
  let best: { count: number; matchedText: string } | null = null;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(name)) !== null) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const word = (match[3] ?? "").toLowerCase().replace(/\.$/, "");
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < 1) continue;
    const countWords = ["st", "stuks", "stuk", "stk", "pcs", "vel", "vellen", "plk", "plakken", "rol", "rollen", "pc"];
    if (word === "") {
      // Alleen "AxB": het eerste getal is het aantal, het tweede de maat
      // per stuk. Zonder maat per stuk (b > 100) is het waarschijnlijk een
      // afmeting en laten we het met rust.
      if (a < 2 || b > 100) continue;
      best = { count: a, matchedText: match[0].trim() };
    } else if (countWords.includes(word)) {
      best = { count: a * b, matchedText: match[0].trim() };
    }
    // Elke andere eenheid (cm, mm, g, ml, kg, l …): afmeting of inhoud, geen aantal.
  }
  return best;
}

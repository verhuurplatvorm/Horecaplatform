/**
 * Controle van één leveranciersprijs-regel op verpakkings- en eenhedenfouten.
 * Gebruikt uitsluitend de centrale rekenmodule (./core).
 *
 *   groen  — verpakking en eenheden zijn duidelijk en de berekening klopt
 *   oranje — waarschijnlijke fout, onderbouwde correctie voorgesteld
 *   rood   — te onduidelijk om veilig te corrigeren: handmatig controleren
 *   geen_prijs — prijs ontbreekt of is 0 (geen verpakkingsfout, wel melden)
 *
 * Er wordt hier niets gewijzigd; dit is alleen de beoordeling.
 */
import {
  approxEqual,
  convert,
  countInBaseUnit,
  fmt,
  parsePackaging,
  pricesFromCount,
  UNIT_TABLE,
  type KeyBridge,
  type PackagingPrices,
  type PackagingSpec,
  type UnitKey,
} from "./core";

export type PackagingStatus = "groen" | "oranje" | "rood" | "geen_prijs";

export interface DiagnoseInput {
  name: string;
  baseUnit: UnitKey;
  bridge?: KeyBridge | null;
  description: string | null;
  count: number;
  price: number;
}

export interface PackagingProposal {
  count: number;
  description: string;
  prices: PackagingPrices;
}

export interface Diagnosis {
  status: PackagingStatus;
  /** Eén zin: waarom deze status / correctie (Nederlands, voor de gebruiker). */
  reason: string;
  /** Aanvullende opmerkingen bij een groene regel (niet-blokkerend). */
  notes: string[];
  current: PackagingPrices;
  /** Alleen bij oranje: voorgestelde verpakking. */
  proposal: PackagingProposal | null;
  /** Alternatieve lezing (rood): wat de prijs zou zijn als de naam gelijk heeft. */
  alternative: string | null;
}

/** Woorden die wijzen op non-food (glazen, bekers, …) — nooit automatisch corrigeren. */
const NON_FOOD_HINT =
  /\b(glas|glazen|beker|bekers|maatbeker|cup|cups|polycup|sauscup|bord|borden|servet|servetten|handdoek|handschoen|folie|papier|label|labels|daglabel)\b/i;

/** Redelijke grenzen voor prijs per kg/liter (ruim: saffraan is ~ € 7.500/kg). */
const MIN_PRICE_PER_KG_L = 0.3;
const MAX_PRICE_PER_KG_L = 20000;

function perKgOrL(prices: PackagingPrices, base: UnitKey): number | null {
  const dim = UNIT_TABLE[base].dimension;
  if (dim === "gewicht") return prices.perKg;
  if (dim === "inhoud") return prices.perLiter;
  return prices.perKg ?? prices.perLiter;
}

function describe(spec: PackagingSpec): string {
  if (spec.packs !== null && spec.perPack !== null && spec.kind !== "single") {
    return `${fmt(spec.packs)} × ${fmt(spec.perPack)} ${spec.unit}`;
  }
  return `${fmt(spec.total)} ${spec.unit}`;
}

function dimensionUnit(spec: PackagingSpec): "kg" | "l" {
  return UNIT_TABLE[spec.unit].dimension === "gewicht" ? "kg" : "l";
}

/** Is de omschrijving een "prijs per kilo/liter"-verpakking (1 × 1 kg / 1 × 1000 g / 1 l)? */
function isPerKiloOrLiterSpec(spec: PackagingSpec): boolean {
  if (UNIT_TABLE[spec.unit].dimension === "aantal") return false;
  const inKgL = convert(spec.total, spec.unit, dimensionUnit(spec));
  return inKgL !== null && approxEqual(inKgL, 1) && (spec.packs === null || spec.packs === 1);
}

function proposalFor(input: DiagnoseInput, count: number, description: string): PackagingProposal {
  return {
    count,
    description,
    prices: pricesFromCount(input.price, count, input.baseUnit, input.bridge),
  };
}

function groen(current: PackagingPrices, notes: string[]): Diagnosis {
  return { status: "groen", reason: "Verpakking en eenheden kloppen.", notes, current, proposal: null, alternative: null };
}

function rood(current: PackagingPrices, reason: string, alternative: string | null = null): Diagnosis {
  return { status: "rood", reason, notes: [], current, proposal: null, alternative };
}

function oranje(current: PackagingPrices, reason: string, proposal: PackagingProposal): Diagnosis {
  return { status: "oranje", reason, notes: [], current, proposal, alternative: null };
}

/** Is een voorgestelde prijs per kg/l geloofwaardig? */
function plausible(prices: PackagingPrices, base: UnitKey): boolean {
  const v = perKgOrL(prices, base);
  return v === null || (v >= MIN_PRICE_PER_KG_L && v <= MAX_PRICE_PER_KG_L);
}

export function diagnosePackaging(input: DiagnoseInput): Diagnosis {
  const { baseUnit, bridge, price, count } = input;
  const baseDim = UNIT_TABLE[baseUnit].dimension;
  const current = pricesFromCount(price, count, baseUnit, bridge);

  if (!(price > 0)) {
    return { status: "geen_prijs", reason: "Geen prijs ingevuld (€ 0).", notes: [], current, proposal: null, alternative: null };
  }
  if (!(count > 0)) {
    return rood(current, "Verpakkingshoeveelheid ontbreekt of is 0.");
  }

  const spec = parsePackaging(input.description);
  const nameSpec = parsePackaging(input.name);
  const notes: string[] = [];

  if (!spec) {
    return rood(
      current,
      nameSpec
        ? `Geen bruikbare verpakkingsomschrijving; de naam noemt ${describe(nameSpec)}. Handmatig vastleggen.`
        : "Geen bruikbare verpakkingsomschrijving en geen maat in de naam. Handmatig vastleggen."
    );
  }
  const specDim = UNIT_TABLE[spec.unit].dimension;

  // ------------------------------------------------------------------
  // Stap 1: klopt het opgeslagen aantal met de verpakkingsomschrijving?
  // ------------------------------------------------------------------
  if (specDim === baseDim && specDim !== "aantal") {
    const expected = countInBaseUnit(spec, baseUnit, bridge).count;
    if (expected === null) return rood(current, "Verpakking niet om te rekenen naar de basiseenheid.");
    if (!approxEqual(count, expected)) {
      // Aantal staat in een verkeerde eenheid (bv. 1000 i.p.v. 1 bij basiseenheid kg).
      const ratio = count / expected;
      const knownSlip = [1000, 100, 10, 0.1, 0.01, 0.001].some((f) => approxEqual(ratio, f, 0.0001));
      if (knownSlip) {
        const proposal = proposalFor(input, expected, input.description ?? "");
        if (plausible(proposal.prices, baseUnit)) {
          return oranje(
            current,
            `Verpakking ${describe(spec)} is ${fmt(expected)} ${baseUnit}, maar opgeslagen is ${fmt(count)} ${baseUnit} (omrekenfout ×${fmt(ratio)}).`,
            proposal
          );
        }
      }
      return rood(
        current,
        `Opgeslagen inhoud (${fmt(count)} ${baseUnit}) komt niet overeen met de omschrijving (${describe(spec)} = ${fmt(expected)} ${baseUnit}).`
      );
    }
  } else if (specDim === "aantal" && baseDim === "aantal") {
    const expected = spec.total;
    if (!approxEqual(count, expected)) {
      return rood(current, `Opgeslagen aantal (${fmt(count)}) komt niet overeen met de omschrijving (${fmt(expected)} stuks).`);
    }
  } else if (specDim === "aantal" && baseDim !== "aantal") {
    // Omschrijving in stuks, product in gewicht/inhoud.
    if (NON_FOOD_HINT.test(input.name)) {
      return rood(
        current,
        `Waarschijnlijk non-food (glas/beker/label): het ingrediënt rekent in ${baseUnit}, maar de verpakking is in stuks. Basiseenheid stuk is waarschijnlijk juist — handmatig beslissen.`
      );
    }
    const pieces = spec.total;
    const perPieceFromBridge = convert(1, "stuk", baseUnit, bridge);
    if (perPieceFromBridge !== null) {
      const expected = pieces * perPieceFromBridge;
      if (!approxEqual(count, expected)) {
        return rood(
          current,
          `Opgeslagen inhoud (${fmt(count)} ${baseUnit}) wijkt af van ${fmt(pieces)} stuks × ${fmt(perPieceFromBridge)} ${baseUnit} per stuk.`
        );
      }
    } else if (nameSpec && UNIT_TABLE[nameSpec.unit].dimension === baseDim) {
      const nameTotal = convert(nameSpec.total, nameSpec.unit, baseUnit);
      if (nameTotal !== null && approxEqual(count, nameTotal)) {
        if (nameSpec.kind === "single" && pieces > 1) {
          // Prijs geldt voor `pieces` stuks, maar het aantal bevat maar één stuk (24 × 25 cl = 250 ml).
          const newCount = pieces * nameTotal;
          const proposal = proposalFor(input, newCount, `${fmt(pieces)} × ${fmt(nameSpec.total)} ${nameSpec.unit}`);
          if (plausible(proposal.prices, baseUnit)) {
            return oranje(
              current,
              `Omschrijving: ${fmt(pieces)} stuks, naam: ${fmt(nameSpec.total)} ${nameSpec.unit} per stuk. Opgeslagen is maar 1 stuk (${fmt(count)} ${baseUnit}), terwijl de prijs voor ${fmt(pieces)} stuks geldt.`,
              proposal
            );
          }
          return rood(
            current,
            `Prijs geldt waarschijnlijk voor ${fmt(pieces)} stuks maar slechts 1 stuk is opgeslagen; de voorgestelde kostprijs is niet geloofwaardig.`
          );
        }
        if (nameSpec.packs !== null && nameSpec.packs !== pieces && nameSpec.kind !== "single") {
          return rood(current, `Naam noemt ${describe(nameSpec)}, omschrijving ${fmt(pieces)} stuks. Handmatig controleren.`);
        }
        notes.push("Omschrijving noemt alleen stuks; de inhoud komt uit de productnaam.");
      } else {
        return rood(
          current,
          `Omschrijving (${fmt(pieces)} stuks) en inhoud (${fmt(count)} ${baseUnit}) laten zich niet aan de naam koppelen. Handmatig controleren.`
        );
      }
    } else {
      return rood(current, "Verpakking in stuks voor een product in gewicht/inhoud, zonder gewicht per stuk of maat in de naam.");
    }
  } else if (specDim !== "aantal" && baseDim === "aantal") {
    // Omschrijving in gewicht/inhoud, product in stuks: het AANTAL STUKS telt, niet het totaalgewicht.
    const result = countInBaseUnit(spec, baseUnit, bridge);
    if (result.count === null) {
      return rood(current, `${result.explanation}.`);
    }
    if (!approxEqual(count, result.count)) {
      const totalInSpecUnit = spec.total;
      const totalInSmallest = convert(spec.total, spec.unit, UNIT_TABLE[spec.unit].dimension === "gewicht" ? "g" : "ml");
      const looksLikeTotal =
        approxEqual(count, totalInSpecUnit) || (totalInSmallest !== null && approxEqual(count, totalInSmallest));
      if (looksLikeTotal) {
        const proposal = proposalFor(input, result.count, input.description ?? "");
        return oranje(
          current,
          `Het totaalgewicht (${fmt(count)}) is als aantal stuks opgeslagen. ${describe(spec)} = ${fmt(result.count)} stuks.`,
          proposal
        );
      }
      return rood(
        current,
        `Opgeslagen aantal (${fmt(count)} stuks) komt niet overeen met de omschrijving (${describe(spec)} → ${fmt(result.count)} stuks).`
      );
    }
    if (!bridge?.quantity) {
      notes.push("Gewicht per stuk onbekend: alleen per stuk te gebruiken in recepten.");
    }
  } else {
    return rood(current, "Gewicht en inhoud worden door elkaar gebruikt; kan niet worden omgerekend.");
  }

  // ------------------------------------------------------------------
  // Stap 2: tegenstrijdigheid tussen productnaam en verpakkingsvelden
  // ------------------------------------------------------------------
  if (nameSpec && nameSpec.unit !== "stuk" && UNIT_TABLE[nameSpec.unit].dimension === specDim) {
    const nameTotal = convert(nameSpec.total, nameSpec.unit, spec.unit);
    if (nameTotal !== null && !approxEqual(nameTotal, spec.total, 0.03)) {
      const ratio = nameTotal / spec.total;
      if (approxEqual(ratio, 1000, 0.001) || approxEqual(ratio, 0.001, 0.001)) {
        notes.push("De naam noemt een andere eenheid (waarschijnlijk een typfout, bv. kg i.p.v. g); de verpakkingsvelden zijn consistent.");
      } else if (isPerKiloOrLiterSpec(spec)) {
        const unitLabel = dimensionUnit(spec);
        const nameInKgL = convert(nameTotal, spec.unit, unitLabel);
        const alt =
          nameInKgL && nameInKgL > 0
            ? `Als de prijs voor de hele verpakking (${fmt(nameTotal)} ${spec.unit}) geldt: € ${fmt(price / nameInKgL, 2)} per ${unitLabel}.`
            : null;
        return rood(
          current,
          `Opgeslagen als prijs per ${unitLabel} (verpakking 1 ${unitLabel}), maar de naam noemt ${describe(nameSpec)}. Is de prijs per ${unitLabel} of per doos?`,
          alt
        );
      } else {
        const differentPacks = nameSpec.packs !== null && spec.packs !== null && nameSpec.packs !== spec.packs;
        return rood(
          current,
          `Productnaam (${describe(nameSpec)}) en verpakking (${describe(spec)}) spreken elkaar tegen${differentPacks ? " (ander aantal per verpakking)" : ""}.`
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Stap 3: geloofwaardigheid van de uitkomst
  // ------------------------------------------------------------------
  const perKgL = perKgOrL(current, baseUnit);
  if (perKgL !== null && (perKgL < MIN_PRICE_PER_KG_L || perKgL > MAX_PRICE_PER_KG_L)) {
    return rood(current, `Onwaarschijnlijke prijs: € ${fmt(perKgL, 4)} per kg/l. Controleer verpakking en prijs.`);
  }

  return groen(current, notes);
}

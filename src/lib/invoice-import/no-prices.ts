import type { ParsedInvoiceLine } from "./parse-ubl";

export const NO_PRICES_MESSAGE =
  "Dit document bevat geen prijzen (waarschijnlijk een pakbon of orderbevestiging) en is niet verwerkt.";

/**
 * Een document met regels maar zonder één prijs of regeltotaal is geen
 * factuur (bv. een pakbon). Zulke documenten leveren niets op om te
 * controleren of door te voeren.
 */
export function hasNoPrices(lines: ParsedInvoiceLine[]): boolean {
  return (
    lines.length > 0 &&
    lines.every(
      (l) =>
        (l.unitPrice === null || l.unitPrice === undefined) &&
        (l.lineTotalExclVat === null || l.lineTotalExclVat === undefined)
    )
  );
}

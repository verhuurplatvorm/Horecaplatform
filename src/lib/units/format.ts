/**
 * Hoeveelheden leesbaar tonen: vanaf 1000 ml → liter, vanaf 1000 g → kilo.
 * Alleen weergave — opgeslagen waarden en invoervelden blijven ongewijzigd.
 *
 *   876 ml        → "876 ml"
 *   13400 ml      → "13,4 l"
 *   13400 milliliter → "13,4 liter"
 *   2500 gram     → "2,5 kilogram"
 */
const BIGGER: Record<string, string> = {
  ml: "l",
  milliliter: "liter",
  g: "kg",
  gr: "kg",
  gram: "kilogram",
};

export function formatAmount(
  quantity: number | string | null | undefined,
  unit: string | null | undefined,
  maxDecimals = 2,
): string {
  if (quantity === null || quantity === undefined || quantity === "") return "—";
  const q = typeof quantity === "string" ? Number(quantity.replace(",", ".")) : quantity;
  if (!Number.isFinite(q)) return "—";
  const u = (unit ?? "").trim();
  const big = BIGGER[u.toLowerCase()];
  const nf = (n: number) =>
    n.toLocaleString("nl-NL", { maximumFractionDigits: maxDecimals });
  if (big && Math.abs(q) >= 1000) return `${nf(q / 1000)} ${big}`;
  return `${nf(q)} ${u}`.trim();
}

/** Alleen de omgerekende waarde als die anders is (voor een hint naast een invoerveld). */
export function largerUnitHint(
  quantity: number | string | null | undefined,
  unit: string | null | undefined,
): string | null {
  const q = typeof quantity === "string" ? Number(quantity.replace(",", ".")) : quantity;
  if (q == null || !Number.isFinite(q) || Math.abs(q) < 1000) return null;
  if (!BIGGER[(unit ?? "").trim().toLowerCase()]) return null;
  return formatAmount(q, unit);
}

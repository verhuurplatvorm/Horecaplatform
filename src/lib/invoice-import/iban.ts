/** IBAN zonder spaties en in hoofdletters, zodat "NL80 RABO 0138 4685 40" en "NL80RABO0138468540" gelijk zijn. */
export function normalizeIban(v: string | null | undefined): string | null {
  const s = (v ?? "").replace(/\s+/g, "").toUpperCase();
  return s || null;
}

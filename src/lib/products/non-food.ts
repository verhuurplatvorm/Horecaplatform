/**
 * Herkent artikelen die waarschijnlijk geen eten of drinken zijn (borden,
 * bestek, schoonmaak, folie, stoepborden, …). Bewust een SUGGESTIE: op de
 * opruimpagina kan de gebruiker alles wat toch goed is uitvinken.
 * Liever te weinig dan te veel markeren; losse woorden als "zak" of "emmer"
 * staan er niet in omdat die ook gewoon eten kunnen zijn.
 */

// Afmeting met eenheid ("150x45cm", "300x118mm", "28,5x16,5x15 cm"): serviesgoed,
// bakken en folie hebben maten; eten heeft gewicht of inhoud.
const DIMENSION = /\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(?:cm|mm)\b/i;

const KEYWORDS: RegExp[] = [
  // Servies en gerei
  /bord(?:je|jes|en)?\b/i,
  /\bschaal(?:tje|tjes|en)?\b/i,
  /oesterschaal/i,
  /\bschotel(?:s|tje)?\b/i,
  /\bkom(?:men|metje)?\b/i,
  /beslagkom/i,
  /\b(?:wijn|bier|water|longdrink|champagne|cocktail|shot|whisky|gin)glas(?:en)?\b/i,
  /\bbeker(?:s)?\b/i,
  /\bkarafje?\b/i,
  /\bbestek(?:bak|mand|bakje)?\b/i,
  /\b(?:vork|lepel|lepeltje)(?:je|s|ken)?\b/i,
  /bestekmand|bestekbak/i,
  /\bsushi\s*mat(?:je)?\b|\bmatje\b/i,
  /bakmat|bakplaat|bakpapier|bakvorm/i,
  /\bgn[-\s]?(?:bak|deksel|vorm)\b|gastronorm/i,
  /snijplank|deegkrabber|frituurmand|schort\b/i,
  /prikker|tandenstoker|roerstaaf|roerstaafje|rietje|rietjes/i,
  // Verbruik en schoonmaak
  /toiletpapier|\btissue\b|handdoek|\bwipes?\b|servet(?:ten)?\b|placemat|tafelkleed/i,
  /alu(?:minium)?folie|vershoudfolie|filmrol|\bfolie\b|cling\s?film/i,
  /vuilniszak|afvalzak|kliko|prullenbak|pedaalemmer/i,
  /schoonmaak|reiniger|ontvetter|desinfect|afwasmiddel|handzeep|\bzeep\b|\bspons\b|dweil|vaatdoek|allesreiniger/i,
  /handschoen(?:en)?\b|mondkapje|haarnet|\bmuts\b|kerstmuts/i,
  // Sfeer en overig
  /kaars(?:houder)?|theelicht|stoepbord|krijtbord|menuhouder|bierviltje|\bvilt\b/i,
  /batterij|batterijen|\blamp\b|\bpen\b|stickers?\b|etiket(?:ten)?\b|\btape\b/i,
];

/** Waarschijnlijk geen eten of drinken? */
export function looksNonFood(name: string | null | undefined): boolean {
  if (!name) return false;
  if (DIMENSION.test(name)) return true;
  return KEYWORDS.some((re) => re.test(name));
}

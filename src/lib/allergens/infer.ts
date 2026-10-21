/**
 * Allergenen voorstellen op basis van de productnaam.
 *
 * Dit is een VOORSTEL, geen feit: de naam zegt niet alles (een saus kan
 * van alles bevatten). Daarom:
 *  - "zeker"   = de naam noemt het ingrediënt zelf (melk, zalm, tarwebloem…)
 *  - "aanname" = typisch voor dit soort product (taart bevat meestal ei,
 *                gluten en melk) — moet door een mens bevestigd worden
 *  - "geen_verwacht" = eenvoudig vers product (groente, fruit, kruid) of
 *                sterke drank, zonder bewerkingswoorden in de naam
 *  - "onbekend" = niets herkend: wordt NIET als "geen allergenen" gezien
 */

export const ALLERGEN_LIST = [
  "gluten",
  "schaaldieren",
  "eieren",
  "vis",
  "pinda",
  "soja",
  "melk",
  "noten",
  "selderij",
  "mosterd",
  "sesam",
  "sulfiet",
  "lupine",
  "weekdieren",
] as const;

export type AllergenKey = (typeof ALLERGEN_LIST)[number];
export type AllergenStatus = "gevonden" | "geen_verwacht" | "onbekend";

export interface AllergenGuess {
  status: AllergenStatus;
  /** Allergenen waarvan de naam het ingrediënt zelf noemt. */
  certain: AllergenKey[];
  /** Allergenen die typisch zijn voor dit soort product (te controleren). */
  assumed: AllergenKey[];
  reasons: string[];
}

interface Rule {
  allergen: AllergenKey;
  re: RegExp;
  kind: "zeker" | "aanname";
  label: string;
  unless?: RegExp;
}

const GLUTEN_FREE = /glutenvrij|gluten vrij|gluten-vrij|gluten free|glutenfree|\bgf\b/;
const GLUTEN_OR_FLOWER = /glutenvrij|gluten vrij|gluten-vrij|gluten free|glutenfree|\bgf\b|eetbare bloem|bloemen|viooltje/;
const PLANT = /plant based|plantaardig|plantaardige|vegan|veganistisch|soja ?drink|haver ?drink|amandel ?melk|haver ?melk|kokos ?melk|rijst ?melk|sojamelk|\bdairy free|zuivelvrij|lactosevrij?/;
const NO_MILK_COMPOUND = /pindakaas|cacao ?boter|shea|boterham|botervlinder|\bboter ?bloem\b|notenboter|kokosboter/;

const RULES: Rule[] = [
  // gluten
  { allergen: "gluten", kind: "zeker", label: "tarwe/meel/brood/pasta", unless: GLUTEN_OR_FLOWER,
    re: /\btarwe|\bbloem\b|meel\b|\bbrood|\bbrod\b|broodje|baguette|ciabatta|focaccia|\bpasta\b|spaghetti|penne|lasagne|macaroni|tagliatelle|fusilli|rigatoni|farfalle|noedel|\bmie\b|couscous|bulgur|\bgerst|\brogge|\bhaver|\bspelt|paneermeel|\bpanko|gepaneerd|\bpaneer|tempura|croissant|pizza|\bwrap\b|tortilla|gyoza|loempia|wonton|dumpling|stroopwafel|beschuit|cracker|crouton|gnocchi|\bbier\b|\bbirra\b|\bpils\b|weizen|\bipa\b|tripel|dubbel|\bstout\b|sojasaus|ketjap|teriyaki|hoisin|seitan|beignet|donut|brioche|pretzel|bagel|toast\b|knäckebröd|knackebrod|vikingbrod|roggebrood|panini|pita|naan|taco shell|frikandel|kroket|bitterbal|schnitzel|cordon bleu|nuggets?\b/ },
  { allergen: "gluten", kind: "aanname", label: "gebak/taart/koek bevat meestal gluten", unless: GLUTEN_FREE,
    re: /\btaart|gebak|\bcake\b|koek\b|koekje|cookie|brownie|muffin|cupcake|macaron|tartelette|\btarte\b|bavarois|cheesecake|tiramisu|eclair|soes\b|cannoli|wafel|biscuit|speculaas|pannenkoek|poffertje|bladerdeeg|filodeeg|pizzabodem|deeg\b|lasagnevel|vers pasta/ },
  // melk
  { allergen: "melk", kind: "zeker", label: "melk/kaas/boter/room/yoghurt", unless: undefined,
    re: /melk|\bkaas|kaasblok|\bkaasje|\bboter\b|roomboter|\broom\b|slagroom|kookroom|koffieroom|room ?ijs|roomijs|yoghurt|yogurt|\bkwark|cr[eè]me fra[iî]che|mascarpone|ricotta|mozzarella|burrata|parmezaan|parmesan|grana padano|pecorino|cheddar|\bbrie\b|camembert|feta\b|\bgouda|edammer|emmental|gruy[eè]re|gorgonzola|manchego|halloumi|geitenbrie|boursin|philadelphia|\bghee\b|\bwhey|melkchocolade|melk ?chocolade|witte chocolade|irish cream|baileys|advocaat|\bvla\b|panna cotta|\bmilk\b|\bcheese\b|\bcream\b|\bbutter\b|\bcrème\b|\bcreme\b|cr[eè]me br[uû]l[eé]e|\bgelato\b(?!.*sorbet)|\bijsbomb|\bcappuccino mix|chocolademelk|hangop|\bdairy\b/ },
  { allergen: "melk", kind: "aanname", label: "gebak/ijs/saus bevat meestal melk",
    re: /\btaart|gebak|bavarois|cheesecake|tiramisu|brownie|\bmousse\b|pudding|\bijs\b|ijs\s|roomijs|caramel|\bpesto\b|carbonara|bechamel|b[eé]chamel|hollandaise|bearnaise|b[eé]arnaise|croissant|brioche|\bcake\b|cupcake|muffin|eclair|soes\b|\bwafel|pannenkoek|poffertje|\bcr[eè]me\b|\bfudge\b|\btoffee\b|nougat|\bchocolade|chocola\b|\bgnocchi/ },
  // eieren
  { allergen: "eieren", kind: "zeker", label: "ei",
    re: /\bei\b|\beieren\b|\beier|kwarteleier|eigeel|\bmayonaise|\bmayo\b|advocaat|hollandaise|b[eé]arnaise|\begg\b|\beggs\b|meringue|schuimpje|aioli|tiramisu|carbonara|\bcaesar/ },
  { allergen: "eieren", kind: "aanname", label: "gebak/pasta/beslag bevat meestal ei",
    re: /\btaart|gebak|\bcake\b|cupcake|muffin|brownie|bavarois|cheesecake|mousse|\bvla\b|pannenkoek|poffertje|brioche|croissant|eclair|soes\b|macaron|lasagnevel|vers pasta|tagliatelle|noedel|tempura|beslag|cr[eè]me br[uû]l[eé]e|panna cotta|\bnasi\b|\bbami\b|loempia|gyoza|wonton|quiche|omelet|\bkoek\b|koekje|speculaas|stroopwafel/ },
  // vis
  { allergen: "vis", kind: "zeker", label: "vis",
    re: /\bvis\b|visfond|vissaus|\bzalm|tonijn|kabeljauw|\bschol\b|\btong\b|tongfilet|zeebaars|dorade|doradekarper|haring|makreel|ansjovis|ansjovisfilet|sardine|\bforel|heilbot|wijting|\bsnoek|paling|\bharder\b|zeewolf|\brog\b|meerval|pangasius|zeeduivel|tarbot|\bkabeljauwhaas|surimi|\bkaviaar|\brom\b|\bsashimi|bonito|\bzeebrasem|\bsteur\b|\bkibbeling|lekkerbek|\bfish\b|\bsalmon\b|\btuna\b|\bcod\b|\bworcester|woostersaus|\bcaesar/ },
  // schaaldieren
  { allergen: "schaaldieren", kind: "zeker", label: "schaaldier",
    re: /garnaal|garnalen|\bgamba|scampi|kreeft|\bkrab\b|krabben|langoustine|crevette|shrimp|\bprawn|lobster|\bcrab\b|noordzeekrab|\bbisque/ },
  // weekdieren
  { allergen: "weekdieren", kind: "zeker", label: "weekdier",
    re: /\bmossel|mosselen|oester|\boyster|st\.? ?jacob|sint jacob|coquille|inktvis|calamari|\bcalamares|octopus|pijlinktvis|kokkel|schelp|vongole|\babalone|\bslak|\bsquid|\bclam|\bmussel|\bwulk|zeeslak/ },
  // pinda
  { allergen: "pinda", kind: "zeker", label: "pinda",
    re: /pinda|\bsat[eé]|satay|\bpeanut/ },
  // noten
  { allergen: "noten", kind: "zeker", label: "noten",
    re: /\bnoot\b|noten\b|walnoot|hazelnoot|amandel|cashew|pistache|\bpecan|macadamia|paranoot|marsepein|\bpraline|nutella|gianduja|amaretto|frangipane|amarettini|\bnut\b|\bnuts\b|\balmond|hazelnut|pistachio|walnut|\bnougat/ },
  // soja
  { allergen: "soja", kind: "zeker", label: "soja",
    re: /\bsoja|\bsoy|\btofu|edamame|tempeh|\bmiso|ketjap|teriyaki|hoisin|\btamari|sojasaus/ },
  // selderij
  { allergen: "selderij", kind: "zeker", label: "selderij",
    re: /selderij|\bselderie|celery|knolselderij|bleekselderij|selderijzout/ },
  { allergen: "selderij", kind: "aanname", label: "bouillon/fond/soep bevat meestal selderij",
    re: /bouillon|\bfond\b|\bfumet\b|\bjus\b|\bsoep\b|soup|\bbisque\b|\bkruidenmix|\bkruidenzout|\bgarnituur zout/ },
  // mosterd
  { allergen: "mosterd", kind: "zeker", label: "mosterd",
    re: /mosterd|\bdijon|mustard|\bmosterdzaad/ },
  { allergen: "mosterd", kind: "aanname", label: "dressing/saus bevat vaak mosterd",
    re: /\bmayonaise|\bmayo\b|\bvinaigrette|\bdressing|\bketchup|\bremoulade|\bcocktailsaus|tartaar|\bpickle|\bsandwichspread/ },
  // sesam
  { allergen: "sesam", kind: "zeker", label: "sesam",
    re: /sesam|tahin|tahini|\bhummus|gomasio|\bsesame/ },
  // sulfiet
  { allergen: "sulfiet", kind: "zeker", label: "wijn/azijn/gedroogd fruit (sulfiet)",
    re: /wijn(?!glas)|\bwine\b|\bvin\b|vermouth|\bmartini\b|\bport\b|\bporto\b|sherry|madeira|marsala|prosecco|champagne|\bcava\b|\bsekt\b|\bbrut\b|ros[eé]\b|cabernet|sauvignon|merlot|chardonnay|\bpinot|riesling|shiraz|syrah|malbec|tempranillo|alba[rñ]+ino|grenache|garnacha|verdejo|sangiovese|nebbiolo|primitivo|chenin|viognier|gew[uü]rz|muscat|moscato|rioja|\bchianti|\bbarolo|\bsancerre|\bchablis|\bbordeaux|\bbourgogne|\bburgundy|rias baixas|azijn|aceto|balsamico|\bcider\b|\bcidre\b|rozijn|gedroogde (abrikoos|vijg|appel|pruim)|\bpruimen|\bsulfiet|\bsulphite|\bsulfite/ },
  // lupine
  { allergen: "lupine", kind: "zeker", label: "lupine", re: /lupine|\blupin\b/ },
];

/** Eenvoudige verse producten en dranken waar normaal geen allergeen in zit. */
const PLAIN_LONG =
  /(aardbei|framboos|frambozen|bosbes|sinaasappel|mandarijn|banaan|druiven?|ananas|mango|meloen|kiwi|granaatappel|passievrucht|tomaat|tomaten|komkommer|paprika|sjalot|knoflook|peterselie|dille|basilicum|tijm|rozemarijn|koriander|champignon|paddenstoel|spinazie|rucola|courgette|aubergine|aardappel|bloemkool|broccoli|asperge|radijs|linzen|pompoen|avocado|olijfolie|whisky|whiskey|tequila|cognac|jenever|calvados|kipfilet|entrecote|ribeye|biefstuk|gehakt|kalkoen|konijn|citroen|limoen|appel|peren|wortel|bieten)/;
const PLAIN_SHORT =
  /\b(ui|uien|prei|munt|peer|kers|kersen|sla|rijst|bonen|erwten|mais|gember|olie|zout|peper|suiker|water|koffie|thee|cola|spa|tonic|vodka|gin|rum|kip|rund|varken|lam|haas|eend|kool|bieten?)\b/;
const PROCESSED =
  /\d+\s*(stuks|st\b|punten|puntjes|pers)|gemarineerd|gepaneerd|gevuld|saus|sauce|mix\b|soep|salade|dressing|bereid|gerookt|worst|ham\b|spek|gekruid|kruiden|marinade|bouillon|poeder|siroop|likeur|liqueur|sorbet|ijs\b|taart|koek|cake|vegetarisch|vegan|burger|nuggets?|kroket|nasi|bami|saté|sate|kant en klaar|ready|pesto|puree|compote|jam\b|confituur|chutney|drank|limonade|gin tonic|cocktail|sloe|vermouth|irish|cream|likeur/;

export function inferAllergens(rawName: string): AllergenGuess {
  const name = rawName.toLowerCase();
  const certain = new Set<AllergenKey>();
  const assumed = new Set<AllergenKey>();
  const reasons: string[] = [];

  const plant = PLANT.test(name);
  for (const rule of RULES) {
    if (rule.unless && rule.unless.test(name)) continue;
    if (rule.allergen === "melk") {
      if (plant) continue;
      if (/sorbet/.test(name) && !/\bmelk|room|yoghurt/.test(name)) continue;
      if (NO_MILK_COMPOUND.test(name) && !/\bmelk|\bkaas\b(?!.*pinda)/.test(name.replace(NO_MILK_COMPOUND, ""))) continue;
    }
    if (rule.allergen === "eieren" && rule.kind === "zeker" && /\bvegan|eivrij|eier?vrij/.test(name)) continue;
    if (rule.re.test(name)) {
      if (rule.kind === "zeker") {
        certain.add(rule.allergen);
        reasons.push(`${rule.allergen}: ${rule.label}`);
      } else if (!certain.has(rule.allergen)) {
        assumed.add(rule.allergen);
        reasons.push(`${rule.allergen}: ${rule.label} (aanname)`);
      }
    }
  }
  for (const a of certain) assumed.delete(a);

  if (certain.size > 0 || assumed.size > 0) {
    return { status: "gevonden", certain: [...certain], assumed: [...assumed], reasons };
  }
  if ((PLAIN_LONG.test(name) || PLAIN_SHORT.test(name)) && !PROCESSED.test(name)) {
    return {
      status: "geen_verwacht",
      certain: [],
      assumed: [],
      reasons: ["eenvoudig vers product of sterke drank, geen bewerkingswoorden"],
    };
  }
  return { status: "onbekend", certain: [], assumed: [], reasons: [] };
}

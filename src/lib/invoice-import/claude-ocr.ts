import type { ParsedInvoice } from "./parse-ubl";

const EXTRACTION_PROMPT = `Je krijgt een foto of PDF van een inkoopfactuur van een horecaleverancier. Lees de factuur en geef ALLEEN geldige JSON terug, exact in dit schema, zonder uitleg, zonder markdown-codeblok:

{
  "header": {
    "invoiceNumber": string of null,
    "invoiceDate": string (YYYY-MM-DD) of null,
    "dueDate": string (YYYY-MM-DD) of null,
    "supplierName": string of null,
    "supplierVatNumber": string of null,
    "supplierKvkNumber": string of null,
    "supplierIban": string of null,
    "currency": "EUR",
    "subtotalExclVat": number of null,
    "totalInclVat": number of null
  },
  "lines": [
    {
      "lineNumber": number,
      "eanCode": string of null,
      "articleNumber": string of null,
      "description": string of null,
      "packagingDescription": string of null,
      "quantity": number of null,
      "unit": string of null,
      "unitPrice": number of null,
      "lineTotalExclVat": number of null
    }
  ]
}

Belangrijk:
- Als een veld niet leesbaar of niet aanwezig is, gebruik null — verzin nooit een waarde.
- "packagingDescription" is de INHOUD van één verpakking (bv. "2 kg", "1 liter", "6 x 330ml") — let op: leveranciers zetten dit vaak IN de artikelnaam zelf, bijvoorbeeld "MOSSELEN SUPER SELECT 2 KG" betekent dat één verpakking 2 kg bevat. Haal dit er dan uit, ook al staat het niet in een aparte kolom.
- "quantity" is het AANTAL bestelde verpakkingen (bv. 10 zakken van 2 kg), NIET de inhoud per verpakking — verwar deze twee niet met elkaar.
- Sommige (met name vis-)leveranciers gebruiken één kolom "Aantal kg/st" voor zowel stuks als gewicht: een waarde met een "S" erachter (bv. "18 S") betekent stuks/verpakkingen; een kale decimale waarde zonder letter (bv. "29,808") betekent kilogram. Neem in dat laatste geval "quantity" = dat getal en "unit" = "kg" — verzin geen stuks-aantal.
- "unitPrice" is de prijs per de vermelde eenheid: bij stuks-regels (S) is dat de prijs per verpakking; bij kilo-regels is dat de prijs per kilogram (niet de totale regelprijs).
- Eén factuur kan meerdere leveringen/pakbonnen bevatten (bv. "Volgens pakbon nr. van ... 27-07-2026"). Behandel al deze regels gewoon als aparte factuurregels van dezelfde factuur — maak er geen aparte facturen van en sla de pakbon-kopregels zelf niet op als los item.
- Negeer eventuele losse letters/codes aan het einde van een regel die alleen een btw-categorie aangeven (bv. een losse "L" of "H"), dat is geen onderdeel van de prijs of omschrijving.
- Gebruik een punt als decimaalteken, ongeacht hoe het op de factuur staat (een factuur gebruikt vaak een komma).
- Geef uitsluitend het JSON-object terug, niets ervoor of erna.`;

/**
 * Leest een factuur (PDF of foto) uit via de Claude API (vision) — de
 * gebruiker levert hiervoor zijn eigen ANTHROPIC_API_KEY aan (apart van
 * een claude.ai-abonnement; te verkrijgen via console.anthropic.com).
 * Geeft hetzelfde vormschema terug als de UBL-parser, zodat het resultaat
 * door precies dezelfde matching/review-flow kan lopen.
 */
export async function extractInvoiceWithClaude(
  buffer: Buffer,
  mimeType: string,
  supplierHint?: { supplierName: string; fieldNotes: string } | null
): Promise<ParsedInvoice> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[invoice-import] ANTHROPIC_API_KEY ontbreekt.");
    throw new Error(
      "ANTHROPIC_API_KEY ontbreekt. Voeg 'm toe aan .env.local (lokaal) en aan de Vercel-projectinstellingen (Environment Variables) — een eigen API-sleutel is te verkrijgen via console.anthropic.com (los van een claude.ai-abonnement)."
    );
  }

  console.log(
    `[invoice-import] Claude OCR gestart — ${buffer.length} bytes, type ${mimeType}${
      supplierHint ? ` — bekende leverancier: ${supplierHint.supplierName}` : ""
    }`
  );

  const base64 = buffer.toString("base64");
  const isPdf = mimeType === "application/pdf";

  const promptText =
    supplierHint && supplierHint.fieldNotes.trim()
      ? `${EXTRACTION_PROMPT}\n\nExtra aanwijzingen speciaal voor deze leverancier (${supplierHint.supplierName}), gebaseerd op eerder gecorrigeerde facturen — houd hier nadrukkelijk rekening mee:\n${supplierHint.fieldNotes.trim()}`
      : EXTRACTION_PROMPT;

  const content = [
    isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
    { type: "text", text: promptText },
  ];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      messages: [{ role: "user", content }],
    }),
  });

  console.log(`[invoice-import] Claude API-antwoord: HTTP ${response.status}`);

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[invoice-import] Claude API-fout ${response.status}: ${errText.slice(0, 500)}`);
    throw new Error(`Claude API-fout (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
  if (!textBlock?.text) {
    console.error("[invoice-import] Claude gaf geen tekstblok terug:", JSON.stringify(data).slice(0, 500));
    throw new Error("Claude gaf geen leesbaar antwoord terug.");
  }

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
  let parsed: ParsedInvoice;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error(
      "[invoice-import] Kan Claude-antwoord niet als JSON parsen. Eerste 500 tekens:",
      cleaned.slice(0, 500),
      err
    );
    throw new Error("Kan het antwoord van Claude niet als JSON lezen. Controleer handmatig.");
  }

  if (!parsed.header || !Array.isArray(parsed.lines)) {
    console.error("[invoice-import] Onverwacht antwoordformaat:", JSON.stringify(parsed).slice(0, 500));
    throw new Error("Onverwacht antwoordformaat van Claude.");
  }

  console.log(
    `[invoice-import] Claude OCR gelukt — leverancier "${parsed.header.supplierName}", ${parsed.lines.length} regels herkend`
  );

  return parsed;
}

/** Bestandstypen die via Claude-vision gelezen kunnen worden. */
export function isClaudeOcrSupported(mimeType: string, filename: string): boolean {
  const name = filename.toLowerCase();
  return (
    mimeType === "application/pdf" ||
    name.endsWith(".pdf") ||
    mimeType.startsWith("image/") ||
    /\.(jpg|jpeg|png|webp)$/.test(name)
  );
}

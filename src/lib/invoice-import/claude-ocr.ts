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
      "quantity": number of null,
      "unit": string of null,
      "unitPrice": number of null,
      "lineTotalExclVat": number of null
    }
  ]
}

Belangrijk:
- Als een veld niet leesbaar of niet aanwezig is, gebruik null — verzin nooit een waarde.
- "unitPrice" is de prijs per de vermelde eenheid (bv. per kg, per stuk, per doos), niet per totale regel.
- Gebruik een punt als decimaalteken in getallen, ongeacht hoe het op de factuur staat.
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
  mimeType: string
): Promise<ParsedInvoice> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY ontbreekt. Voeg 'm toe aan .env.local (lokaal) en aan de Vercel-projectinstellingen (Environment Variables) — een eigen API-sleutel is te verkrijgen via console.anthropic.com (los van een claude.ai-abonnement)."
    );
  }

  const base64 = buffer.toString("base64");
  const isPdf = mimeType === "application/pdf";

  const content = [
    isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
    { type: "text", text: EXTRACTION_PROMPT },
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

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API-fout (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("Claude gaf geen leesbaar antwoord terug.");
  }

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
  let parsed: ParsedInvoice;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Kan het antwoord van Claude niet als JSON lezen. Controleer handmatig.");
  }

  if (!parsed.header || !Array.isArray(parsed.lines)) {
    throw new Error("Onverwacht antwoordformaat van Claude.");
  }

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

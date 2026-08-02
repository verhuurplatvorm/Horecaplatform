const MENU_CATEGORIES = [
  "Voorgerechten",
  "Soepen",
  "Hoofdgerechten",
  "Visgerechten",
  "Vleesgerechten",
  "Vegetarische gerechten",
  "Desserts",
  "Lunch",
  "Borrel",
  "Dranken",
  "Overig",
];

export interface ExtractedDish {
  name: string;
  description: string | null;
  price: number | null;
  category: string;
}

const EXTRACTION_PROMPT = `Je krijgt een PDF van een menukaart van een horecazaak. Lees alle gerechten/dranken die erop staan en geef ALLEEN geldige JSON terug, exact in dit schema, zonder uitleg, zonder markdown-codeblok:

{
  "dishes": [
    {
      "name": string,
      "description": string of null,
      "price": number of null,
      "category": string
    }
  ]
}

Belangrijk:
- "name" is de naam van het gerecht zoals op de kaart staat.
- "description" is de bijbehorende omschrijving (ingrediënten/toelichting), of null als die er niet is.
- "price" is de verkoopprijs als getal met een punt als decimaalteken (bv. 18.50), of null als er geen prijs bij staat.
- "category" moet exact één van deze waarden zijn: ${MENU_CATEGORIES.join(", ")}. Kies de best passende; gebruik "Overig" alleen als niets anders logisch past.
- Neem elk gerecht/drank apart op, ook als er meerdere onder één kopje staan.
- Sla kopjes/hoofdstuktitels zelf niet op als los "gerecht" — alleen de daadwerkelijke items.
- Gebruik een punt als decimaalteken, ongeacht hoe het op de kaart staat.
- Geef uitsluitend het JSON-object terug, niets ervoor of erna.`;

/**
 * Leest een menukaart-PDF uit via de Claude API (vision) — vereist de
 * gebruiker-eigen ANTHROPIC_API_KEY (zie ook invoice-import/claude-ocr.ts,
 * dezelfde sleutel wordt hiervoor hergebruikt).
 */
export async function extractMenuFromPdf(buffer: Buffer): Promise<ExtractedDish[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY ontbreekt. Voeg 'm toe aan .env.local (lokaal) en aan de Vercel-projectinstellingen — een eigen API-sleutel is te verkrijgen via console.anthropic.com."
    );
  }

  const base64 = buffer.toString("base64");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
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
  let parsed: { dishes: ExtractedDish[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Kan het antwoord van Claude niet als JSON lezen. Controleer handmatig.");
  }

  if (!Array.isArray(parsed.dishes)) {
    throw new Error("Onverwacht antwoordformaat van Claude.");
  }

  return parsed.dishes.map((d) => ({
    name: d.name,
    description: d.description ?? null,
    price: typeof d.price === "number" ? d.price : null,
    category: MENU_CATEGORIES.includes(d.category) ? d.category : "Overig",
  }));
}

export { MENU_CATEGORIES };

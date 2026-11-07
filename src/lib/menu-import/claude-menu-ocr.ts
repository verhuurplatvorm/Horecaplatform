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
export async function extractMenuFromPdf(
  buffer: Buffer,
): Promise<ExtractedDish[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY ontbreekt. Voeg 'm toe aan .env.local (lokaal) en aan de Vercel-projectinstellingen — een eigen API-sleutel is te verkrijgen via console.anthropic.com.",
    );
  }

  const base64 = buffer.toString("base64");
  console.log(
    `[menu-import] Claude-uitlezing gestart — ${buffer.length} bytes`,
  );

  // Streaming: een magazine/meerpagina-kaart levert een lang antwoord op.
  // Zonder streaming kan zo'n lange aanvraag halverwege afbreken; met
  // streaming komt de tekst binnen zolang Claude schrijft.
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      // Ruim bemeten: een menukaart in magazinevorm telt al snel 100+ items.
      max_tokens: 32000,
      stream: true,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok || !response.body) {
    const errText = await response.text();
    console.error(
      `[menu-import] Claude API-fout ${response.status}: ${errText.slice(0, 500)}`,
    );
    throw new Error(
      `Claude API-fout (${response.status}): ${errText.slice(0, 300)}`,
    );
  }

  const { text, stopReason, streamError } = await readClaudeStream(
    response.body,
  );
  console.log(
    `[menu-import] Claude-antwoord: ${text.length} tekens, stop_reason=${stopReason ?? "onbekend"}`,
  );

  if (streamError) {
    throw new Error(`Claude API-fout tijdens het uitlezen: ${streamError}`);
  }

  if (!text.trim()) {
    if (stopReason === "refusal") {
      throw new Error(
        "Claude weigerde deze PDF uit te lezen. Probeer een PDF met alleen de menukaartpagina's (zonder overige magazine-inhoud).",
      );
    }
    throw new Error(
      `Claude gaf geen leesbaar antwoord terug (stop_reason: ${stopReason ?? "onbekend"}). Probeer het nog eens of upload alleen de menukaartpagina's.`,
    );
  }

  const cleaned = extractJsonObject(text.replace(/```json|```/g, "").trim());
  let parsed: { dishes: ExtractedDish[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Afgekapt (max_tokens) of rommel rond de JSON: red de volledige items.
    const repaired = repairTruncatedDishes(cleaned);
    if (!repaired) {
      console.error(
        "[menu-import] JSON niet leesbaar. Eerste 500 tekens:",
        cleaned.slice(0, 500),
      );
      throw new Error(
        "Kan het antwoord van Claude niet als JSON lezen. Controleer handmatig.",
      );
    }
    console.warn(
      `[menu-import] Antwoord was afgekapt (stop_reason=${stopReason}); ${repaired.dishes.length} volledige item(s) hersteld.`,
    );
    parsed = repaired;
  }

  if (!Array.isArray(parsed.dishes)) {
    throw new Error("Onverwacht antwoordformaat van Claude.");
  }

  return parsed.dishes
    .filter((d) => d && typeof d.name === "string" && d.name.trim())
    .map((d) => ({
      name: d.name,
      description: d.description ?? null,
      price: typeof d.price === "number" ? d.price : null,
      category: MENU_CATEGORIES.includes(d.category) ? d.category : "Overig",
    }));
}

/** Leest een SSE-stream van de Messages API en voegt de tekst samen. */
async function readClaudeStream(
  body: ReadableStream<Uint8Array>,
): Promise<{
  text: string;
  stopReason: string | null;
  streamError: string | null;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let stopReason: string | null = null;
  let streamError: string | null = null;

  const handleLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    try {
      const ev = JSON.parse(payload);
      if (
        ev.type === "content_block_delta" &&
        ev.delta?.type === "text_delta"
      ) {
        text += ev.delta.text ?? "";
      } else if (ev.type === "message_delta" && ev.delta?.stop_reason) {
        stopReason = ev.delta.stop_reason;
      } else if (ev.type === "error") {
        streamError = ev.error?.message ?? "onbekende fout";
      }
    } catch {
      // onvolledige of niet-JSON regel negeren
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      handleLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer) handleLine(buffer);

  return { text, stopReason, streamError };
}

/** Knipt eventuele tekst vóór de eerste "{" weg. */
function extractJsonObject(text: string): string {
  const first = text.indexOf("{");
  return first > 0 ? text.slice(first) : text;
}

/**
 * Redt een afgekapt antwoord: houdt alle volledige objecten in de
 * "dishes"-array over en sluit de JSON netjes af.
 */
function repairTruncatedDishes(
  text: string,
): { dishes: ExtractedDish[] } | null {
  const key = text.indexOf('"dishes"');
  if (key < 0) return null;
  const arrayStart = text.indexOf("[", key);
  if (arrayStart < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastCompleteEnd = -1;
  for (let i = arrayStart + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) lastCompleteEnd = i;
    } else if (ch === "]" && depth === 0) break;
  }
  if (lastCompleteEnd < 0) return null;

  try {
    const parsed = JSON.parse(text.slice(0, lastCompleteEnd + 1) + "]}");
    return Array.isArray(parsed.dishes) ? parsed : null;
  } catch {
    return null;
  }
}

export { MENU_CATEGORIES };

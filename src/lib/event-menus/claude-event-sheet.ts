import {
  extractJsonObject,
  readClaudeStream,
} from "@/lib/menu-import/claude-menu-ocr";

/**
 * Een evenementsheet (draaiboek) uitlezen met Claude: alleen de eetbare
 * onderdelen (buffetten, gangen, brood, dessert) plus de kerngegevens
 * (naam, datum, aantal gasten, prijs culinaire verzorging p.p.).
 * Logistiek, dranken en programma worden genegeerd.
 */

export interface EventSheetItem {
  section: string | null;
  name: string;
  note: string | null;
}

export interface EventSheetMeta {
  name: string | null;
  date: string | null; // yyyy-mm-dd
  guests: number | null;
  food_price_per_person: number | null;
}

const PROMPT = `Je krijgt een evenementsheet (draaiboek) van een restaurant. Haal ALLEEN het eten eruit dat de keuken moet maken of klaarzetten, en de kerngegevens. Geef ALLEEN geldige JSON terug, zonder uitleg en zonder markdown:

{
  "meta": {
    "name": string of null,            // naam van het evenement/de klant, bv. "Katwijk Chemie"
    "date": "yyyy-mm-dd" of null,
    "guests": number of null,           // aantal gasten/personen
    "food_price_per_person": number of null  // prijs culinaire verzorging/eten per persoon, incl. btw
  },
  "items": [
    { "section": string of null, "name": string, "note": string of null }
  ]
}

Regels:
- "section" = het kopje van het onderdeel zoals op de sheet, bv. "Buffet Het Strand - Koud", "Buffet Het Strand - Warm", "Dessertbuffet", "Brood". Kort en zonder tijd.
- Eén item per gerecht of component. Laat een beschrijving die bij het gerecht hoort in de naam staan (bv. "Gerookte ribeye met truffelmayonaise, zontomaat en rucola").
- Een opsomming als "Diverse bolletjes ijs: gezouten karamel, hazelnoot, mango" wordt één item per smaak (bv. "IJs gezouten karamel"), met section van het kopje.
- Neem "Brood met smeersels" maar één keer op, ook als het meerdere keren genoemd wordt.
- Vega-alternatieven die genoemd worden (bv. "Waarschijnlijk: Groente curry & Paddenstoelenrisotto") wel opnemen, section "Vega", met note "waarschijnlijk" als dat er staat.
- Opmerkingen bij een gerecht (bv. "saus apart geserveerd", "in schaaltjes op tafel") in "note".
- NIET opnemen: dranken en drankarrangement, koffie/thee, programma, tijden, toespraken, materialen, tafelindeling, contactgegevens, scheidingstekens zoals "***", prijzen en totalen.`;

export async function extractEventSheet(
  input: { pdf: Buffer } | { text: string },
): Promise<{ meta: EventSheetMeta; items: EventSheetItem[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    throw new Error("ANTHROPIC_API_KEY ontbreekt in de Vercel-instellingen.");

  const content =
    "pdf" in input
      ? [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: input.pdf.toString("base64"),
            },
          },
          { type: "text", text: PROMPT },
        ]
      : [
          {
            type: "text",
            text: `${PROMPT}\n\nDe sheet (als tekst, cellen gescheiden door tabs):\n\n${input.text.slice(0, 60000)}`,
          },
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
      max_tokens: 8000,
      stream: true,
      messages: [{ role: "user", content }],
    }),
  });
  if (!response.ok || !response.body) {
    const errText = await response.text();
    throw new Error(
      `Claude API-fout (${response.status}): ${errText.slice(0, 300)}`,
    );
  }
  const { text, streamError } = await readClaudeStream(response.body);
  if (streamError)
    throw new Error(`Claude API-fout tijdens het uitlezen: ${streamError}`);

  let parsed: { meta?: Partial<EventSheetMeta>; items?: EventSheetItem[] };
  try {
    parsed = JSON.parse(
      extractJsonObject(text.replace(/```json|```/g, "").trim()),
    );
  } catch {
    throw new Error("Kan het antwoord niet lezen. Probeer het nog eens.");
  }
  const m = parsed.meta ?? {};
  return {
    meta: {
      name: typeof m.name === "string" && m.name.trim() ? m.name.trim() : null,
      date:
        typeof m.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.date)
          ? m.date
          : null,
      guests:
        typeof m.guests === "number" && m.guests > 0
          ? Math.round(m.guests)
          : null,
      food_price_per_person:
        typeof m.food_price_per_person === "number" &&
        m.food_price_per_person > 0
          ? m.food_price_per_person
          : null,
    },
    items: (parsed.items ?? [])
      .filter((i) => i && typeof i.name === "string" && i.name.trim())
      .map((i) => ({
        section:
          typeof i.section === "string" && i.section.trim()
            ? i.section.trim()
            : null,
        name: i.name.trim(),
        note:
          typeof i.note === "string" && i.note.trim() ? i.note.trim() : null,
      })),
  };
}

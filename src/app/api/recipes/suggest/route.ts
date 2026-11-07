import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Receptvoorstel door Claude voor een (nieuw) halfproduct of gerecht.
 *
 * Claude geeft generieke ingrediëntregels ("1000 g tarwebloem"); de
 * koppeling aan echte ingrediënten/halfproducten gebeurt daarna in het
 * receptformulier via de gewone herkenning (zelfde als "Als tekst
 * bewerken"). Er wordt niets opgeslagen: de gebruiker controleert en
 * slaat zelf op.
 */

export const maxDuration = 60;

interface SuggestBody {
  name: string;
  kind: "halfproduct" | "gerecht";
}

export interface RecipeSuggestion {
  ingredients: { quantity: number; unit: string; name: string }[];
  yield_quantity: number | null;
  yield_unit: string | null;
  preparation: string | null;
  storage: string | null;
  note: string | null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const body = (await request.json()) as SuggestBody;
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Vul eerst een naam in." }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY ontbreekt op de server." }, { status: 500 });
  }

  // Bestaande halfproducten meegeven, zodat Claude die kan hergebruiken
  // (bv. "Pizzasaus" als halfproduct i.p.v. losse tomaten).
  const { data: halfproducts } = await supabase
    .from("recipes")
    .select("name")
    .eq("recipe_kind", "halfproduct")
    .neq("name", name)
    .order("name")
    .limit(1000);
  const hpNames = [...new Set((halfproducts ?? []).map((r) => r.name))].join("; ");

  const kindText =
    body.kind === "halfproduct"
      ? "een halfproduct (vooraf bereid in de keuken, per batch)"
      : "een gerecht (per 1 portie)";

  const prompt = `Je bent een ervaren chef in een Nederlands horecabedrijf (strandpaviljoen/brasserie).
Stel een praktisch, gangbaar recept voor voor ${kindText}: "${name}".

Regels:
- ${body.kind === "halfproduct" ? "Geef een realistische batch zoals een horecakeuken die maakt (bv. 1–5 kg)." : "Hoeveelheden voor 1 portie."}
- Ingrediëntnamen kort en generiek in het Nederlands, zoals bij een groothandel (bv. "tarwebloem", "verse gist", "zeezout", "olijfolie").
- Gebruik waar het past een bestaand halfproduct uit deze lijst met exact dezelfde naam: ${hpNames || "(geen)"}
- Eenheden alleen: g, kg, ml, l, stuks.
- Bereiding: korte genummerde stappen.

Geef ALLEEN geldige JSON, zonder uitleg, in dit formaat:
{
  "ingredients": [{ "quantity": number, "unit": "g|kg|ml|l|stuks", "name": string }],
  "yield_quantity": number of null,
  "yield_unit": "g|kg|ml|l|stuks" of null,
  "preparation": string of null,
  "storage": string of null,
  "note": string of null
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[recipe-suggest] Claude API-fout ${response.status}: ${errText.slice(0, 300)}`);
    return NextResponse.json({ error: `Claude API-fout (${response.status}).` }, { status: 502 });
  }

  const result = await response.json();
  const text: string =
    result.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  let parsed: RecipeSuggestion;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    console.error("[recipe-suggest] Geen geldige JSON:", cleaned.slice(0, 300));
    return NextResponse.json({ error: "Claude gaf geen leesbaar voorstel. Probeer opnieuw." }, { status: 502 });
  }

  const ingredients = Array.isArray(parsed.ingredients)
    ? parsed.ingredients
        .filter((i) => i && typeof i.name === "string" && i.name.trim())
        .map((i) => ({
          quantity: Number(i.quantity) || 0,
          unit: String(i.unit ?? "").trim(),
          name: i.name.trim(),
        }))
    : [];
  if (ingredients.length === 0) {
    return NextResponse.json({ error: "Geen ingrediënten in het voorstel." }, { status: 502 });
  }

  return NextResponse.json({
    suggestion: {
      ingredients,
      yield_quantity: Number(parsed.yield_quantity) || null,
      yield_unit: parsed.yield_unit ?? null,
      preparation: parsed.preparation ?? null,
      storage: parsed.storage ?? null,
      note: parsed.note ?? null,
    } satisfies RecipeSuggestion,
  });
}

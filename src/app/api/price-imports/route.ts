import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseRawTable, suggestMapping } from "@/lib/price-import/parse";

/**
 * Leest een bestand in en geeft de kolommen + een voorstel voor de
 * koppeling terug — maakt nog geen import aan. De gebruiker bevestigt of
 * corrigeert de koppeling altijd zelf in het scherm hierna (spec §4),
 * in plaats van te vertrouwen op automatische herkenning die bij
 * onbekende kolomnamen kan mislukken.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Geen bestand ontvangen." }, { status: 400 });
  }

  let table;
  try {
    table = await parseRawTable(file);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kan bestand niet lezen." },
      { status: 400 }
    );
  }

  if (table.rows.length === 0) {
    return NextResponse.json(
      { error: "Geen bruikbare rijen gevonden in het bestand." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    originalFilename: file.name,
    headers: table.headers,
    rows: table.rows,
    suggestedMapping: suggestMapping(table.headers),
  });
}

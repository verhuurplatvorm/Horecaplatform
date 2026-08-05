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
  try {
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

    console.log(`[price-import] Upload gestart: "${file.name}" (${file.size} bytes, ${file.type || "onbekend type"})`);

    let table;
    try {
      table = await parseRawTable(file);
    } catch (err) {
      console.error(`[price-import] Kan bestand niet lezen ("${file.name}"):`, err);
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

    const mapping = suggestMapping(table.headers);
    console.log(
      `[price-import] Gelukt: ${table.headers.length} kolommen, ${table.rows.length} rijen, voorgestelde koppeling: ${JSON.stringify(mapping)}`
    );

    return NextResponse.json({
      originalFilename: file.name,
      headers: table.headers,
      rows: table.rows,
      suggestedMapping: mapping,
    });
  } catch (err) {
    // Vangt alles op wat hierboven niet al specifiek is afgehandeld (bv.
    // een probleem met de sessie, het uitlezen van de aanvraag zelf,
    // of iets onverwachts in de kolomherkenning) — zodat de gebruiker
    // altijd een duidelijke JSON-foutmelding krijgt i.p.v. een kale
    // serverfout, en de echte oorzaak in de Vercel-logs terug te vinden is.
    console.error("[price-import] Onverwachte fout in /api/price-imports:", err);
    return NextResponse.json(
      {
        error:
          "Onverwachte serverfout bij het verwerken van dit bestand. Details staan in de serverlogs (Vercel → Deployments → Logs).",
      },
      { status: 500 }
    );
  }
}

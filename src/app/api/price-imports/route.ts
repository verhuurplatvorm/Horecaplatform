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
    const supplierId = formData.get("supplierId");

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

    // Onthouden kolomkoppeling per leverancier (spec §4/§19) — als deze
    // leverancier al eerder is geïmporteerd en de kolomkoppen komen
    // grotendeels overeen met toen, gebruik die bekende koppeling i.p.v.
    // opnieuw te gokken met generieke aliassen.
    let savedMapping: Record<string, string> | null = null;
    let savedMappingSupplierName: string | null = null;
    if (typeof supplierId === "string" && supplierId) {
      const { data: template } = await supabase
        .from("supplier_import_templates")
        .select("column_mapping")
        .eq("supplier_id", supplierId)
        .maybeSingle();

      if (template) {
        const knownHeaders = Object.keys(template.column_mapping);
        const overlap = table.headers.filter((h) => knownHeaders.includes(h)).length;
        const overlapRatio = knownHeaders.length > 0 ? overlap / knownHeaders.length : 0;
        if (overlapRatio >= 0.7) {
          savedMapping = template.column_mapping;
          const { data: supplier } = await supabase
            .from("suppliers")
            .select("name")
            .eq("id", supplierId)
            .maybeSingle();
          savedMappingSupplierName = supplier?.name ?? null;
          console.log(
            `[price-import] Bekende kolomindeling toegepast voor leverancier ${supplierId} (${Math.round(overlapRatio * 100)}% kolomoverlap).`
          );
        } else {
          console.log(
            `[price-import] Sjabloon gevonden voor leverancier ${supplierId}, maar kolommen wijken te veel af (${Math.round(overlapRatio * 100)}% overlap) — generieke herkenning gebruikt.`
          );
        }
      }
    }

    return NextResponse.json({
      originalFilename: file.name,
      headers: table.headers,
      rows: table.rows,
      suggestedMapping: mapping,
      savedMapping,
      savedMappingSupplierName,
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

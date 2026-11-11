import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractEventSheet } from "@/lib/event-menus/claude-event-sheet";
import { splitQuantity } from "@/lib/event-menus/sheet-import";

// Uitlezen kan ruim een minuut duren.
export const maxDuration = 300;

/**
 * Menu's & buffetten: een evenementsheet uitlezen (PDF, of de tekst van een
 * Excel-sheet). Geeft de etenregels en kerngegevens terug; koppelen en
 * opslaan gebeurt in de reviewstap.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  const text = formData.get("text");

  try {
    let result;
    if (file instanceof File && file.name.toLowerCase().endsWith(".pdf")) {
      result = await extractEventSheet({
        pdf: Buffer.from(await file.arrayBuffer()),
      });
    } else if (typeof text === "string" && text.trim()) {
      result = await extractEventSheet({ text });
    } else {
      return NextResponse.json(
        { error: "Geen PDF of sheet ontvangen." },
        { status: 400 },
      );
    }
    const rows = result.items.map((d) => {
      const s = splitQuantity(d.name);
      return {
        section: d.section,
        name: s.name,
        quantity: s.quantity,
        unit: s.unit,
        note: d.note,
      };
    });
    return NextResponse.json({ rows, meta: result.meta });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Kan de sheet niet uitlezen.",
      },
      { status: 500 },
    );
  }
}

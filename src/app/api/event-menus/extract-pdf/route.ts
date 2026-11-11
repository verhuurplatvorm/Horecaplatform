import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractMenuFromPdf } from "@/lib/menu-import/claude-menu-ocr";
import { splitQuantity } from "@/lib/event-menus/sheet-import";

// Uitlezen van een PDF kan ruim een minuut duren.
export const maxDuration = 300;

/**
 * Menu's & buffetten: een buffet-/menusheet als PDF uitlezen (zelfde
 * uitlezer als bij menukaarten). Geeft alleen regels terug; koppelen en
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
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Geen PDF ontvangen." }, { status: 400 });
  }

  try {
    const dishes = await extractMenuFromPdf(
      Buffer.from(await file.arrayBuffer()),
    );
    const rows = dishes.map((d) => {
      const s = splitQuantity(d.name);
      return {
        section: d.section,
        name: s.name,
        quantity: s.quantity,
        unit: s.unit,
      };
    });
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Kan de PDF niet uitlezen.",
      },
      { status: 500 },
    );
  }
}

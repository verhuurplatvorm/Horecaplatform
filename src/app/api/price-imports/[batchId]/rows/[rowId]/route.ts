import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PriceImportRow } from "@/lib/types/database";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ batchId: string; rowId: string }> }
) {
  const { rowId } = await params;
  const supabase = await createClient();
  const body = await request.json();
  const productId = body?.productId;
  const packagingUnitCount = body?.packagingUnitCount;

  const update: Partial<PriceImportRow> = {};

  if (productId !== undefined) {
    if (typeof productId !== "string" || !productId) {
      return NextResponse.json(
        { error: "productId mag niet leeg zijn." },
        { status: 400 }
      );
    }
    update.matched_product_id = productId;
    update.match_method = "handmatig";
    update.status = "gematcht";
  }

  if (packagingUnitCount !== undefined) {
    const parsed = Number(packagingUnitCount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: "Verpakkingshoeveelheid moet een getal groter dan 0 zijn." },
        { status: 400 }
      );
    }
    update.packaging_unit_count = parsed;
    // Handmatig ingevoerd = al in de basiseenheid van het gekoppelde
    // product, dus geen automatische omrekening meer nodig/gewenst.
    update.packaging_unit_key = null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "Niets om bij te werken." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("price_import_rows")
    .update(update)
    .eq("id", rowId)
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: "Kan regel niet bijwerken: " + error.message },
      { status: 500 }
    );
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      {
        error:
          "De wijziging is niet doorgevoerd — je hebt hier mogelijk geen rechten voor (groepsbrede facturen kunnen alleen door een groepsbeheerder bewerkt worden), of de regel bestaat niet meer.",
      },
      { status: 403 }
    );
  }

  return NextResponse.json({ ok: true });
}

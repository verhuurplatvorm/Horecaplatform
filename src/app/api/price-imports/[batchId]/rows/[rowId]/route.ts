import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ batchId: string; rowId: string }> }
) {
  const { rowId } = await params;
  const supabase = await createClient();
  const body = await request.json();
  const productId = body?.productId;

  if (typeof productId !== "string" || !productId) {
    return NextResponse.json(
      { error: "productId is verplicht." },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("price_import_rows")
    .update({
      matched_product_id: productId,
      match_method: "handmatig" as const,
      status: "gematcht" as const,
    })
    .eq("id", rowId);

  if (error) {
    return NextResponse.json(
      { error: "Kan regel niet koppelen." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params;
  const supabase = await createClient();

  const { data: rows, error: rowsError } = await supabase
    .from("price_import_rows")
    .select("id, matched_product_id, status")
    .eq("batch_id", batchId);

  if (rowsError || !rows) {
    return NextResponse.json(
      { error: "Kan importregels niet ophalen." },
      { status: 500 }
    );
  }

  const toApply = rows.filter(
    (r) => r.matched_product_id && r.status !== "toegepast"
  );

  let applied = 0;
  const errors: string[] = [];

  for (const row of toApply) {
    const { error } = await supabase.rpc("apply_price_import_row", {
      p_row_id: row.id,
    });
    if (error) {
      errors.push(`Regel ${row.id}: ${error.message}`);
    } else {
      applied++;
    }
  }

  const { error: updateBatchError } = await supabase
    .from("price_import_batches")
    .update({
      status: (errors.length > 0 ? "mislukt" : "toegepast") as
        | "mislukt"
        | "toegepast",
      applied_rows: applied,
      error_message: errors.length > 0 ? errors.join("; ") : null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", batchId);

  if (updateBatchError) {
    return NextResponse.json(
      { error: "Regels toegepast, maar kan batchstatus niet bijwerken." },
      { status: 500 }
    );
  }

  return NextResponse.json({ applied, failed: errors.length, errors });
}

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
    .select("id, matched_product_id, status, row_number, description")
    .eq("batch_id", batchId);

  if (rowsError || !rows) {
    return NextResponse.json(
      { error: "Kan importregels niet ophalen." },
      { status: 500 }
    );
  }

  const toApply = rows.filter(
    (r) => r.matched_product_id && r.status !== "toegepast" && r.status !== "ongewijzigd"
  );

  let applied = 0;
  const errors: string[] = [];

  for (const row of toApply) {
    const { error } = await supabase.rpc("apply_price_import_row", {
      p_row_id: row.id,
    });
    if (error) {
      // Toon de bron-omschrijving en het regelnummer uit het bestand —
      // een technisch regel-ID zegt de gebruiker niets. De databasefout
      // zelf herhaalt dat ID; strip het voor de leesbaarheid.
      const label = row.description
        ? `"${row.description}" (regel ${row.row_number})`
        : `regel ${row.row_number}`;
      const cleanMessage = error.message.replace(
        /Kan regel [0-9a-f-]+ niet toepassen:\s*/i,
        ""
      );
      errors.push(`${label}: ${cleanMessage}`);
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

  // ---------------------------------------------------------------------
  // Overzicht opbouwen: gewijzigde prijzen (oud → nieuw + ingangsdatum),
  // nieuw aangemaakte producten, en regels zonder wijziging.
  // ---------------------------------------------------------------------
  const { data: reportRows } = await supabase
    .from("price_import_rows")
    .select(
      "id, description, status, match_method, matched_product_id, resulting_supplier_product_id, reopened_supplier_product_id"
    )
    .eq("batch_id", batchId);

  const allRows = reportRows ?? [];

  const productIds = [
    ...new Set(allRows.map((r) => r.matched_product_id).filter(Boolean)),
  ] as string[];
  const productNameById = new Map<string, string>();
  for (let i = 0; i < productIds.length; i += 200) {
    const { data } = await supabase
      .from("products")
      .select("id, name, custom_name")
      .in("id", productIds.slice(i, i + 200));
    for (const p of data ?? []) {
      productNameById.set(p.id, p.custom_name || p.name);
    }
  }

  const priceRowIds = [
    ...new Set(
      allRows
        .flatMap((r) => [r.resulting_supplier_product_id, r.reopened_supplier_product_id])
        .filter(Boolean)
    ),
  ] as string[];
  const priceById = new Map<string, { purchase_price: number; valid_from: string }>();
  for (let i = 0; i < priceRowIds.length; i += 200) {
    const { data } = await supabase
      .from("supplier_products")
      .select("id, purchase_price, valid_from")
      .in("id", priceRowIds.slice(i, i + 200));
    for (const sp of data ?? []) {
      priceById.set(sp.id, { purchase_price: sp.purchase_price, valid_from: sp.valid_from });
    }
  }

  const priceChanges: {
    productName: string;
    oldPrice: number | null;
    newPrice: number | null;
    validFrom: string | null;
  }[] = [];
  const newProducts: string[] = [];
  const unchanged: string[] = [];

  for (const r of allRows) {
    const name =
      (r.matched_product_id && productNameById.get(r.matched_product_id)) ||
      r.description ||
      "onbekend product";

    if (r.match_method === "automatisch_aangemaakt") {
      newProducts.push(name);
    }

    if (r.status === "ongewijzigd") {
      unchanged.push(name);
      continue;
    }

    if (r.status === "toegepast" && r.resulting_supplier_product_id) {
      const nieuw = priceById.get(r.resulting_supplier_product_id) ?? null;
      const oud = r.reopened_supplier_product_id
        ? priceById.get(r.reopened_supplier_product_id) ?? null
        : null;
      priceChanges.push({
        productName: name,
        oldPrice: oud?.purchase_price ?? null,
        newPrice: nieuw?.purchase_price ?? null,
        validFrom: nieuw?.valid_from ?? null,
      });
    }
  }

  return NextResponse.json({
    applied,
    failed: errors.length,
    errors,
    priceChanges,
    newProducts,
    unchanged,
  });
}

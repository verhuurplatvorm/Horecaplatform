import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePriceListFile } from "@/lib/price-import/parse";
import { matchRowsToProducts } from "@/lib/price-import/match";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("group_id")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return NextResponse.json(
      { error: "Geen gebruikersprofiel gevonden." },
      { status: 400 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const supplierId = formData.get("supplierId");
  const companyId = formData.get("companyId"); // optioneel, leeg = groepsbreed

  if (!(file instanceof File) || typeof supplierId !== "string" || !supplierId) {
    return NextResponse.json(
      { error: "Bestand en leverancier zijn verplicht." },
      { status: 400 }
    );
  }

  let parsedRows;
  try {
    parsedRows = await parsePriceListFile(file);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kan bestand niet lezen." },
      { status: 400 }
    );
  }

  if (parsedRows.length === 0) {
    return NextResponse.json(
      { error: "Geen bruikbare rijen gevonden in het bestand." },
      { status: 400 }
    );
  }

  // Zoek of maak de "handmatige upload"-prijsbron voor deze leverancier.
  // Zelfde pipeline als een toekomstige live koppeling zou gebruiken.
  let { data: source } = await supabase
    .from("supplier_price_sources")
    .select("id")
    .eq("supplier_id", supplierId)
    .eq("source_type", "manual_upload")
    .maybeSingle();

  if (!source) {
    const { data: created, error: createSourceError } = await supabase
      .from("supplier_price_sources")
      .insert({ supplier_id: supplierId, source_type: "manual_upload" })
      .select("id")
      .single();
    if (createSourceError || !created) {
      return NextResponse.json(
        { error: "Kan geen prijsbron aanmaken voor deze leverancier." },
        { status: 500 }
      );
    }
    source = created;
  }

  const matched = await matchRowsToProducts(
    supabase,
    profile.group_id,
    parsedRows
  );
  const matchedCount = matched.filter((r) => r.matchedProductId).length;

  const { data: batch, error: batchError } = await supabase
    .from("price_import_batches")
    .insert({
      group_id: profile.group_id,
      supplier_id: supplierId,
      price_source_id: source.id,
      company_id: typeof companyId === "string" && companyId ? companyId : null,
      status: "wacht_op_controle",
      original_filename: file.name,
      total_rows: matched.length,
      matched_rows: matchedCount,
      unmatched_rows: matched.length - matchedCount,
      imported_by: user.id,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return NextResponse.json(
      { error: "Kan importbatch niet aanmaken." },
      { status: 500 }
    );
  }

  const rowsToInsert = matched.map((row) => ({
    batch_id: batch.id,
    row_number: row.rowNumber,
    raw: row.raw,
    ean_code: row.eanCode,
    article_number: row.articleNumber,
    description: row.description,
    packaging_description: row.packagingDescription,
    packaging_unit_count: row.packagingUnitCount,
    purchase_price: row.purchasePrice,
    matched_product_id: row.matchedProductId,
    match_method: row.matchMethod,
    match_confidence: row.confidence,
    suggested_product_ids: row.suggestions.map((s) => s.id),
    status: (row.matchedProductId ? "gematcht" : "niet_gematcht") as
      | "gematcht"
      | "niet_gematcht",
  }));

  const { error: rowsError } = await supabase
    .from("price_import_rows")
    .insert(rowsToInsert);

  if (rowsError) {
    return NextResponse.json(
      { error: "Kan importregels niet opslaan." },
      { status: 500 }
    );
  }

  return NextResponse.json({ batchId: batch.id });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createImportBatch } from "@/lib/price-import/create-batch";
import { parseUblInvoice, looksLikeUbl, type ParsedInvoiceLine } from "@/lib/invoice-import/parse-ubl";
import type { ParsedPriceRow } from "@/lib/price-import/columns";

const UNIT_CODE_TO_BASE: Record<string, { factor: number }> = {
  KGM: { factor: 1000 },
  GRM: { factor: 1 },
  LTR: { factor: 1000 },
  MLT: { factor: 1 },
  C62: { factor: 1 },
  EA: { factor: 1 },
  H87: { factor: 1 },
};

function linesToRows(lines: ParsedInvoiceLine[]): ParsedPriceRow[] {
  return lines.map((line) => {
    const unitInfo = line.unit ? UNIT_CODE_TO_BASE[line.unit.toUpperCase()] : null;
    return {
      rowNumber: line.lineNumber,
      raw: line as unknown as Record<string, unknown>,
      eanCode: line.eanCode,
      articleNumber: line.articleNumber,
      description: line.description,
      brand: null,
      packagingDescription: line.unit ? `1 ${line.unit}` : null,
      packagingUnitCount: unitInfo ? unitInfo.factor : null,
      purchasePrice: line.unitPrice,
    };
  });
}

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
    return NextResponse.json({ error: "Geen gebruikersprofiel gevonden." }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const companyId = formData.get("companyId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Geen bestand ontvangen." }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  const storagePath = `${profile.group_id}/${Date.now()}-${file.name}`;
  await supabase.storage.from("facturen").upload(storagePath, buffer, {
    contentType: file.type || "application/octet-stream",
  });

  if (!name.endsWith(".xml") && !name.endsWith(".ubl")) {
    const supplierId = formData.get("supplierId");
    if (typeof supplierId !== "string" || !supplierId) {
      return NextResponse.json(
        {
          error:
            "Voor een PDF-factuur (niet automatisch leesbaar) moet je zelf de leverancier kiezen.",
          needsManualEntry: true,
          storagePath,
        },
        { status: 422 }
      );
    }

    const { data: source } = await supabase
      .from("supplier_price_sources")
      .select("id")
      .eq("supplier_id", supplierId)
      .eq("source_type", "manual_upload")
      .maybeSingle();

    let sourceId = source?.id;
    if (!sourceId) {
      const { data: created } = await supabase
        .from("supplier_price_sources")
        .insert({ supplier_id: supplierId, source_type: "manual_upload" })
        .select("id")
        .single();
      sourceId = created?.id;
    }

    const { data: batch, error: batchError } = await supabase
      .from("price_import_batches")
      .insert({
        group_id: profile.group_id,
        supplier_id: supplierId,
        price_source_id: sourceId,
        company_id: typeof companyId === "string" && companyId ? companyId : null,
        status: "wacht_op_controle",
        original_filename: file.name,
        total_rows: 0,
        matched_rows: 0,
        unmatched_rows: 0,
        imported_by: user.id,
        source_kind: "factuur",
        original_file_path: storagePath,
        error_message:
          "PDF kon niet automatisch worden uitgelezen (geen OCR beschikbaar). Origineel is bewaard; vul prijzen zo nodig handmatig in via het product.",
      })
      .select("id")
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ error: "Kan factuur niet opslaan." }, { status: 500 });
    }
    return NextResponse.json({ batchId: batch.id, autoRead: false });
  }

  const xmlText = buffer.toString("utf-8");
  if (!looksLikeUbl(xmlText)) {
    return NextResponse.json(
      { error: "Dit XML-bestand lijkt geen UBL-factuur te zijn." },
      { status: 400 }
    );
  }

  let parsed;
  try {
    parsed = parseUblInvoice(xmlText);
  } catch {
    return NextResponse.json(
      { error: "Kan deze UBL-factuur niet lezen. Controleer het bestand of voer handmatig in." },
      { status: 400 }
    );
  }

  const { data: candidates } = await supabase.rpc("match_supplier_from_invoice", {
    p_group_id: profile.group_id,
    p_vat_number: parsed.header.supplierVatNumber,
    p_kvk_number: parsed.header.supplierKvkNumber,
    p_iban: parsed.header.supplierIban,
    p_name: parsed.header.supplierName,
  });

  const confidentMatch = candidates?.find((c) =>
    ["btw_nummer", "kvk_nummer", "iban"].includes(c.match_method)
  );

  if (!confidentMatch) {
    return NextResponse.json({
      needsSupplier: true,
      header: parsed.header,
      lines: parsed.lines,
      candidates: candidates ?? [],
      storagePath,
    });
  }

  if (confidentMatch.iban_mismatch) {
    return NextResponse.json({
      needsIbanConfirmation: true,
      supplierId: confidentMatch.supplier_id,
      supplierName: confidentMatch.supplier_name,
      header: parsed.header,
      lines: parsed.lines,
      storagePath,
    });
  }

  const result = await createImportBatch(supabase, {
    groupId: profile.group_id,
    supplierId: confidentMatch.supplier_id,
    companyId: typeof companyId === "string" && companyId ? companyId : null,
    originalFilename: file.name,
    importedBy: user.id,
    parsedRows: linesToRows(parsed.lines),
    invoice: {
      invoiceNumber: parsed.header.invoiceNumber,
      invoiceDate: parsed.header.invoiceDate,
      dueDate: parsed.header.dueDate,
      supplierVatNumber: parsed.header.supplierVatNumber,
      supplierKvkNumber: parsed.header.supplierKvkNumber,
      supplierIban: parsed.header.supplierIban,
      ibanMismatch: false,
      totalInclVat: parsed.header.totalInclVat,
      originalFilePath: storagePath,
    },
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ batchId: result.batchId, autoRead: true });
}

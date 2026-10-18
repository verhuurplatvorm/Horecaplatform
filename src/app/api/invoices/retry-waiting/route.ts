import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { createImportBatch } from "@/lib/price-import/create-batch";
import { linesToRows } from "@/lib/invoice-import/lines-to-rows";
import { hasNoPrices } from "@/lib/invoice-import/no-prices";
import type { ParsedInvoiceHeader, ParsedInvoiceLine } from "@/lib/invoice-import/parse-ubl";

// Probeert alle facturen die op "Controle nodig" staan (leverancier onbekend)
// opnieuw te koppelen. Alleen zekere koppelingen (btw-, kvk-nummer, IBAN of
// bevestigde naam, zonder IBAN-afwijking) worden verwerkt, precies zoals bij
// een nieuwe mail. De rest blijft ongewijzigd staan.
export const maxDuration = 300;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  const groupId = await getCurrentGroupId(supabase);
  if (!groupId) return NextResponse.json({ error: "Kan groep niet bepalen." }, { status: 400 });

  const { data: items, error } = await supabase
    .from("inbound_invoice_queue")
    .select("*")
    .eq("group_id", groupId)
    .eq("status", "wacht_op_leverancier")
    .order("received_at", { ascending: true })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let processed = 0;
  let duplicates = 0;
  let noPrices = 0;
  let stillWaiting = 0;
  let notReadable = 0;
  let failed = 0;

  for (const item of items ?? []) {
    const header = item.parsed_header as ParsedInvoiceHeader | null;
    const lines = item.parsed_lines as ParsedInvoiceLine[] | null;
    if (!header || !lines || lines.length === 0) {
      notReadable++;
      continue;
    }
    if (hasNoPrices(lines)) {
      await supabase
        .from("inbound_invoice_queue")
        .update({ status: "afgewezen", error_message: "Dit document bevat geen prijzen (waarschijnlijk een pakbon of orderbevestiging) en is niet verwerkt.", processed_at: new Date().toISOString() })
        .eq("id", item.id);
      noPrices++;
      continue;
    }

    const { data: candidates } = await supabase.rpc("match_supplier_from_invoice", {
      p_group_id: groupId,
      p_vat_number: header.supplierVatNumber,
      p_kvk_number: header.supplierKvkNumber,
      p_iban: header.supplierIban,
      p_name: header.supplierName,
    });
    const confident = (candidates ?? []).find((c: { match_method: string }) =>
      ["btw_nummer", "kvk_nummer", "iban", "bevestigde_naam"].includes(c.match_method)
    );
    if (!confident || confident.iban_mismatch) {
      stillWaiting++;
      continue;
    }

    const { data: duplicateId } = await supabase.rpc("find_duplicate_invoice_email", {
      p_group_id: groupId,
      p_attachment_hash: item.attachment_hash,
      p_supplier_id: confident.supplier_id,
      p_invoice_number: header.invoiceNumber ?? null,
      p_total_incl_vat: header.totalInclVat ?? null,
    });
    if (duplicateId && duplicateId !== item.id) {
      await supabase
        .from("inbound_invoice_queue")
        .update({
          status: "dubbele_factuur",
          matched_supplier_id: confident.supplier_id,
          duplicate_of_queue_id: duplicateId,
          processed_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      duplicates++;
      continue;
    }

    const result = await createImportBatch(supabase, {
      groupId,
      supplierId: confident.supplier_id,
      companyId: item.company_id,
      originalFilename: item.original_filename,
      importedBy: user.id,
      parsedRows: linesToRows(lines),
      invoice: {
        invoiceNumber: header.invoiceNumber,
        invoiceDate: header.invoiceDate,
        dueDate: header.dueDate,
        supplierVatNumber: header.supplierVatNumber,
        supplierKvkNumber: header.supplierKvkNumber,
        supplierIban: header.supplierIban,
        ibanMismatch: false,
        totalInclVat: header.totalInclVat,
        originalFilePath: item.storage_path,
      },
    });
    if ("error" in result) {
      failed++;
      await supabase
        .from("inbound_invoice_queue")
        .update({ status: "fout", matched_supplier_id: confident.supplier_id, error_message: result.error, processed_at: new Date().toISOString() })
        .eq("id", item.id);
      continue;
    }
    await supabase
      .from("inbound_invoice_queue")
      .update({
        status: "verwerkt",
        matched_supplier_id: confident.supplier_id,
        resulting_batch_id: result.batchId,
        error_message: null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    processed++;
  }

  return NextResponse.json({
    checked: items?.length ?? 0,
    processed,
    duplicates,
    noPrices,
    stillWaiting,
    notReadable,
    failed,
  });
}

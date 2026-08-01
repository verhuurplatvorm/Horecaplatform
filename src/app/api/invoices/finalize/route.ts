import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createImportBatch } from "@/lib/price-import/create-batch";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import type { ParsedInvoiceHeader, ParsedInvoiceLine } from "@/lib/invoice-import/parse-ubl";
import { linesToRows } from "@/lib/invoice-import/lines-to-rows";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  }

  const body = await request.json();
  const {
    header,
    lines,
    storagePath,
    companyId,
    originalFilename,
    supplierId: existingSupplierId,
    newSupplierName,
    confirmIbanMismatch,
  } = body as {
    header: ParsedInvoiceHeader;
    lines: ParsedInvoiceLine[];
    storagePath: string | null;
    companyId: string | null;
    originalFilename: string;
    supplierId?: string;
    newSupplierName?: string;
    confirmIbanMismatch?: boolean;
  };

  const groupId = await getCurrentGroupId(supabase);
  if (!groupId) {
    return NextResponse.json({ error: "Kan groep niet bepalen." }, { status: 400 });
  }

  let supplierId = existingSupplierId ?? null;

  if (!supplierId) {
    if (!newSupplierName?.trim()) {
      return NextResponse.json(
        { error: "Kies een bestaande leverancier of geef een naam op voor een nieuwe." },
        { status: 400 }
      );
    }
    const { data: created, error: supplierError } = await supabase
      .from("suppliers")
      .insert({
        group_id: groupId,
        name: newSupplierName.trim(),
        vat_number: header.supplierVatNumber,
        kvk_number: header.supplierKvkNumber,
        iban: header.supplierIban,
        iban_verified_at: header.supplierIban ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (supplierError || !created) {
      return NextResponse.json(
        { error: "Kan leverancier niet aanmaken: " + (supplierError?.message ?? "") },
        { status: 500 }
      );
    }
    supplierId = created.id;
  }

  if (header.supplierIban && !confirmIbanMismatch) {
    const { data: supplier } = await supabase
      .from("suppliers")
      .select("iban")
      .eq("id", supplierId)
      .single();
    if (supplier?.iban && supplier.iban !== header.supplierIban) {
      return NextResponse.json(
        {
          error:
            "Het IBAN op deze factuur wijkt af van het bekende IBAN van deze leverancier. Bevestig dit expliciet voordat de factuur verwerkt wordt.",
        },
        { status: 400 }
      );
    }
  }

  if (confirmIbanMismatch && header.supplierIban) {
    await supabase
      .from("suppliers")
      .update({ iban: header.supplierIban, iban_verified_at: new Date().toISOString() })
      .eq("id", supplierId);
  }

  const result = await createImportBatch(supabase, {
    groupId,
    supplierId,
    companyId: companyId || null,
    originalFilename,
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
      originalFilePath: storagePath,
    },
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ batchId: result.batchId });
}

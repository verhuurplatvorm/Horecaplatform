import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createImportBatch } from "@/lib/price-import/create-batch";
import { parseUblInvoice, looksLikeUbl, type ParsedInvoice } from "@/lib/invoice-import/parse-ubl";
import { extractInvoiceWithClaude } from "@/lib/invoice-import/claude-ocr";

interface IncomingAttachment {
  filename: string;
  buffer: Buffer;
}

async function extractAttachments(request: Request): Promise<{
  sender: string | null;
  attachments: IncomingAttachment[];
}> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = await request.json();
    const sender = body.From ?? body.from ?? null;
    const rawAttachments = body.Attachments ?? body.attachments ?? [];
    const attachments: IncomingAttachment[] = (rawAttachments as Array<Record<string, unknown>>)
      .filter((a) => typeof a.Content === "string" || typeof a.content === "string")
      .map((a) => ({
        filename: String(a.Name ?? a.filename ?? "bijlage"),
        buffer: Buffer.from(String(a.Content ?? a.content), "base64"),
      }));
    return { sender, attachments };
  }

  const formData = await request.formData();
  const sender =
    (formData.get("sender") as string) ??
    (formData.get("from") as string) ??
    (formData.get("From") as string) ??
    null;

  const attachments: IncomingAttachment[] = [];
  for (const [, value] of formData.entries()) {
    if (value instanceof File) {
      const buffer = Buffer.from(await value.arrayBuffer());
      attachments.push({ filename: value.name, buffer });
    }
  }
  return { sender, attachments };
}

const UNIT_CODE_TO_BASE: Record<string, { factor: number }> = {
  KGM: { factor: 1000 },
  GRM: { factor: 1 },
  LTR: { factor: 1000 },
  MLT: { factor: 1 },
  C62: { factor: 1 },
  EA: { factor: 1 },
  H87: { factor: 1 },
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Niet beschikbaar." }, { status: 503 });
  }

  const { data: mailbox } = await admin
    .from("invoice_mailboxes")
    .select("*")
    .eq("webhook_token", token)
    .eq("is_active", true)
    .maybeSingle();

  if (!mailbox) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { sender, attachments } = await extractAttachments(request);
  const supported = attachments.filter((a) => {
    const n = a.filename.toLowerCase();
    return n.endsWith(".xml") || n.endsWith(".ubl") || n.endsWith(".pdf");
  });

  const results: { filename: string; outcome: string }[] = [];

  for (const attachment of supported) {
    const storagePath = `${mailbox.group_id}/${Date.now()}-${attachment.filename}`;
    await admin.storage.from("facturen").upload(storagePath, attachment.buffer, {
      contentType: attachment.filename.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : "application/xml",
    });

    const isXml =
      attachment.filename.toLowerCase().endsWith(".xml") ||
      attachment.filename.toLowerCase().endsWith(".ubl");

    let parsed: ParsedInvoice | null = null;
    let fileKind: "ubl" | "pdf" | "onbekend" = "onbekend";

    if (isXml) {
      fileKind = "ubl";
      const xmlText = attachment.buffer.toString("utf-8");
      if (looksLikeUbl(xmlText)) {
        try {
          parsed = parseUblInvoice(xmlText);
        } catch {
          parsed = null;
        }
      }
    } else if (attachment.filename.toLowerCase().endsWith(".pdf")) {
      fileKind = "pdf";
      try {
        const claudeResult = await extractInvoiceWithClaude(attachment.buffer, "application/pdf");
        if (claudeResult.lines.length > 0) parsed = claudeResult;
      } catch {
        parsed = null; // geen sleutel ingesteld, of niet leesbaar — naar het postvak
      }
    }

    if (!parsed) {
      await admin.from("inbound_invoice_queue").insert({
        group_id: mailbox.group_id,
        mailbox_id: mailbox.id,
        company_id: mailbox.company_id,
        sender_email: sender,
        original_filename: attachment.filename,
        storage_path: storagePath,
        file_kind: fileKind,
        status: "wacht_op_leverancier",
      });
      results.push({ filename: attachment.filename, outcome: `postvak_in_${fileKind}` });
      continue;
    }

    const { data: candidates } = await admin.rpc("match_supplier_from_invoice", {
      p_group_id: mailbox.group_id,
      p_vat_number: parsed.header.supplierVatNumber,
      p_kvk_number: parsed.header.supplierKvkNumber,
      p_iban: parsed.header.supplierIban,
      p_name: parsed.header.supplierName,
    });

    const confidentMatch = candidates?.find((c) =>
      ["btw_nummer", "kvk_nummer", "iban"].includes(c.match_method)
    );

    if (!confidentMatch || confidentMatch.iban_mismatch) {
      await admin.from("inbound_invoice_queue").insert({
        group_id: mailbox.group_id,
        mailbox_id: mailbox.id,
        company_id: mailbox.company_id,
        sender_email: sender,
        original_filename: attachment.filename,
        storage_path: storagePath,
        file_kind: fileKind,
        parsed_header: parsed.header,
        parsed_lines: parsed.lines,
        supplier_candidates: candidates ?? [],
        status: "wacht_op_leverancier",
      });
      results.push({
        filename: attachment.filename,
        outcome: confidentMatch ? "postvak_in_iban_afwijking" : "postvak_in_onbekende_leverancier",
      });
      continue;
    }

    const parsedRows = parsed.lines.map((line) => {
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

    const result = await createImportBatch(admin, {
      groupId: mailbox.group_id,
      supplierId: confidentMatch.supplier_id,
      companyId: mailbox.company_id,
      originalFilename: attachment.filename,
      importedBy: null as unknown as string,
      parsedRows,
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

    results.push({
      filename: attachment.filename,
      outcome: "error" in result ? "fout" : "batch_aangemaakt",
    });
  }

  return NextResponse.json({ received: attachments.length, processed: results });
}

import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createImportBatch } from "@/lib/price-import/create-batch";
import { parseUblInvoice, looksLikeUbl, type ParsedInvoice } from "@/lib/invoice-import/parse-ubl";
import { extractInvoiceWithClaude } from "@/lib/invoice-import/claude-ocr";
import { linesToRows } from "@/lib/invoice-import/lines-to-rows";

// Het uitlezen (OCR) van een lange factuur kan langer duren dan de
// standaardlimiet van een serverfunctie; een timeout zou de mail spoorloos
// op 'wordt_verwerkt' laten staan.
export const maxDuration = 300;

interface IncomingAttachment {
  filename: string;
  buffer: Buffer;
}

async function extractAttachments(request: Request): Promise<{
  sender: string | null;
  /** Volledige From-regel (naam + adres), voor de negeerlijst. */
  fromHeader: string | null;
  /** Onderwerp en (afgekapte) mailtekst, voor de negeerlijst bij doorgestuurde mail. */
  subject: string | null;
  bodyText: string | null;
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
    return {
      sender,
      fromHeader: body.From ?? body.from ?? null,
      subject: body.Subject ?? body.subject ?? null,
      bodyText: truncateText(body.TextBody ?? body.text ?? body.body ?? null),
      attachments,
    };
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
  const fromHeader =
    (formData.get("from") as string) ?? (formData.get("From") as string) ?? null;
  const subject =
    (formData.get("subject") as string) ?? (formData.get("Subject") as string) ?? null;
  const bodyText = truncateText(
    (formData.get("body-plain") as string) ??
      (formData.get("stripped-text") as string) ??
      null
  );
  return { sender, fromHeader, subject, bodyText, attachments };
}

/** Voor de negeerlijst is het begin van de mailtekst genoeg (bv. "Van: ..." in een doorgestuurd bericht). */
function truncateText(text: unknown): string | null {
  return typeof text === "string" ? text.slice(0, 20000) : null;
}

/**
 * Staat deze mail op de negeerlijst van de mailbox? Elk item is een
 * e-mailadres, domein of (deel van een) naam; vergelijking is
 * hoofdletterongevoelig en kijkt of het item voorkomt in de afzender,
 * het onderwerp of de mailtekst. Dat laatste is nodig voor doorgestuurde
 * mail: dan is de afzender de doorstuurder zelf, en staat de oorspronkelijke
 * afzender alleen in de tekst ("Van: ..."). Items korter dan 3 tekens
 * worden overgeslagen, zodat een tikfout niet ineens alle mail blokkeert.
 * Geeft het gevonden item en de plek terug, voor de reden in het statuslog.
 */
function matchIgnoredSender(
  ignored: string[] | null | undefined,
  parts: {
    sender: string | null;
    fromHeader: string | null;
    subject: string | null;
    bodyText: string | null;
  }
): { entry: string; where: string } | null {
  const places: { where: string; text: string }[] = [
    { where: "afzender", text: `${parts.fromHeader ?? ""} ${parts.sender ?? ""}`.toLowerCase() },
    { where: "onderwerp", text: (parts.subject ?? "").toLowerCase() },
    { where: "mailtekst", text: (parts.bodyText ?? "").toLowerCase() },
  ];
  for (const raw of ignored ?? []) {
    const entry = raw.trim().toLowerCase();
    if (entry.length < 3) continue;
    for (const place of places) {
      if (place.text.includes(entry)) return { entry: raw.trim(), where: place.where };
    }
  }
  return null;
}

function hashAttachment(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

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

  const { sender, fromHeader, subject, bodyText, attachments } = await extractAttachments(request);
  const ignoredMatch = matchIgnoredSender(mailbox.ignored_senders, {
    sender,
    fromHeader,
    subject,
    bodyText,
  });
  const supported = attachments.filter((a) => {
    const n = a.filename.toLowerCase();
    return n.endsWith(".xml") || n.endsWith(".ubl") || n.endsWith(".pdf");
  });

  const results: { filename: string; outcome: string }[] = [];

  // Geen enkele bruikbare bijlage (pdf/xml/ubl): de mail wordt toch gelogd,
  // zodat hij in het statusoverzicht onder 'Afgewezen' staat met de reden,
  // in plaats van spoorloos te verdwijnen.
  if (supported.length === 0) {
    const others = attachments.map((a) => a.filename);
    const reason = ignoredMatch
      ? `Staat op de negeerlijst: "${ignoredMatch.entry}" gevonden in ${ignoredMatch.where}. Geen pdf- of xml-bijlage.`
      : others.length === 0
        ? "Geen bijlage in deze e-mail."
        : `Geen pdf- of xml-bijlage; alleen: ${others.slice(0, 5).join(", ")}${others.length > 5 ? " …" : ""}.`;
    await admin.from("inbound_invoice_queue").insert({
      group_id: mailbox.group_id,
      mailbox_id: mailbox.id,
      company_id: mailbox.company_id,
      sender_email: sender ?? fromHeader,
      original_filename: subject?.trim() ? `(mail) ${subject.trim().slice(0, 120)}` : "(mail zonder bijlage)",
      storage_path: "",
      file_kind: "onbekend",
      status: "afgewezen",
      error_message: reason,
      processed_at: new Date().toISOString(),
    });
    return NextResponse.json({
      received: attachments.length,
      processed: [{ filename: "(geen bruikbare bijlage)", outcome: "afgewezen_geen_bijlage" }],
    });
  }

  for (const attachment of supported) {
    const attachmentHash = hashAttachment(attachment.buffer);

    // Afzender op de negeerlijst: wel loggen (zichtbaar onder 'Afgewezen'),
    // maar niet opslaan, niet inlezen en geen batch aanmaken.
    if (ignoredMatch) {
      await admin.from("inbound_invoice_queue").insert({
        group_id: mailbox.group_id,
        mailbox_id: mailbox.id,
        company_id: mailbox.company_id,
        sender_email: sender ?? fromHeader,
        original_filename: attachment.filename,
        storage_path: "",
        file_kind: "onbekend",
        attachment_hash: attachmentHash,
        status: "afgewezen",
        error_message: `Staat op de negeerlijst: "${ignoredMatch.entry}" gevonden in ${ignoredMatch.where}.`,
        processed_at: new Date().toISOString(),
      });
      results.push({ filename: attachment.filename, outcome: "genegeerd_afzender" });
      continue;
    }

    // Elk binnenkomend bericht wordt ONMIDDELLIJK gelogd, nog vóór het
    // verwerkt wordt — zo blijft een crash halverwege de verwerking
    // zichtbaar als status 'wordt_verwerkt' in het statusoverzicht,
    // i.p.v. spoorloos te verdwijnen (spec: statusoverzicht moet élke
    // binnengekomen e-mail laten zien, niet alleen de afwijkingen).
    const { data: logRow } = await admin
      .from("inbound_invoice_queue")
      .insert({
        group_id: mailbox.group_id,
        mailbox_id: mailbox.id,
        company_id: mailbox.company_id,
        sender_email: sender,
        original_filename: attachment.filename,
        storage_path: "",
        file_kind: "onbekend",
        attachment_hash: attachmentHash,
        status: "wordt_verwerkt",
      })
      .select("id")
      .single();
    const logId = logRow?.id as string | undefined;

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
    let parseError: string | null = null;

    if (isXml) {
      fileKind = "ubl";
      const xmlText = attachment.buffer.toString("utf-8");
      if (looksLikeUbl(xmlText)) {
        try {
          parsed = parseUblInvoice(xmlText);
        } catch (err) {
          parsed = null;
          parseError = err instanceof Error ? err.message : "UBL-bestand kon niet gelezen worden.";
        }
      }
    } else if (attachment.filename.toLowerCase().endsWith(".pdf")) {
      fileKind = "pdf";
      try {
        const claudeResult = await extractInvoiceWithClaude(attachment.buffer, "application/pdf");
        if (claudeResult.lines.length > 0) parsed = claudeResult;
      } catch (err) {
        parsed = null; // geen sleutel ingesteld, of niet leesbaar — naar het postvak
        parseError = err instanceof Error ? err.message : "PDF kon niet automatisch gelezen worden.";
      }
    }

    // Vóór er iets aangemaakt wordt: is dit dezelfde factuur die al eens
    // via de mailbox is binnengekomen? Zelfde bijlage-inhoud, of zelfde
    // leverancier+factuurnummer+totaalbedrag. Dit voorkomt dat een per
    // ongeluk dubbel gemailde factuur twee keer verwerkt wordt.
    let matchedSupplierIdForDupeCheck: string | null = null;
    if (parsed) {
      const { data: candidatesForDupe } = await admin.rpc("match_supplier_from_invoice", {
        p_group_id: mailbox.group_id,
        p_vat_number: parsed.header.supplierVatNumber,
        p_kvk_number: parsed.header.supplierKvkNumber,
        p_iban: parsed.header.supplierIban,
        p_name: parsed.header.supplierName,
      });
      matchedSupplierIdForDupeCheck =
        candidatesForDupe?.find((c) => ["btw_nummer", "kvk_nummer", "iban"].includes(c.match_method))
          ?.supplier_id ?? null;
    }

    const { data: duplicateId } = await admin.rpc("find_duplicate_invoice_email", {
      p_group_id: mailbox.group_id,
      p_attachment_hash: attachmentHash,
      p_supplier_id: matchedSupplierIdForDupeCheck,
      p_invoice_number: parsed?.header.invoiceNumber ?? null,
      p_total_incl_vat: parsed?.header.totalInclVat ?? null,
    });

    if (duplicateId && duplicateId !== logId) {
      if (logId) {
        await admin
          .from("inbound_invoice_queue")
          .update({
            status: "dubbele_factuur",
            storage_path: storagePath,
            file_kind: fileKind,
            invoice_number: parsed?.header.invoiceNumber ?? null,
            total_incl_vat: parsed?.header.totalInclVat ?? null,
            matched_supplier_id: matchedSupplierIdForDupeCheck,
            duplicate_of_queue_id: duplicateId,
            processed_at: new Date().toISOString(),
          })
          .eq("id", logId);
      }
      results.push({ filename: attachment.filename, outcome: "dubbele_factuur" });
      continue;
    }

    if (!parsed) {
      if (logId) {
        await admin
          .from("inbound_invoice_queue")
          .update({
            status: parseError ? "fout" : "wacht_op_leverancier",
            storage_path: storagePath,
            file_kind: fileKind,
            error_message: parseError,
            processed_at: new Date().toISOString(),
          })
          .eq("id", logId);
      }
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
      if (logId) {
        await admin
          .from("inbound_invoice_queue")
          .update({
            status: "wacht_op_leverancier",
            storage_path: storagePath,
            file_kind: fileKind,
            parsed_header: parsed.header,
            parsed_lines: parsed.lines,
            supplier_candidates: candidates ?? [],
            invoice_number: parsed.header.invoiceNumber,
            total_incl_vat: parsed.header.totalInclVat,
            matched_supplier_id: confidentMatch?.supplier_id ?? null,
            processed_at: new Date().toISOString(),
          })
          .eq("id", logId);
      }
      results.push({
        filename: attachment.filename,
        outcome: confidentMatch ? "postvak_in_iban_afwijking" : "postvak_in_onbekende_leverancier",
      });
      continue;
    }

    const parsedRows = linesToRows(parsed.lines);

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

    if (logId) {
      await admin
        .from("inbound_invoice_queue")
        .update({
          status: "error" in result ? "fout" : "verwerkt",
          storage_path: storagePath,
          file_kind: fileKind,
          invoice_number: parsed.header.invoiceNumber,
          total_incl_vat: parsed.header.totalInclVat,
          matched_supplier_id: confidentMatch.supplier_id,
          resulting_batch_id: "error" in result ? null : result.batchId,
          error_message: "error" in result ? result.error : null,
          processed_at: new Date().toISOString(),
        })
        .eq("id", logId);
    }

    results.push({
      filename: attachment.filename,
      outcome: "error" in result ? "fout" : "batch_aangemaakt",
    });
  }

  return NextResponse.json({ received: attachments.length, processed: results });
}

import { XMLParser } from "fast-xml-parser";

export interface ParsedInvoiceHeader {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  supplierName: string | null;
  supplierVatNumber: string | null;
  supplierKvkNumber: string | null;
  supplierIban: string | null;
  currency: string | null;
  subtotalExclVat: number | null;
  totalInclVat: number | null;
}

export interface ParsedInvoiceLine {
  lineNumber: number;
  eanCode: string | null;
  articleNumber: string | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  lineTotalExclVat: number | null;
}

export interface ParsedInvoice {
  header: ParsedInvoiceHeader;
  lines: ParsedInvoiceLine[];
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n =
    typeof v === "object" && v !== null && "#text" in (v as object)
      ? Number((v as { "#text": unknown })["#text"])
      : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v !== null && "#text" in (v as object)) {
    return String((v as { "#text": unknown })["#text"]).trim() || null;
  }
  const s = String(v).trim();
  return s || null;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Ontleedt een UBL 2.1-factuur (het EU-standaardformaat voor
 * e-facturen). Namespace-voorvoegsels (cbc:/cac:) worden genegeerd zodat
 * kleine verschillen tussen leveranciers-XML-generators niet meteen
 * alles breken. Gebruikt geen OCR — dit is al gestructureerde data.
 */
export function parseUblInvoice(xml: string): ParsedInvoice {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    textNodeName: "#text",
  });

  const doc = parser.parse(xml);
  const invoice = doc.Invoice ?? doc.CreditNote ?? doc;

  const supplierParty = invoice.AccountingSupplierParty?.Party ?? {};
  const partyLegalEntity = supplierParty.PartyLegalEntity ?? {};
  const partyTaxScheme = asArray(supplierParty.PartyTaxScheme)[0] ?? {};
  const contact = supplierParty.PartyName ?? {};

  const supplierName =
    toText(partyLegalEntity.RegistrationName) ?? toText(contact.Name) ?? null;
  const supplierVatNumber =
    toText(partyTaxScheme.CompanyID) ?? toText(supplierParty.EndpointID) ?? null;
  const supplierKvkNumber = toText(partyLegalEntity.CompanyID) ?? null;

  const paymentMeans = asArray(invoice.PaymentMeans)[0] ?? {};
  const supplierIban = toText(paymentMeans.PayeeFinancialAccount?.ID) ?? null;

  const monetaryTotal = invoice.LegalMonetaryTotal ?? {};

  const header: ParsedInvoiceHeader = {
    invoiceNumber: toText(invoice.ID),
    invoiceDate: toText(invoice.IssueDate),
    dueDate: toText(invoice.DueDate),
    supplierName,
    supplierVatNumber,
    supplierKvkNumber,
    supplierIban,
    currency: toText(invoice.DocumentCurrencyCode) ?? "EUR",
    subtotalExclVat: toNumber(monetaryTotal.TaxExclusiveAmount),
    totalInclVat: toNumber(monetaryTotal.TaxInclusiveAmount),
  };

  const rawLines = asArray(invoice.InvoiceLine ?? invoice.CreditNoteLine);
  const lines: ParsedInvoiceLine[] = rawLines.map((line, idx) => {
    const item = line.Item ?? {};
    const sellersId = item.SellersItemIdentification?.ID;
    const standardId = item.StandardItemIdentification?.ID;
    const quantityNode = line.InvoicedQuantity ?? line.CreditedQuantity ?? {};
    const price = line.Price ?? {};

    return {
      lineNumber: idx + 1,
      eanCode: toText(standardId),
      articleNumber: toText(sellersId),
      description: toText(item.Name) ?? toText(item.Description),
      quantity: toNumber(quantityNode),
      unit:
        typeof quantityNode === "object" && quantityNode !== null
          ? ((quantityNode as Record<string, unknown>)["@_unitCode"]?.toString() ?? null)
          : null,
      unitPrice: toNumber(price.PriceAmount),
      lineTotalExclVat: toNumber(line.LineExtensionAmount),
    };
  });

  return { header, lines };
}

/** Herkent of een bestand er als UBL/XML-factuur uitziet, zonder al
 * volledig te parsen (snelle check voor de upload-flow). */
export function looksLikeUbl(text: string): boolean {
  return /<(?:\w+:)?Invoice[\s>]/.test(text) || /<(?:\w+:)?CreditNote[\s>]/.test(text);
}

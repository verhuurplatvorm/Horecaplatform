import { Workbook, type CellValue } from "exceljs";
import Papa from "papaparse";
import { buildHeaderMap, normalizeRow, type ParsedPriceRow } from "./columns";

/**
 * Leest een geüploade prijslijst (CSV of Excel) en zet 'm om naar
 * genormaliseerde rijen. Server-only (ExcelJS/Papaparse draaien hier op
 * de Node-runtime, niet in de browser).
 */
export async function parsePriceListFile(
  file: File
): Promise<ParsedPriceRow[]> {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".csv")) {
    return parseCsv(buffer.toString("utf-8"));
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return parseExcel(buffer);
  }
  throw new Error(
    "Onbekend bestandstype. Upload een .csv, .xlsx of .xls bestand."
  );
}

function parseCsv(text: string): ParsedPriceRow[] {
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(
      `Kan CSV niet lezen: ${result.errors[0]?.message ?? "onbekende fout"}`
    );
  }

  const headers = result.meta.fields ?? [];
  const headerMap = buildHeaderMap(headers);
  assertHasUsableColumns(headerMap);

  return result.data.map((raw, i) => normalizeRow(i + 2, raw, headerMap));
  // +2: rij 1 is de header, data begint dus op rij 2 voor de gebruiker
}

async function parseExcel(buffer: Buffer): Promise<ParsedPriceRow[]> {
  const workbook = new Workbook();
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  // exceljs declares its own ambient `Buffer extends ArrayBuffer` shim that
  // collides with @types/node's generic Buffer<ArrayBufferLike>; passing a
  // plain ArrayBuffer sidesteps the mismatch entirely.
  await workbook.xlsx.load(arrayBuffer as unknown as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Het Excel-bestand bevat geen werkblad.");

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

  const headerMap = buildHeaderMap(headers.filter(Boolean));
  assertHasUsableColumns(headerMap);

  const rows: ParsedPriceRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const raw: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) raw[header] = cellValue(cell.value);
    });
    if (Object.keys(raw).length === 0) return; // lege rij overslaan
    rows.push(normalizeRow(rowNumber, raw, headerMap));
  });

  return rows;
}

function cellValue(value: CellValue): unknown {
  if (value && typeof value === "object" && "text" in value) {
    return (value as { text: string }).text;
  }
  if (value && typeof value === "object" && "result" in value) {
    return (value as { result: unknown }).result;
  }
  return value;
}

function assertHasUsableColumns(headerMap: Map<string, string>) {
  const canonicalFields = new Set(headerMap.values());
  const hasIdentifier =
    canonicalFields.has("ean") || canonicalFields.has("articleNumber");
  const hasPrice = canonicalFields.has("purchasePrice");

  if (!hasIdentifier || !hasPrice) {
    throw new Error(
      "Kan de kolommen niet herkennen. Zorg voor minimaal een kolom met EAN-code of artikelnummer, en een kolom met de prijs."
    );
  }
}

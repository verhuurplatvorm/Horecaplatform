import { Workbook, type CellValue } from "exceljs";
import Papa from "papaparse";
import { buildHeaderMap, buildHeaderMapFromMapping, normalizeRow, type ParsedPriceRow } from "./columns";

export interface RawTable {
  headers: string[];
  /** Ruwe rijen op originele kolomnaam, met het 1-gebaseerde rijnummer
   * (rij 1 = header) zodat foutmeldingen aansluiten op wat de gebruiker
   * in het bestand ziet. */
  rows: { rowNumber: number; raw: Record<string, unknown> }[];
}

/**
 * Leest een bestand of geplakte tabel in tot ruwe kolommen + rijen, zonder
 * al te proberen kolommen te herkennen. Server-only.
 */
export async function parseRawTable(file: File): Promise<RawTable> {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".csv")) {
    return parseCsvRaw(buffer.toString("utf-8"));
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return parseExcelRaw(buffer);
  }
  throw new Error(
    "Onbekend bestandstype. Upload een .csv, .xlsx of .xls bestand."
  );
}

function parseCsvRaw(text: string): RawTable {
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(
      `Kan bestand niet lezen: ${result.errors[0]?.message ?? "onbekende fout"}`
    );
  }

  const headers = (result.meta.fields ?? []).filter(Boolean);
  if (headers.length === 0) {
    throw new Error(
      "Geen kolomkoppen gevonden. Zorg dat de eerste rij de kolomnamen bevat."
    );
  }

  return {
    headers,
    rows: result.data.map((raw, i) => ({ rowNumber: i + 2, raw })),
  };
}

async function parseExcelRaw(buffer: Buffer): Promise<RawTable> {
  const workbook = new Workbook();
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  // exceljs declares its own ambient `Buffer extends ArrayBuffer` shim die
  // botst met @types/node's generic Buffer<ArrayBufferLike>; een gewone
  // ArrayBuffer omzeilt die mismatch volledig.
  await workbook.xlsx.load(arrayBuffer as unknown as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Het Excel-bestand bevat geen werkblad.");

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

  const cleanHeaders = headers.filter(Boolean);
  if (cleanHeaders.length === 0) {
    throw new Error(
      "Geen kolomkoppen gevonden. Zorg dat de eerste rij de kolomnamen bevat."
    );
  }

  const rows: { rowNumber: number; raw: Record<string, unknown> }[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const raw: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) raw[header] = cellValue(cell.value);
    });
    if (Object.keys(raw).length === 0) return;
    rows.push({ rowNumber, raw });
  });

  return { headers: cleanHeaders, rows };
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

/** Suggereert een kolomkoppeling op basis van de bekende aliassen —
 * gebruikt als startpunt in het koppelscherm, nooit blind toegepast. */
export function suggestMapping(headers: string[]): Record<string, string> {
  const headerMap = buildHeaderMap(headers);
  const mapping: Record<string, string> = {};
  for (const h of headers) mapping[h] = headerMap.get(h) ?? "ignore";
  return mapping;
}

/** Past een door de gebruiker bevestigde kolomkoppeling toe op een ruwe
 * tabel en levert genormaliseerde rijen op, klaar voor matching. */
export function applyMapping(
  table: RawTable,
  mapping: Record<string, string>
): ParsedPriceRow[] {
  const headerMap = buildHeaderMapFromMapping(mapping);
  return table.rows.map((r) => normalizeRow(r.rowNumber, r.raw, headerMap));
}

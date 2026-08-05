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
  if (name.endsWith(".pdf")) {
    return parsePdfRaw(buffer);
  }
  throw new Error(
    "Onbekend bestandstype. Upload een .csv, .xlsx, .xls of (tekst-)pdf bestand."
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

  if (workbook.worksheets.length === 0) {
    throw new Error("Het Excel-bestand bevat geen werkblad.");
  }

  // Sommige bestanden hebben eerst een voorblad/instructietabblad; kies
  // het tabblad met de meeste gevulde rijen i.p.v. blind het eerste te
  // pakken.
  let bestSheet = workbook.worksheets[0];
  let bestRowCount = -1;
  for (const ws of workbook.worksheets) {
    if (ws.rowCount > bestRowCount) {
      bestRowCount = ws.rowCount;
      bestSheet = ws;
    }
  }
  const sheet = bestSheet;

  // De kolomkoppen staan niet altijd op rij 1 (soms staat er eerst een
  // titel of lege rij boven de tabel). Zoek in de eerste 10 rijen naar de
  // rij met de meeste gevulde tekstcellen — dat is vrijwel altijd de
  // echte headerrij.
  let headerRowNumber = 1;
  let headerCellCount = -1;
  const scanLimit = Math.min(10, sheet.rowCount || 10);
  for (let r = 1; r <= scanLimit; r++) {
    const row = sheet.getRow(r);
    let filled = 0;
    row.eachCell({ includeEmpty: false }, () => filled++);
    if (filled > headerCellCount) {
      headerCellCount = filled;
      headerRowNumber = r;
    }
  }

  const headerRow = sheet.getRow(headerRowNumber);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cellValue(cell.value) ?? "").trim();
  });

  const cleanHeaders = headers.filter(Boolean);
  if (cleanHeaders.length === 0) {
    throw new Error(
      `Geen kolomkoppen gevonden op tabblad "${sheet.name}". Zorg dat er ergens een rij met kolomnamen staat (bv. Artikel, Prijs).`
    );
  }

  const rows: { rowNumber: number; raw: Record<string, unknown> }[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const raw: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) raw[header] = cellValue(cell.value);
    });
    if (Object.keys(raw).length === 0) return;
    rows.push({ rowNumber, raw });
  });

  if (rows.length === 0) {
    throw new Error(
      `Kolomkoppen gevonden op tabblad "${sheet.name}" (${cleanHeaders.join(", ")}), maar geen rijen daaronder met gegevens. Controleer of de tabel op het juiste tabblad staat en niet leeg is.`
    );
  }

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

/**
 * Leest een tekst-PDF (geen scan/foto) uit tot een tabel. Gebruikt eerst
 * de ingebouwde tabelherkenning van pdf-parse (betrouwbaarder dan zelf
 * op spaties gokken); valt terug op een eenvoudige kolom-uit-spaties-
 * heuristiek als er geen tabel herkend wordt. Werkt niet voor gescande
 * PDF's of foto's (die bevatten geen echte tekst, alleen een plaatje) —
 * daarvoor is een OCR-dienst nodig, wat hier bewust niet wordt
 * gesimuleerd.
 */
async function parsePdfRaw(buffer: Buffer): Promise<RawTable> {
  // Bewust een dynamische import i.p.v. bovenaan het bestand: pdf-parse
  // (via pdfjs-dist) verwacht een paar browser-only globals die op de
  // server niet bestaan. Als dit statisch bovenaan stond, crashte ZELFS
  // een Excel- of CSV-import — dit bestand werd dan al bij het laden
  // onbruikbaar, voor alle bestandstypen. Nu wordt pdf-parse pas geladen
  // op het moment dat er daadwerkelijk een PDF verwerkt wordt.
  if (typeof (globalThis as Record<string, unknown>).DOMMatrix === "undefined") {
    // Minimale polyfill — pdfjs-dist gebruikt dit alleen voor
    // paginatransformaties bij het lezen van tekst/tabellen, niet voor
    // daadwerkelijk renderen, dus een lege constructor volstaat hier.
    (globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix {};
  }

  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const tableResult = await parser.getTable();
    const bestTable = tableResult.mergedTables?.[0] ?? tableResult.pages[0]?.tables?.[0];

    if (bestTable && bestTable.length >= 2) {
      const headers = bestTable[0].map((h) => h.trim()).filter(Boolean);
      if (headers.length >= 2) {
        const rows: { rowNumber: number; raw: Record<string, unknown> }[] = [];
        for (let i = 1; i < bestTable.length; i++) {
          const cells = bestTable[i];
          if (!cells.some((c) => c && c.trim())) continue;
          const raw: Record<string, unknown> = {};
          headers.forEach((h, idx) => {
            if (cells[idx] !== undefined) raw[h] = cells[idx];
          });
          rows.push({ rowNumber: i + 1, raw });
        }
        if (rows.length > 0) return { headers, rows };
      }
    }

    // Geen tabel herkend — terugvallen op tekst + kolommen-uit-spaties.
    const textResult = await parser.getText();
    return parseTextAsTable(textResult.text);
  } finally {
    await parser.destroy();
  }
}

function parseTextAsTable(text: string): RawTable {
  const rawLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    throw new Error(
      "Geen tekst gevonden in deze PDF. Waarschijnlijk is dit een scan of foto zonder herkenbare tekst — gebruik in dat geval Excel, CSV, of kopiëren en plakken."
    );
  }

  const splitLine = (line: string) =>
    line.split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean);

  // Zoek in de eerste 20 regels de regel met de meeste kolommen — dat is
  // vermoedelijk de kopregel.
  let headerIndex = 0;
  let headerCellCount = -1;
  const scanLimit = Math.min(20, rawLines.length);
  for (let i = 0; i < scanLimit; i++) {
    const cells = splitLine(rawLines[i]);
    if (cells.length > headerCellCount) {
      headerCellCount = cells.length;
      headerIndex = i;
    }
  }

  const headers = splitLine(rawLines[headerIndex]);
  if (headers.length < 2) {
    throw new Error(
      "Kan geen kolomstructuur herkennen in deze PDF. Tekst-PDF's met nette kolomuitlijning werken het best — gebruik anders Excel, CSV, of kopiëren en plakken."
    );
  }

  const rows: { rowNumber: number; raw: Record<string, unknown> }[] = [];
  for (let i = headerIndex + 1; i < rawLines.length; i++) {
    const cells = splitLine(rawLines[i]);
    if (cells.length < 2) continue;
    const raw: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (cells[idx] !== undefined) raw[h] = cells[idx];
    });
    if (Object.keys(raw).length === 0) continue;
    rows.push({ rowNumber: i + 1, raw });
  }

  if (rows.length === 0) {
    throw new Error(
      "Kopregel gevonden, maar geen bruikbare rijen daaronder. Deze PDF is mogelijk een scan/foto, of de kolomuitlijning is te onregelmatig — gebruik in dat geval Excel, CSV, of kopiëren en plakken."
    );
  }

  return { headers, rows };
}

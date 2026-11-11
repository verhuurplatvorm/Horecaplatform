"use client";

import { createPortal } from "react-dom";
import { formatDateNL, type StickerType } from "@/lib/stickers/stickers";

export const STICKER_FORMATS: {
  value: string;
  label: string;
  widthMm: number;
  heightMm: number;
}[] = [
  {
    value: "60x30mm",
    label: "60 × 30 mm (standaard)",
    widthMm: 60,
    heightMm: 30,
  },
  { value: "50x30mm", label: "50 × 30 mm", widthMm: 50, heightMm: 30 },
  { value: "62x29mm", label: "62 × 29 mm", widthMm: 62, heightMm: 29 },
  { value: "57x32mm", label: "57 × 32 mm", widthMm: 57, heightMm: 32 },
  { value: "62x50mm", label: "62 × 50 mm", widthMm: 62, heightMm: 50 },
  { value: "102x51mm", label: "102 × 51 mm", widthMm: 102, heightMm: 51 },
  { value: "62x100mm", label: "62 × 100 mm", widthMm: 62, heightMm: 100 },
];

const FORMAT_KEY = "sticker:formaat";

export function readStickerFormat(): string {
  try {
    const v = window.localStorage.getItem(FORMAT_KEY);
    if (v && STICKER_FORMATS.some((f) => f.value === v)) return v;
  } catch {
    /* geen opslag */
  }
  return STICKER_FORMATS[0].value;
}

export function writeStickerFormat(v: string) {
  try {
    window.localStorage.setItem(FORMAT_KEY, v);
  } catch {
    /* geen opslag */
  }
}

export function findFormat(value: string | null | undefined) {
  return STICKER_FORMATS.find((f) => f.value === value) ?? STICKER_FORMATS[0];
}

export interface StickerLabelData {
  type: StickerType;
  productName: string;
  productionDate: string;
  productionTime?: string | null;
  expiryDate?: string | null;
  storageTemp?: string | null;
  employeeName: string;
  companyName: string;
  batchNumber?: string | null;
  quantity?: string | null;
  note?: string | null;
}

const TITLE_PREFIX: Record<StickerType, string> = {
  productie: "",
  vers: "VERS – ",
  diepvries: "DIEPVRIES – ",
};

/** Eén sticker, op ware grootte in millimeters. */
export function StickerLabel({
  data,
  format,
  className,
}: {
  data: StickerLabelData;
  format: string;
  className?: string;
}) {
  const f = findFormat(format);
  const small = f.heightMm <= 32;
  const base = small ? 7 : 9;
  const extra = [data.batchNumber && `Batch ${data.batchNumber}`, data.quantity]
    .filter(Boolean)
    .join(" · ");
  const time = data.productionTime ? ` ${data.productionTime.slice(0, 5)}` : "";

  return (
    <div
      className={`sticker-label flex flex-col justify-center overflow-hidden bg-white text-black ${className ?? ""}`}
      style={{
        width: `${f.widthMm}mm`,
        height: `${f.heightMm}mm`,
        padding: small ? "1.5mm 2mm" : "3mm",
        fontSize: `${base}pt`,
        lineHeight: 1.2,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <p
        className="line-clamp-2 font-extrabold uppercase"
        style={{
          fontSize: `${base + (small ? 3 : 5)}pt`,
          lineHeight: 1.05,
          marginBottom: "0.8mm",
        }}
      >
        {TITLE_PREFIX[data.type]}
        {data.productName}
      </p>
      {data.type === "diepvries" ? (
        <>
          <p>
            Ingevroren: {formatDateNL(data.productionDate)}
            {time}
          </p>
          <p className="font-extrabold" style={{ fontSize: `${base + 2}pt` }}>
            THT: {formatDateNL(data.expiryDate)}
          </p>
          <p>Bewaren bij: {data.storageTemp || "-18 °C of kouder"}</p>
        </>
      ) : (
        <>
          <p>
            Productiedatum: {formatDateNL(data.productionDate)}
            {time}
          </p>
          {data.type === "vers" && (
            <p className="font-extrabold" style={{ fontSize: `${base + 2}pt` }}>
              Te gebruiken tot: {formatDateNL(data.expiryDate)}
            </p>
          )}
          {data.storageTemp && <p>Bewaren bij: {data.storageTemp}</p>}
        </>
      )}
      {extra && <p className="truncate">{extra}</p>}
      {data.note && <p className="truncate italic">{data.note}</p>}
      <p className="truncate">Medewerker: {data.employeeName}</p>
      <p className="truncate font-semibold">{data.companyName}</p>
    </div>
  );
}

/**
 * Wat er werkelijk geprint wordt (alleen zichtbaar bij afdrukken).
 * Eén sticker per pagina, paginaformaat = stickerformaat.
 */
export function StickerPrintArea({
  data,
  format,
  count,
}: {
  data: StickerLabelData | null;
  format: string;
  count: number;
}) {
  const f = findFormat(format);
  if (!data || typeof document === "undefined") return null;
  // Via een portal direct in <body>, zodat de sticker ook vanuit een
  // pop-up linksboven op de pagina wordt geprint.
  return createPortal(
    <>
      <div className="sticker-print-area hidden print:block">
        {Array.from({ length: Math.max(1, count) }).map((_, i) => (
          <div key={i} className="sticker-print-page">
            <StickerLabel data={data} format={format} />
          </div>
        ))}
      </div>
      <style>{`
        @media print {
          @page { size: ${f.widthMm}mm ${f.heightMm}mm; margin: 0; }
          html, body { background: #fff !important; }
          body * { visibility: hidden; }
          .sticker-print-area, .sticker-print-area * { visibility: visible; }
          .sticker-print-area { position: absolute; left: 0; top: 0; }
          .sticker-print-page { break-after: page; page-break-after: always; }
          .sticker-print-page:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
    </>,
    document.body,
  );
}

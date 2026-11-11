"use client";

import { useLayoutEffect, useRef } from "react";
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
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const name = `${TITLE_PREFIX[data.type]}${data.productName}`;
  const time = data.productionTime ? ` ${data.productionTime.slice(0, 5)}` : "";
  const extra = [data.batchNumber && `Batch ${data.batchNumber}`, data.quantity]
    .filter(Boolean)
    .join(" · ");

  // Tekst zo groot mogelijk: alle maten zijn in em, hier zoeken we de
  // grootste basisgrootte waarbij alles nog op de sticker past.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const cs = getComputedStyle(box);
    const availW =
      box.clientWidth -
      parseFloat(cs.paddingLeft) -
      parseFloat(cs.paddingRight);
    const availH =
      box.clientHeight -
      parseFloat(cs.paddingTop) -
      parseFloat(cs.paddingBottom);
    if (availW <= 0 || availH <= 0) return;
    const fits = () =>
      inner.scrollWidth <= availW + 0.5 && inner.offsetHeight <= availH + 0.5;
    let lo = 4;
    let hi = 40;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      box.style.fontSize = `${mid}pt`;
      if (fits()) lo = mid;
      else hi = mid;
    }
    box.style.fontSize = `${lo}pt`;
  });

  /** Klein label + grote vette datum op één regel. */
  const dateLine = (
    label: string,
    date: string | null | undefined,
    size: number,
  ) => (
    <p className="whitespace-nowrap" style={{ lineHeight: 1.05 }}>
      <span>{label} </span>
      <span className="font-extrabold" style={{ fontSize: `${size}em` }}>
        {formatDateNL(date)}
      </span>
      {time && label !== "THT" && label !== "Te gebruiken tot" && (
        <span>{time}</span>
      )}
    </p>
  );

  return (
    <div
      ref={boxRef}
      className={`sticker-label flex flex-col justify-center overflow-hidden bg-white text-black ${className ?? ""}`}
      style={{
        width: `${f.widthMm}mm`,
        height: `${f.heightMm}mm`,
        padding: "1.5mm 2mm",
        fontSize: "8pt",
        lineHeight: 1.1,
        fontFamily: "Arial, Helvetica, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div
        ref={innerRef}
        className="flex flex-col"
        style={{ gap: "0.15em" }}
      >
        <p
          className="font-extrabold uppercase"
          style={{
            fontSize: "1.75em",
            lineHeight: 1.0,
            overflowWrap: "anywhere",
          }}
        >
          {name}
        </p>
        {data.type === "diepvries" ? (
          <>
            {dateLine("Ingevroren", data.productionDate, 1.25)}
            {dateLine("THT", data.expiryDate, 1.75)}
            <p className="whitespace-nowrap">
              Bewaren bij: {data.storageTemp || "-18 °C of kouder"}
            </p>
          </>
        ) : data.type === "vers" ? (
          <>
            {dateLine("Productiedatum", data.productionDate, 1.25)}
            {dateLine("Te gebruiken tot", data.expiryDate, 1.75)}
            {data.storageTemp && (
              <p className="whitespace-nowrap">
                Bewaren bij: {data.storageTemp}
              </p>
            )}
          </>
        ) : (
          <>
            {dateLine("Productiedatum", data.productionDate, 1.75)}
            {data.storageTemp && (
              <p className="whitespace-nowrap">
                Bewaren bij: {data.storageTemp}
              </p>
            )}
          </>
        )}
        {extra && <p className="whitespace-nowrap">{extra}</p>}
        {data.note && <p className="whitespace-nowrap italic">{data.note}</p>}
        <p className="whitespace-nowrap">
          {data.employeeName}{" "}
          <span className="font-bold">· {data.companyName}</span>
        </p>
      </div>
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
      <div className="sticker-print-area">
        {Array.from({ length: Math.max(1, count) }).map((_, i) => (
          <div key={i} className="sticker-print-page">
            <StickerLabel data={data} format={format} />
          </div>
        ))}
      </div>
      <style>{`
        .sticker-print-area { position: fixed; left: -10000px; top: 0; pointer-events: none; }
        @media print {
          @page { size: ${f.widthMm}mm ${f.heightMm}mm; margin: 0; }
          html, body { background: #fff !important; }
          body * { visibility: hidden; }
          .sticker-print-area, .sticker-print-area * { visibility: visible; }
          .sticker-print-area { position: absolute !important; left: 0 !important; top: 0 !important; }
          .sticker-print-page { break-after: page; page-break-after: always; }
          .sticker-print-page:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
    </>,
    document.body,
  );
}

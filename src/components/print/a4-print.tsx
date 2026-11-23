"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Op dit apparaat gaat elke afdruk direct naar de Argox (Chrome --kiosk-printing). */
export const STICKER_DEVICE_KEY = "culilogic:stickerapparaat";

export function isStickerDevice(): boolean {
  try {
    return window.localStorage.getItem(STICKER_DEVICE_KEY) === "1";
  } catch {
    return false;
  }
}

export const A4_SHORTCUT_TARGET =
  '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="C:\\Culilogic\\chrome-a4" --app=https://horecaplatform.vercel.app/menus';

/**
 * Afdrukken op A4 (netwerkprinter). Alleen wat binnen <A4PrintArea> staat
 * wordt geprint. Op een stickerapparaat (kiosk-printing → Argox) printen we
 * niet stilletjes op stickerpapier, maar leggen we uit hoe het wel kan.
 */
export function A4PrintButton({ label = "Printen (A4)" }: { label?: string }) {
  const [warn, setWarn] = useState(false);
  return (
    <span className="relative print:hidden">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          if (isStickerDevice()) setWarn(true);
          else window.print();
        }}
      >
        <Printer className="h-3.5 w-3.5" />
        {label}
      </Button>
      {warn && (
        <span className="absolute right-0 z-30 mt-1 block w-80 rounded-md border border-copper/40 bg-surface p-3 text-left text-xs shadow-lg">
          <strong className="block text-copper">Dit is een stickerapparaat</strong>
          Printen gaat hier direct naar de Argox. Open voor A4 de snelkoppeling{" "}
          <strong>Culilogic A4</strong> (zie Stickers → Printer instellen) en print daar; kies één keer de
          netwerkprinter, Chrome onthoudt hem.
          <span className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded border border-border px-2 py-1"
              onClick={() => {
                setWarn(false);
                window.print();
              }}
            >
              Toch printen
            </button>
            <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setWarn(false)}>
              Sluiten
            </button>
          </span>
        </span>
      )}
    </span>
  );
}

/** Alleen dit deel komt op papier: A4 staand, met een kop. */
export function A4PrintArea({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="a4-print">
      {title && (
        <div className="a4-print-head hidden print:block">
          <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{title}</p>
          {subtitle && <p style={{ fontSize: 11, margin: "2px 0 8px" }}>{subtitle}</p>}
        </div>
      )}
      {children}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          body * { visibility: hidden; }
          .a4-print, .a4-print * { visibility: visible; }
          .a4-print { position: absolute; left: 0; top: 0; width: 100%; font-size: 11px; color: #000; }
          .a4-print table { font-size: 10.5px; }
          .a4-print tr { break-inside: avoid; }
          .a4-print thead { display: table-header-group; }
          .a4-print [class*="shadow"] { box-shadow: none !important; }
          .a4-print .overflow-x-auto { overflow: visible !important; }
        }
      `}</style>
    </div>
  );
}

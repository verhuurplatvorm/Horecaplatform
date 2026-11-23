"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  STICKER_FORMATS,
  StickerLabel,
  StickerPrintArea,
  findFormat,
  readStickerFormat,
  writeStickerFormat,
  type StickerLabelData,
} from "@/components/stickers/sticker-label";
import { A4_SHORTCUT_TARGET, STICKER_DEVICE_KEY } from "@/components/print/a4-print";

// Eigen Chrome-profiel: start altijd als apart venster mét de printinstelling,
// ook als gewone Chrome al open staat (anders negeert Chrome de instelling).
const SHORTCUT_TARGET =
  '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="C:\\Culilogic\\chrome" --kiosk-printing --app=https://horecaplatform.vercel.app/stickers';

/**
 * Printer instellen: per vast apparaat één keer de Argox als standaard-
 * printer en Chrome met --kiosk-printing, dan print "Printen" direct
 * zonder printvenster. Met een teststicker om het formaat te controleren.
 */
export default function StickerPrinterPage() {
  const [format, setFormat] = useState(STICKER_FORMATS[0].value);
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState(false);

  // Het gekozen formaat staat per apparaat in de browser.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormat(readStickerFormat());
  }, []);

  useEffect(() => {
    if (nonce === 0) return;
    const t = setTimeout(() => window.print(), 50);
    return () => clearTimeout(t);
  }, [nonce]);

  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  const plus3 = new Date(today.getTime() + 3 * 86400000)
    .toISOString()
    .slice(0, 10);
  const sample: StickerLabelData = {
    type: "vers",
    productName: "Teststicker",
    productionDate: iso,
    productionTime: today.toTimeString().slice(0, 5),
    expiryDate: plus3,
    storageTemp: "max. 7 °C",
    employeeName: "Test",
    companyName: "Culilogic",
  };
  const f = findFormat(format);

  return (
    <>
      <Topbar title="Stickerprinter instellen" />
      <main className="max-w-4xl space-y-4 p-6">
        <Card>
          <CardContent className="space-y-4 p-5 text-sm">
            <p>
              Eén keer instellen per vast apparaat. Daarna gaat een sticker bij{" "}
              <strong>Printen</strong> direct naar de Argox, zonder
              printvenster.
            </p>
            <ol className="list-decimal space-y-3 pl-5">
              <li>
                <strong>Argox als standaardprinter.</strong> Windows:
                Instellingen → Bluetooth en apparaten → Printers en scanners →
                Argox → <em>Als standaard instellen</em>. Zet daar ook
                &quot;Windows mag mijn standaardprinter beheren&quot; uit.
              </li>
              <li>
                <strong>Etiketformaat in het stuurprogramma.</strong> Argox →
                Voorkeursinstellingen afdrukken → papier/etiket:{" "}
                <strong>{f.label.replace(" (standaard)", "")}</strong>, marges
                0. Gebruik hetzelfde formaat als hieronder.
              </li>
              <li>
                <strong>Snelkoppeling voor Chrome.</strong> Rechtsklik op het
                bureaublad → Nieuw → Snelkoppeling, plak dit als locatie en noem
                hem &quot;Stickers&quot;:
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="block flex-1 break-all rounded bg-background px-2 py-1.5 text-xs">
                    {SHORTCUT_TARGET}
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(SHORTCUT_TARGET)
                        .then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        });
                    }}
                  >
                    {copied ? "Gekopieerd" : "Kopiëren"}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Edge in plaats van Chrome? Vervang het eerste deel door{" "}
                  <code>
                    &quot;C:\Program Files
                    (x86)\Microsoft\Edge\Application\msedge.exe&quot;
                  </code>
                  .
                </p>
              </li>
              <li>
                <strong>Open Culilogic via de snelkoppeling</strong> en log één
                keer in. Dit is een eigen Culilogic-venster, los van je gewone
                Chrome; die mag gewoon open blijven. Gebruik voor stickers
                altijd dit venster (zet de snelkoppeling eventueel op de
                taakbalk).
              </li>
              <li>
                <strong>Teststicker printen.</strong> Komt er nog een
                printvenster? Dan is Culilogic niet via de snelkoppeling
                geopend, of staat Chrome op deze pc in{" "}
                <code>C:\Program Files (x86)\Google\…</code> (pas dan het eerste
                deel aan). Staat de sticker scheef of half? Controleer het
                formaat bij stap 2.
              </li>
            </ol>
            <A4Setup />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 p-5">
            <label className="text-sm">
              <span className="mb-1 block text-muted">
                Etiketformaat op dit apparaat
              </span>
              <select
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value);
                  writeStickerFormat(e.target.value);
                }}
                className="input"
              >
                {STICKER_FORMATS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded border border-border bg-white p-2">
              <StickerLabel data={sample} format={format} />
            </div>
            <Button onClick={() => setNonce((n) => n + 1)}>
              <Printer className="h-4 w-4" />
              Teststicker printen
            </Button>
          </CardContent>
        </Card>
      </main>
      {nonce > 0 && (
        <StickerPrintArea data={sample} format={format} count={1} />
      )}
    </>
  );
}

/**
 * A4-lijsten (werklijst, bestellijst) op een stickerapparaat: het sticker-
 * venster print altijd naar de Argox. Een tweede snelkoppeling met een eigen
 * Chrome-profiel zónder kiosk-printing toont wel het printvenster; daar kies
 * je één keer de netwerkprinter en Chrome onthoudt hem.
 */
function A4Setup() {
  const [isDevice, setIsDevice] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(STICKER_DEVICE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <p className="font-medium">Werklijst en bestellijst op A4 (netwerkprinter)</p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={isDevice}
          onChange={(e) => {
            try {
              if (e.target.checked) window.localStorage.setItem(STICKER_DEVICE_KEY, "1");
              else window.localStorage.removeItem(STICKER_DEVICE_KEY);
            } catch {
              /* geen opslag */
            }
            setIsDevice(e.target.checked);
          }}
        />
        <span>
          <strong>Dit venster print stickers</strong> (kiosk-printing). Aanvinken in het stickervenster:
          dan waarschuwt &quot;Printen (A4)&quot; in plaats van een A4-lijst op stickerpapier te printen.
        </span>
      </label>
      <p>
        Maak op dit apparaat een tweede snelkoppeling <strong>Culilogic A4</strong> met dit doel (eigen
        profiel, zónder kiosk-printing). Log daar één keer in, print iets en kies in het printvenster de
        netwerkprinter — Chrome onthoudt die keuze voor de volgende keer.
      </p>
      <div className="flex items-start gap-2">
        <code className="flex-1 break-all rounded bg-background p-2 text-xs">{A4_SHORTCUT_TARGET}</code>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void navigator.clipboard?.writeText(A4_SHORTCUT_TARGET).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          {copied ? "Gekopieerd" : "Kopiëren"}
        </Button>
      </div>
      <p className="text-xs text-muted">
        Op een gewone pc of laptop (zonder stickerprinter) hoeft dit niet: daar opent &quot;Printen (A4)&quot;
        het normale printvenster.
      </p>
    </div>
  );
}

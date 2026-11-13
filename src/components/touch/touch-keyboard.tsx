"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Delete, Keyboard, X } from "lucide-react";

/**
 * Touchscherm-modus voor vaste keukenapparaten.
 * - Grotere knoppen en invoervelden (min. 48 px hoog).
 * - Eigen schermtoetsenbord onderin zodra je een tekst- of getalveld
 *   aanraakt (getallen krijgen een numeriek toetsenbord). Het Windows-
 *   toetsenbord blijft dan weg (inputmode="none").
 * Aan/uit per apparaat; standaard aan op apparaten met een touchscherm.
 */

const STORAGE_KEY = "touch:modus";
const TEXT_TYPES = new Set([
  "",
  "text",
  "search",
  "email",
  "tel",
  "url",
  "number",
]);

type Field = HTMLInputElement | HTMLTextAreaElement;

function isEditable(el: EventTarget | null): el is Field {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return (
      TEXT_TYPES.has((el.getAttribute("type") ?? "").toLowerCase()) &&
      !el.readOnly &&
      !el.disabled
    );
  }
  return false;
}

function isNumeric(el: Field): boolean {
  if (el instanceof HTMLTextAreaElement) return false;
  const mode = (el.dataset.touchInputmode ?? el.inputMode ?? "").toLowerCase();
  return el.type === "number" || mode === "numeric" || mode === "decimal";
}

/** Waarde zetten zodat React (gecontroleerde velden) het ook ziet. */
function setNativeValue(el: Field, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertText(el: Field, text: string) {
  const v = el.value;
  let start = v.length;
  let end = v.length;
  try {
    if (el.selectionStart !== null && el.selectionEnd !== null) {
      start = el.selectionStart;
      end = el.selectionEnd;
    }
  } catch {
    /* number-velden hebben geen selectie */
  }
  setNativeValue(el, v.slice(0, start) + text + v.slice(end));
  try {
    el.setSelectionRange(start + text.length, start + text.length);
  } catch {
    /* idem */
  }
}

function backspace(el: Field) {
  const v = el.value;
  let start = v.length;
  let end = v.length;
  try {
    if (el.selectionStart !== null && el.selectionEnd !== null) {
      start = el.selectionStart;
      end = el.selectionEnd;
    }
  } catch {
    /* geen selectie */
  }
  if (start === end && start === 0) return;
  const from = start === end ? start - 1 : start;
  setNativeValue(el, v.slice(0, from) + v.slice(end));
  try {
    el.setSelectionRange(from, from);
  } catch {
    /* idem */
  }
}

const LETTERS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "é"],
  ["z", "x", "c", "v", "b", "n", "m", "ë", "-", "'"],
];
const NUMBERS = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  ["-", "0", ","],
];

export function TouchArea({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [target, setTarget] = useState<Field | null>(null);
  const [shift, setShift] = useState(false);
  const [numeric, setNumeric] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);
  // Getalvelden (type=number) accepteren geen tussenstand als "-" of "3,";
  // daarom typen we in een buffer en zetten alleen geldige getallen door.
  const [buffer, setBuffer] = useState("");

  // Per apparaat onthouden; standaard aan op touchschermen.
  useEffect(() => {
    let on = false;
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      on =
        v === null ? window.matchMedia("(any-pointer: coarse)").matches : v === "1";
    } catch {
      on = false;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(on);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* geen opslag */
      }
      if (!next) setTarget(null);
      return next;
    });
  }, []);

  // Veld aangeraakt → toetsenbord tonen.
  useEffect(() => {
    if (!enabled) return;
    function onFocusIn(e: FocusEvent) {
      if (!isEditable(e.target)) return;
      const el = e.target;
      if (el.dataset.touchInputmode === undefined)
        el.dataset.touchInputmode = el.inputMode ?? "";
      el.inputMode = "none"; // geen Windows-toetsenbord eroverheen
      setTarget(el);
      setNumeric(isNumeric(el));
      setBuffer(el.value);
      setShift(false);
      setTimeout(
        () => el.scrollIntoView({ block: "center", behavior: "smooth" }),
        50,
      );
    }
    function onFocusOut() {
      setTimeout(() => {
        const a = document.activeElement;
        if (!isEditable(a)) setTarget(null);
      }, 120);
    }
    // Op document-niveau, zodat ook velden in pop-ups meedoen.
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [enabled]);

  // Uitgezet: oorspronkelijke inputmode terug.
  useEffect(() => {
    if (enabled) return;
    document
      .querySelectorAll<HTMLElement>("[data-touch-inputmode]")
      .forEach((el) => {
        (el as HTMLInputElement).inputMode = el.dataset.touchInputmode ?? "";
        delete el.dataset.touchInputmode;
      });
  }, [enabled]);

  const isNumberField =
    target !== null &&
    target.tagName === "INPUT" &&
    (target as HTMLInputElement).type === "number";

  function press(key: string) {
    if (!target) return;
    target.focus();
    if (isNumberField && key !== "enter") {
      let next = buffer;
      if (key === "⌫") next = next.slice(0, -1);
      else if (key === "-")
        next = next.startsWith("-") ? next.slice(1) : "-" + next;
      else if (key === "," || key === ".")
        next = /[.,]/.test(next) ? next : next + ",";
      else if (/^\d$/.test(key)) next = next + key;
      else return;
      setBuffer(next);
      const normal = next.replace(",", ".");
      if (/^-?\d+(\.\d+)?$/.test(normal)) setNativeValue(target, normal);
      else if (next === "") setNativeValue(target, "");
      return;
    }
    if (key === "⌫") backspace(target);
    else if (key === "space") insertText(target, " ");
    else if (key === "enter") {
      if (target instanceof HTMLTextAreaElement) {
        insertText(target, "\n");
        return;
      }
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
        }),
      );
      target.blur();
      setTarget(null);
    } else {
      insertText(target, shift ? key.toUpperCase() : key);
      if (shift) setShift(false);
    }
  }

  const keyClass =
    "flex h-14 min-w-0 flex-1 select-none items-center justify-center rounded-lg border border-border bg-surface text-lg font-medium shadow-sm active:bg-teal/15";
  // Toetsen mogen de focus niet van het veld afpakken.
  const hold = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();

  const keyboard =
    enabled && target
      ? createPortal(
          <div
            className="fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-background/95 p-2 shadow-2xl backdrop-blur print:hidden"
            onPointerDown={hold}
            onMouseDown={hold}
          >
            <div
              className={`mx-auto space-y-1.5 ${numeric ? "max-w-sm" : "max-w-4xl"}`}
            >
              {isNumberField && (
                <div className="flex h-12 items-center justify-end rounded-lg border border-border bg-surface px-3 text-2xl tabular">
                  {buffer || <span className="text-muted">0</span>}
                </div>
              )}
              {(numeric ? NUMBERS : LETTERS).map((row, i) => (
                <div key={i} className="flex gap-1.5">
                  {row.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={keyClass}
                      onClick={() => press(k)}
                    >
                      {shift && !numeric ? k.toUpperCase() : k}
                    </button>
                  ))}
                </div>
              ))}
              <div className="flex gap-1.5">
                {!numeric && (
                  <button
                    type="button"
                    className={`${keyClass} max-w-24 ${shift ? "border-teal bg-teal/15 text-teal" : ""}`}
                    onClick={() => setShift((s) => !s)}
                  >
                    ⇧
                  </button>
                )}
                {!isNumberField && (
                  <button
                    type="button"
                    className={`${keyClass} max-w-24 text-sm`}
                    onClick={() => setNumeric((n) => !n)}
                  >
                    {numeric ? "abc" : "123"}
                  </button>
                )}
                {!numeric && (
                  <button
                    type="button"
                    className={`${keyClass} flex-[4]`}
                    onClick={() => press("space")}
                  >
                    spatie
                  </button>
                )}
                <button
                  type="button"
                  className={`${keyClass} max-w-24`}
                  onClick={() => press("⌫")}
                  aria-label="Wissen"
                >
                  <Delete className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  className={`${keyClass} max-w-32 border-teal bg-teal text-white active:bg-teal/80`}
                  onClick={() => press("enter")}
                >
                  Klaar
                </button>
                <button
                  type="button"
                  className={`${keyClass} max-w-16`}
                  onClick={() => {
                    target.blur();
                    setTarget(null);
                  }}
                  aria-label="Toetsenbord sluiten"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={areaRef} className={enabled ? "touch-ui" : undefined}>
      {enabled && (
        <style>{`
          .touch-ui button, .touch-ui select, .touch-ui a[role="button"],
          .touch-ui input:not([type="checkbox"]):not([type="radio"]), .touch-ui textarea {
            min-height: 48px; font-size: 1.05rem;
          }
          .touch-ui input[type="checkbox"], .touch-ui input[type="radio"] { width: 26px; height: 26px; }
          .touch-ui .opacity-0 { opacity: 1 !important; }
        `}</style>
      )}
      {children}
      {/* Ruimte zodat het toetsenbord niets afdekt. */}
      {enabled && target && (
        <div style={{ height: numeric ? 300 : 360 }} aria-hidden />
      )}
      <button
        type="button"
        onClick={toggle}
        className={`fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-full border px-4 py-3 text-sm shadow-lg print:hidden ${
          enabled
            ? "border-teal bg-teal text-white"
            : "border-border bg-surface text-muted"
        } ${enabled && target ? "hidden" : ""}`}
        title="Touchscherm-modus met schermtoetsenbord"
      >
        <Keyboard className="h-5 w-5" />
        {enabled ? "Touch aan" : "Touch uit"}
      </button>
      {keyboard}
    </div>
  );
}

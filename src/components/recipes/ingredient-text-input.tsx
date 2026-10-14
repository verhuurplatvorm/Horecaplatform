"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Eén groot invoerveld voor ingrediënten, een regel per ingrediënt
 * ("2000 ml kookwijn wit"). Dit veld doet alleen de INVOER: de tekst wordt
 * doorgegeven aan de ouder, die hem leest en aan de database koppelt. Er
 * wordt niets uit dit veld opgeslagen.
 *
 * Enter voegt toe (Shift+Enter = nieuwe regel), plakken van meerdere
 * regels voegt direct toe.
 */
export function IngredientTextInput({
  onAdd,
  mode = "add",
  initialText = "",
  onCancel,
}: {
  onAdd: (text: string) => void | Promise<void>;
  mode?: "add" | "edit";
  initialText?: string;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Het veld groeit mee met de inhoud zodat er geen scrollbalk of leeg vlak is.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);

  useEffect(() => {
    if (mode === "edit") ref.current?.focus();
  }, [mode]);

  function submit(value: string) {
    if (!value.trim()) return;
    setText("");
    void onAdd(value);
    if (mode === "add") ref.current?.focus();
  }

  return (
    <div className="space-y-2">
      <textarea
        ref={ref}
        value={text}
        rows={mode === "edit" ? 6 : 2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          const wantsSubmit =
            mode === "edit"
              ? e.key === "Enter" && (e.ctrlKey || e.metaKey)
              : e.key === "Enter" && !e.shiftKey;
          if (wantsSubmit && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            submit(text);
          }
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text");
          if (mode === "add" && /\r?\n/.test(pasted.trim())) {
            e.preventDefault();
            submit(text ? `${text}\n${pasted}` : pasted);
          }
        }}
        placeholder={
          mode === "add"
            ? "Typ of plak ingrediënten, één per regel. Bijvoorbeeld:\n2000 ml kookwijn wit\n25 gram zout\n2 stuks citroen"
            : undefined
        }
        className="block w-full resize-none rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm leading-6 focus:border-teal focus:outline-none"
        aria-label="Ingrediënten"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => submit(text)} disabled={!text.trim()}>
          {mode === "edit" ? "Toepassen" : "Toevoegen"}
        </Button>
        {mode === "edit" && onCancel && (
          <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
            Annuleren
          </Button>
        )}
        <span className="text-xs text-muted">
          {mode === "edit"
            ? "Ctrl+Enter = toepassen"
            : "Enter = toevoegen · Shift+Enter = nieuwe regel"}
        </span>
      </div>
    </div>
  );
}

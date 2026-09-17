"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Columns3, GripVertical, Save, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DataColumn<T> {
  key: string;
  label: string;
  /** Waarde waarop gefilterd en gesorteerd wordt (platte tekst of getal). */
  value: (row: T) => string | number | null;
  /** Eigen weergave; standaard wordt `value` getoond. */
  render?: (row: T) => React.ReactNode;
  width?: number;
  align?: "left" | "right";
  /** Kolom staat standaard verborgen (gebruiker kan 'm aanzetten). */
  hiddenByDefault?: boolean;
  /** Kolom blijft links staan bij horizontaal scrollen. */
  sticky?: boolean;
  /** Geen filterveld onder de kop (bv. bij puur visuele kolommen). */
  noFilter?: boolean;
}

interface SavedView {
  name: string;
  filters: Record<string, string>;
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
}

/**
 * Compacte, configureerbare tabel voor grote overzichten.
 *
 * - horizontaal scrollbaar, met een kolom die links vastgezet kan blijven
 * - filterveld onder elke kolomkop, sorteren door op de kop te klikken
 * - kolommen tonen/verbergen, volgorde slepen, breedte slepen
 * - opgeslagen weergaven (filters + kolominstellingen) per gebruiker
 *
 * Instellingen worden lokaal per browser bewaard onder `storageKey`, zodat
 * ze niet met andere gebruikers of schermen botsen.
 */
export function ConfigurableTable<T extends { id: string }>({
  columns,
  rows,
  storageKey,
  onRowClick,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  emptyLabel = "Geen resultaten.",
  rowClassName,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  storageKey: string;
  onRowClick?: (row: T) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: (ids: string[]) => void;
  emptyLabel?: string;
  rowClassName?: (row: T) => string | undefined;
}) {
  const defaultOrder = useMemo(() => columns.map((c) => c.key), [columns]);
  const defaultHidden = useMemo(
    () => columns.filter((c) => c.hiddenByDefault).map((c) => c.key),
    [columns]
  );

  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [hidden, setHidden] = useState<string[]>(defaultHidden);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  // Instellingen laden (eenmalig, per scherm)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`tbl:${storageKey}`);
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p.order)) setOrder(p.order);
        if (Array.isArray(p.hidden)) setHidden(p.hidden);
        if (p.widths) setWidths(p.widths);
      }
      const rawViews = localStorage.getItem(`tbl:${storageKey}:views`);
      if (rawViews) setViews(JSON.parse(rawViews));
    } catch {
      // Kapotte of geblokkeerde opslag mag het scherm nooit breken.
    }
  }, [storageKey]);

  // Nieuwe kolommen in de code toevoegen aan een bestaande opgeslagen volgorde
  useEffect(() => {
    setOrder((prev) => {
      const missing = defaultOrder.filter((k) => !prev.includes(k));
      const stillValid = prev.filter((k) => defaultOrder.includes(k));
      return missing.length || stillValid.length !== prev.length
        ? [...stillValid, ...missing]
        : prev;
    });
  }, [defaultOrder]);

  function persist(next: Partial<{ order: string[]; hidden: string[]; widths: Record<string, number> }>) {
    try {
      localStorage.setItem(
        `tbl:${storageKey}`,
        JSON.stringify({ order, hidden, widths, ...next })
      );
    } catch {
      /* opslag kan geweigerd worden; instellingen gelden dan alleen deze sessie */
    }
  }

  const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
  const visible = order.map((k) => byKey.get(k)).filter(Boolean) as DataColumn<T>[];
  const shown = visible.filter((c) => !hidden.includes(c.key));

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v.trim() !== "");
    let out = rows;
    if (active.length) {
      out = rows.filter((row) =>
        active.every(([key, term]) => {
          const col = byKey.get(key);
          if (!col) return true;
          const v = col.value(row);
          return String(v ?? "").toLowerCase().includes(term.trim().toLowerCase());
        })
      );
    }
    if (sortKey) {
      const col = byKey.get(sortKey);
      if (col) {
        out = [...out].sort((a, b) => {
          const va = col.value(a);
          const vb = col.value(b);
          if (va === null || va === undefined) return 1;
          if (vb === null || vb === undefined) return -1;
          const cmp =
            typeof va === "number" && typeof vb === "number"
              ? va - vb
              : String(va).localeCompare(String(vb), "nl", { numeric: true });
          return cmp * sortDir;
        });
      }
    }
    return out;
  }, [rows, filters, sortKey, sortDir, byKey]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  // Kolombreedte slepen
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const r = resizeRef.current;
      if (!r) return;
      const w = Math.max(60, r.startW + (e.clientX - r.startX));
      setWidths((prev) => ({ ...prev, [r.key]: w }));
    }
    function onUp() {
      if (resizeRef.current) {
        resizeRef.current = null;
        persist({});
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  });

  function saveView() {
    const name = window.prompt("Naam voor deze weergave (filters + kolommen):");
    if (!name?.trim()) return;
    const next = [
      ...views.filter((v) => v.name !== name.trim()),
      { name: name.trim(), filters, order, hidden, widths },
    ];
    setViews(next);
    try {
      localStorage.setItem(`tbl:${storageKey}:views`, JSON.stringify(next));
    } catch {
      window.alert("Opslaan van de weergave is niet gelukt in deze browser.");
    }
  }

  function applyView(v: SavedView) {
    setFilters(v.filters ?? {});
    setOrder(v.order ?? defaultOrder);
    setHidden(v.hidden ?? []);
    setWidths(v.widths ?? {});
  }

  function deleteView(name: string) {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    try {
      localStorage.setItem(`tbl:${storageKey}:views`, JSON.stringify(next));
    } catch {
      /* niets aan te doen */
    }
  }

  const allShownSelected =
    !!selectedIds && filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowColumnPanel((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-background"
        >
          <Columns3 className="h-3.5 w-3.5" />
          Kolommen ({shown.length}/{columns.length})
        </button>
        <button
          type="button"
          onClick={saveView}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-background"
        >
          <Save className="h-3.5 w-3.5" />
          Weergave opslaan
        </button>
        {views.map((v) => (
          <span
            key={v.name}
            className="flex items-center gap-1 rounded-full bg-teal/10 px-2 py-1 text-xs text-teal"
          >
            <button type="button" onClick={() => applyView(v)} className="hover:underline">
              {v.name}
            </button>
            <button
              type="button"
              onClick={() => deleteView(v.name)}
              title="Weergave verwijderen"
              className="opacity-60 hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {Object.values(filters).some((v) => v.trim() !== "") && (
          <button
            type="button"
            onClick={() => setFilters({})}
            className="ml-auto text-xs text-muted hover:text-foreground"
          >
            Filters wissen
          </button>
        )}
      </div>

      {showColumnPanel && (
        <div className="rounded-md border border-border bg-surface p-3">
          <p className="mb-2 text-xs text-muted">
            Vink aan wat je wilt zien. Sleep met het greepje om de volgorde te wijzigen;
            sleep de rechterrand van een kolomkop om de breedte aan te passen.
          </p>
          <div className="grid gap-1 sm:grid-cols-3">
            {visible.map((c) => (
              <label
                key={c.key}
                draggable
                onDragStart={() => setDragKey(c.key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (!dragKey || dragKey === c.key) return;
                  const next = order.filter((k) => k !== dragKey);
                  next.splice(next.indexOf(c.key), 0, dragKey);
                  setOrder(next);
                  persist({ order: next });
                  setDragKey(null);
                }}
                className="flex cursor-grab items-center gap-2 rounded px-2 py-1 text-sm hover:bg-background"
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted" />
                <input
                  type="checkbox"
                  checked={!hidden.includes(c.key)}
                  onChange={() => {
                    const next = hidden.includes(c.key)
                      ? hidden.filter((k) => k !== c.key)
                      : [...hidden, c.key];
                    setHidden(next);
                    persist({ hidden: next });
                  }}
                />
                <span className="truncate">{c.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm" style={{ minWidth: "max-content" }}>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              {selectedIds && (
                <th className="sticky left-0 z-20 w-8 bg-surface px-2 py-2">
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={() => onToggleSelectAll?.(filtered.map((r) => r.id))}
                  />
                </th>
              )}
              {shown.map((c) => (
                <th
                  key={c.key}
                  style={{ width: widths[c.key] ?? c.width }}
                  className={cn(
                    "relative whitespace-nowrap px-2 py-2 font-medium",
                    c.sticky && "sticky z-20 bg-surface",
                    c.sticky && (selectedIds ? "left-8" : "left-0")
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className="flex items-center gap-1 hover:text-foreground"
                  >
                    {c.label}
                    {sortKey === c.key &&
                      (sortDir === 1 ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      ))}
                  </button>
                  <span
                    onMouseDown={(e) => {
                      resizeRef.current = {
                        key: c.key,
                        startX: e.clientX,
                        startW: widths[c.key] ?? c.width ?? 120,
                      };
                    }}
                    title="Sleep om de kolombreedte aan te passen"
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-teal/40"
                  />
                </th>
              ))}
            </tr>
            <tr>
              {selectedIds && <th className="sticky left-0 z-20 bg-surface px-2 pb-2" />}
              {shown.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-2 pb-2",
                    c.sticky && "sticky z-20 bg-surface",
                    c.sticky && (selectedIds ? "left-8" : "left-0")
                  )}
                >
                  {!c.noFilter && (
                    <input
                      value={filters[c.key] ?? ""}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, [c.key]: e.target.value }))
                      }
                      className="h-7 w-full min-w-[70px] rounded border border-border bg-background px-1.5 text-xs font-normal"
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-t border-border hover:bg-background",
                  onRowClick && "cursor-pointer",
                  rowClassName?.(row)
                )}
              >
                {selectedIds && (
                  <td className="sticky left-0 z-10 bg-surface px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={() => onToggleSelect?.(row.id)}
                    />
                  </td>
                )}
                {shown.map((c) => (
                  <td
                    key={c.key}
                    onClick={() => onRowClick?.(row)}
                    style={{ width: widths[c.key] ?? c.width }}
                    className={cn(
                      "px-2 py-1.5",
                      c.align === "right" && "text-right tabular",
                      c.sticky && "sticky z-10 bg-surface font-medium",
                      c.sticky && (selectedIds ? "left-8" : "left-0")
                    )}
                  >
                    {c.render ? c.render(row) : (c.value(row) ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={shown.length + (selectedIds ? 1 : 0)}
                  className="px-4 py-8 text-center text-muted"
                >
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        {filtered.length} van {rows.length} ingrediënten
      </p>
    </div>
  );
}

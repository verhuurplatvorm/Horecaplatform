"use client";

import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { ProductViewTabs } from "@/components/products/product-view-tabs";
import { ALLERGEN_LIST, inferAllergens, type AllergenKey } from "@/lib/allergens/infer";
import { cn } from "@/lib/utils";
import type { WebAllergenResult } from "@/lib/allergens/openfoodfacts";

interface Row {
  id: string;
  name: string;
  status: "gevonden" | "geen_verwacht" | "onbekend";
  certain: AllergenKey[];
  assumed: AllergenKey[];
  reasons: string[];
  ean: string;
}

type Filter = "alle" | "zeker" | "aanname" | "geen_verwacht" | "onbekend";

const PAGE = 1000;
const VIEW_SIZE = 50;

export default function AllergenenPage() {
  const [rows, setRows] = useState<Row[]>([]);
  // Per product de uiteindelijk gekozen allergenen (bewerkbaar).
  const [chosen, setChosen] = useState<Map<string, Set<string>>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("zeker");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // Resultaten van het opzoeken op het web (Open Food Facts), per product.
  const [web, setWeb] = useState<Map<string, WebAllergenResult>>(new Map());
  const [webBusy, setWebBusy] = useState(false);
  const [webMsg, setWebMsg] = useState<string | null>(null);

  async function lookupWeb() {
    // Proef: de eerste 50 ingrediënten uit de huidige lijst die een EAN-code
    // hebben en nog niet zijn opgezocht.
    const ids = visible
      .filter((r) => r.ean && !web.has(r.id))
      .slice(0, 50)
      .map((r) => r.id);
    if (ids.length === 0) {
      setWebMsg("Niets om op te zoeken: geen (nieuwe) ingrediënten met EAN-code in deze lijst. Probeer het filter 'Geen verwacht', 'Onbekend' of 'Alles'.");
      return;
    }
    setWebBusy(true);
    setWebMsg(null);
    try {
      const found = new Map<string, WebAllergenResult>();
      for (let i = 0; i < ids.length; i += 15) {
        const res = await fetch("/api/allergens/web-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: ids.slice(i, i + 15) }),
        });
        const json = (await res.json()) as { results?: Record<string, WebAllergenResult>; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Opzoeken mislukt.");
        for (const [id, r] of Object.entries(json.results ?? {})) found.set(id, r);
      }
      const usable = [...found.entries()].filter(([, r]) => r.status === "gevonden");
      setWeb((prev) => new Map([...prev, ...found]));
      // De webuitkomst vervangt het naamvoorstel in de keuzes, maar wordt pas
      // opgeslagen nadat jij het product aanvinkt en op Opslaan klikt.
      setChosen((prev) => {
        const next = new Map(prev);
        for (const [id, r] of usable) next.set(id, new Set<string>(r.allergens));
        return next;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        for (const [id] of usable) next.delete(id);
        return next;
      });
      const notFound = [...found.values()].filter((r) => r.status === "niet_gevonden").length;
      const noData = [...found.values()].filter((r) => r.status === "onvolledig").length;
      const errs = [...found.values()].filter((r) => r.status === "fout").length;
      setWebMsg(
        `${usable.length} van ${ids.length} gevonden op het web` +
          (notFound > 0 ? `, ${notFound} niet bekend bij Open Food Facts` : "") +
          (noData > 0 ? `, ${noData} zonder allergeneninfo` : "") +
          (errs > 0 ? `, ${errs} mislukt (probeer later opnieuw)` : "") +
          ". Controleer de gevonden producten en vink ze aan om op te slaan."
      );
    } catch (err) {
      setWebMsg(err instanceof Error ? err.message : "Opzoeken mislukt.");
    } finally {
      setWebBusy(false);
    }
  }

  function selectWebFound() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of visible) if (web.get(r.id)?.status === "gevonden") next.add(r.id);
      return next;
    });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const out: Row[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error: e } = await supabase
          .from("products")
          .select("id, name, custom_name, ean_code")
          .eq("allergens_checked", false)
          .order("name")
          .range(from, from + PAGE - 1);
        if (e) throw new Error(e.message);
        for (const p of data ?? []) {
          const label = (p.custom_name as string | null)?.trim() || (p.name as string);
          const g = inferAllergens(label);
          out.push({
            id: p.id as string,
            name: label,
            status: g.status,
            certain: g.certain,
            assumed: g.assumed,
            reasons: g.reasons,
            ean: ((p.ean_code as string | null) ?? "").trim(),
          });
        }
        if (!data || data.length < PAGE) break;
      }
      const ch = new Map<string, Set<string>>();
      const sel = new Set<string>();
      for (const r of out) {
        ch.set(r.id, new Set<string>([...r.certain, ...r.assumed]));
        // Alleen vooraf aangevinkt wat zeker is: een naam die het ingrediënt
        // noemt, of een eenvoudig vers product. Aannames en onbekend niet.
        if (r.status === "geen_verwacht" || (r.status === "gevonden" && r.assumed.length === 0))
          sel.add(r.id);
      }
      setRows(out);
      setChosen(ch);
      setSelected(sel);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Laden mislukt.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const kindOf = (r: Row): Filter =>
    r.status === "onbekend"
      ? "onbekend"
      : r.status === "geen_verwacht"
        ? "geen_verwacht"
        : r.assumed.length > 0
          ? "aanname"
          : "zeker";

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { alle: rows.length, zeker: 0, aanname: 0, geen_verwacht: 0, onbekend: 0 };
    for (const r of rows) c[kindOf(r)]++;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) => (filter === "alle" || kindOf(r) === filter) && (!q || r.name.toLowerCase().includes(q))
    );
  }, [rows, filter, search]);

  const pageRows = visible.slice(page * VIEW_SIZE, (page + 1) * VIEW_SIZE);
  const pages = Math.max(1, Math.ceil(visible.length / VIEW_SIZE));
  const selectedVisible = visible.filter((r) => selected.has(r.id)).length;

  function toggleChip(id: string, a: string) {
    setChosen((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(id) ?? []);
      if (set.has(a)) set.delete(a);
      else set.add(a);
      next.set(id, set);
      return next;
    });
  }

  function setVisibleSelected(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of visible) {
        if (on) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  }

  async function save() {
    const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;
    const withNone = ids.filter((id) => (chosen.get(id)?.size ?? 0) === 0).length;
    const ok = window.confirm(
      `${ids.length} product(en) opslaan als gecontroleerd?\n\n` +
        (withNone > 0
          ? `${withNone} daarvan krijgen "geen allergenen" — controleer dat dit klopt.\n\n`
          : "") +
        "Je kunt dit later per product nog aanpassen."
    );
    if (!ok) return;
    setBusy(true);
    setResult(null);
    try {
      const supabase = createClient();
      // Producten met dezelfde allergenenlijst in één keer opslaan.
      const groups = new Map<string, string[]>();
      for (const id of ids) {
        const key = JSON.stringify([...(chosen.get(id) ?? [])].sort());
        groups.set(key, [...(groups.get(key) ?? []), id]);
      }
      let saved = 0;
      for (const [key, groupIds] of groups) {
        const allergens = JSON.parse(key) as string[];
        for (let i = 0; i < groupIds.length; i += 100) {
          const chunk = groupIds.slice(i, i + 100);
          const { error: e } = await supabase
            .from("products")
            .update({ allergens, allergens_checked: true })
            .in("id", chunk);
          if (e) throw new Error(e.message);
          saved += chunk.length;
        }
      }
      const done = new Set(ids);
      setRows((prev) => prev.filter((r) => !done.has(r.id)));
      setSelected(new Set());
      setPage(0);
      setResult(`${saved} product(en) opgeslagen. Gerechten en halfproducten rekenen hier automatisch mee.`);
    } catch (err) {
      setResult("Opslaan mislukt: " + (err instanceof Error ? err.message : "onbekende fout"));
    } finally {
      setBusy(false);
    }
  }

  const FILTERS: { key: Filter; label: string; hint: string }[] = [
    { key: "zeker", label: "Zeker", hint: "naam noemt het ingrediënt" },
    { key: "aanname", label: "Aanname", hint: "typisch voor dit soort product — controleren" },
    { key: "geen_verwacht", label: "Geen verwacht", hint: "eenvoudig vers product of drank" },
    { key: "onbekend", label: "Onbekend", hint: "niets herkend — zelf invullen" },
    { key: "alle", label: "Alles", hint: "" },
  ];

  return (
    <>
      <Topbar title="Ingrediënten" />
      <main className="space-y-4 p-4 md:p-6">
        <ProductViewTabs />
        <p className="max-w-3xl text-sm text-muted">
          Voorstel voor de allergenen per ingrediënt, afgeleid van de productnaam. Een naam zegt niet alles
          (een saus kan van alles bevatten), dus controleer vooral de <b>aannames</b> en vul <b>onbekende</b>{" "}
          producten zelf in. Wat je hier opslaat, werkt direct door in alle gerechten en halfproducten.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              title={f.hint}
              onClick={() => {
                setFilter(f.key);
                setPage(0);
              }}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm",
                filter === f.key ? "bg-teal text-white" : "bg-surface text-muted hover:bg-background"
              )}
            >
              {f.label} ({counts[f.key]})
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Zoek op naam…"
            className="ml-auto h-9 w-56 rounded-md border border-border bg-surface px-3 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button className="text-teal hover:underline" onClick={() => setVisibleSelected(true)}>
            Alles in deze lijst selecteren
          </button>
          <button className="text-muted hover:underline" onClick={() => setVisibleSelected(false)}>
            Niets selecteren
          </button>
          <span className="text-muted">
            {selectedVisible} van {visible.length} geselecteerd
          </span>
          <Button variant="secondary" onClick={lookupWeb} disabled={webBusy || loading}>
            {webBusy ? "Zoeken…" : `Opzoeken op het web (${Math.min(50, visible.filter((r) => r.ean && !web.has(r.id)).length)} met EAN)`}
          </Button>
          {[...web.values()].some((r) => r.status === "gevonden") && (
            <button className="text-teal hover:underline" onClick={selectWebFound}>
              Gevonden op web selecteren
            </button>
          )}
          <Button onClick={save} disabled={busy || selected.size === 0} className="ml-auto">
            {busy ? "Bezig…" : `Opslaan (${selected.size})`}
          </Button>
        </div>
        {webMsg && <p className="text-sm text-teal">{webMsg}</p>}
        {result && <p className="text-sm text-teal">{result}</p>}
        {error && <p className="text-sm text-danger">{error}</p>}

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <tbody>
                {pageRows.map((r) => {
                  const set = chosen.get(r.id) ?? new Set<string>();
                  return (
                    <tr key={r.id} className="border-t border-border first:border-t-0 align-top">
                      <td className="w-8 px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.id)) next.delete(r.id);
                              else next.add(r.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="w-[30%] px-2 py-3">
                        <div className="font-medium">{r.name}</div>
                        {r.reasons.length > 0 && (
                          <div className="text-xs text-muted">{r.reasons.join(" · ")}</div>
                        )}
                        {(() => {
                          const w = web.get(r.id);
                          if (!w) return null;
                          if (w.status === "gevonden")
                            return (
                              <div className="text-xs text-teal">
                                Bron: Open Food Facts{w.productName ? ` (${w.productName})` : ""}
                                {w.traces.length > 0 ? ` · sporen: ${w.traces.join(", ")}` : ""}
                              </div>
                            );
                          if (w.status === "onvolledig")
                            return <div className="text-xs text-muted">Op het web gevonden, maar zonder allergeneninfo.</div>;
                          if (w.status === "fout")
                            return <div className="text-xs text-danger">Opzoeken mislukt, probeer later opnieuw.</div>;
                          return <div className="text-xs text-muted">Niet gevonden op het web.</div>;
                        })()}
                        {r.status === "onbekend" && (
                          <div className="text-xs text-muted">Niets herkend. Zonder vinkjes = geen allergenen.</div>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap gap-1">
                          {ALLERGEN_LIST.map((a) => {
                            const on = set.has(a);
                            const isAssumed = r.assumed.includes(a);
                            return (
                              <button
                                key={a}
                                onClick={() => toggleChip(r.id, a)}
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-xs capitalize",
                                  on
                                    ? isAssumed
                                      ? "border-copper bg-copper/15 text-copper"
                                      : "border-teal bg-teal/15 text-teal"
                                    : "border-border text-muted hover:bg-background"
                                )}
                              >
                                {a}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && pageRows.length === 0 && (
                  <tr>
                    <td className="px-5 py-6 text-center text-muted">
                      {rows.length === 0 ? "Alle ingrediënten zijn gecontroleerd." : "Niets in deze lijst."}
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td className="px-5 py-6 text-center text-muted">Laden…</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 text-sm">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className="text-teal disabled:text-muted">
              ← Vorige
            </button>
            <span className="text-muted">
              Pagina {page + 1} van {pages}
            </span>
            <button
              disabled={page >= pages - 1}
              onClick={() => setPage(page + 1)}
              className="text-teal disabled:text-muted"
            >
              Volgende →
            </button>
          </div>
        )}
      </main>
    </>
  );
}

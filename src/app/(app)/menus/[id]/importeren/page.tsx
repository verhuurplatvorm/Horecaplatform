"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MenuItemSearch } from "@/components/menus/menu-item-search";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  hasHeaderRow,
  parseGrid,
  parseText,
  unitKeyFor,
  type ImportRow,
} from "@/lib/event-menus/sheet-import";
import type { EventMenu, Unit } from "@/lib/types/database";

// Buffetsheets noemen gerechten vaak anders dan in het systeem ("Duo van
// zalm en tonijn" ↔ "Schaal Duo Tonijn en Zalm HS"): vanaf 0,5 voorstellen,
// altijd gemarkeerd als "waarschijnlijk — controleren".
const LIKELY_MATCH_THRESHOLD = 0.5;

type Kind = "gerecht" | "halfproduct" | "ingrediënt";

interface Candidate {
  kind: Kind;
  id: string;
  name: string;
  companyId: string | null;
  status: string | null;
  score: number;
  exact: boolean;
}

interface SheetMeta {
  name: string | null;
  date: string | null;
  guests: number | null;
  food_price_per_person: number | null;
}

interface ReviewRow extends ImportRow {
  key: string;
  candidates: Candidate[];
  /** "kind:id" | "nieuw" | "overslaan" */
  choice: string;
  confidence: "zeker" | "waarschijnlijk" | null;
  qty: string;
  unitId: string;
  isFixed: boolean;
}

function choiceKey(c: { kind: Kind; id: string }) {
  return `${c.kind}:${c.id}`;
}

export default function MenuImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { activeCompanyIds } = useCompanyScope();

  const [menu, setMenu] = useState<EventMenu | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [baseUnits, setBaseUnits] = useState<Map<string, string | null>>(
    new Map(),
  );
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalsForGroup, setTotalsForGroup] = useState(false);
  const [meta, setMeta] = useState<SheetMeta | null>(null);
  // Hoeveelheid p.p. zoals het item in een eerder menu stond (bv. 60 g Vitello p.p.).
  const [lastUsage, setLastUsage] = useState<
    Map<string, { qty: number; unitId: string | null }>
  >(new Map());
  const [applyMeta, setApplyMeta] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("event_menus")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data }) => setMenu(data as EventMenu));
    supabase
      .from("units")
      .select("*")
      .order("sort_order")
      .then(({ data }) => setUnits((data as Unit[]) ?? []));
  }, [id]);

  const unitByKey = useMemo(
    () => new Map(units.map((u) => [u.key, u.id])),
    [units],
  );
  const portionUnitId = unitByKey.get("stuk") ?? "";
  const companyId = menu?.company_id ?? activeCompanyIds[0] ?? null;

  /** Standaard eenheid voor een gekozen item. */
  function defaultUnit(choice: string, sheetUnit: string | null): string {
    const [kind, itemId] = choice.split(":");
    if (kind === "gerecht") return portionUnitId;
    const fromSheet = sheetUnit
      ? unitByKey.get(unitKeyFor(sheetUnit) ?? sheetUnit)
      : undefined;
    if (fromSheet) return fromSheet;
    return baseUnits.get(itemId) ?? portionUnitId;
  }

  async function fetchLastUsage(ids: string[]) {
    const out = new Map<string, { qty: number; unitId: string | null }>();
    if (ids.length === 0) return out;
    const supabase = createClient();
    const sel = "recipe_id, product_id, quantity_per_person, unit_id, menu_id";
    const [a, b] = await Promise.all([
      supabase
        .from("event_menu_lines")
        .select(sel)
        .in("recipe_id", ids.slice(0, 300))
        .neq("menu_id", id)
        .gt("quantity_per_person", 0)
        .limit(2000),
      supabase
        .from("event_menu_lines")
        .select(sel)
        .in("product_id", ids.slice(0, 300))
        .neq("menu_id", id)
        .gt("quantity_per_person", 0)
        .limit(2000),
    ]);
    for (const l of [...(a.data ?? []), ...(b.data ?? [])]) {
      const key = (l.recipe_id ?? l.product_id) as string;
      if (!out.has(key))
        out.set(key, { qty: Number(l.quantity_per_person), unitId: l.unit_id });
    }
    return out;
  }

  async function review(parsed: ImportRow[]) {
    if (parsed.length === 0) {
      setError("Geen regels gevonden in dit bestand.");
      return;
    }
    setBusy("Koppelen aan bestaande gerechten…");
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc("match_menu_items", {
      p_names: parsed.map((r) => r.name),
    });
    if (err) {
      setBusy(null);
      setError(err.message);
      return;
    }
    const per: Candidate[][] = parsed.map(() => []);
    for (const m of data ?? []) {
      if (m.company_id && companyId && m.company_id !== companyId) continue;
      per[m.name_index]?.push({
        kind: m.item_kind,
        id: m.item_id,
        name: m.item_name,
        companyId: m.company_id,
        status: m.status,
        score: Number(m.similarity_score),
        exact: m.is_exact,
      });
    }
    // Basiseenheden van alle kandidaten (voor de standaardeenheid).
    const recipeIds = [
      ...new Set(
        per
          .flat()
          .filter((c) => c.kind !== "ingrediënt")
          .map((c) => c.id),
      ),
    ];
    const productIds = [
      ...new Set(
        per
          .flat()
          .filter((c) => c.kind === "ingrediënt")
          .map((c) => c.id),
      ),
    ];
    const [rb, pb] = await Promise.all([
      recipeIds.length
        ? supabase
            .from("recipes")
            .select("id, base_unit_id")
            .in("id", recipeIds.slice(0, 300))
        : Promise.resolve({
            data: [] as { id: string; base_unit_id: string | null }[],
          }),
      productIds.length
        ? supabase
            .from("products")
            .select("id, base_unit_id")
            .in("id", productIds.slice(0, 300))
        : Promise.resolve({
            data: [] as { id: string; base_unit_id: string | null }[],
          }),
    ]);
    const bu = new Map<string, string | null>();
    for (const x of [...(rb.data ?? []), ...(pb.data ?? [])])
      bu.set(x.id, x.base_unit_id);
    setBaseUnits(bu);

    // Eerdere menu's: hoeveel p.p. werd er van dit item gebruikt?
    const usage = await fetchLastUsage([...recipeIds, ...productIds]);
    setLastUsage(usage);

    setRows(
      parsed.map((r, i) => {
        const best = per[i][0];
        const sure = best?.exact;
        const likely =
          best && !best.exact && best.score >= LIKELY_MATCH_THRESHOLD;
        const choice = best && (sure || likely) ? choiceKey(best) : "nieuw";
        const [kind, itemId] = choice.split(":");
        const asPortion = kind === "gerecht" || choice === "nieuw";
        const sheetUnitId = r.unit
          ? unitByKey.get(unitKeyFor(r.unit) ?? r.unit)
          : undefined;
        return {
          ...r,
          key: `${i}`,
          candidates: per[i],
          choice,
          confidence: sure ? "zeker" : likely ? "waarschijnlijk" : null,
          qty:
            r.quantity != null
              ? String(r.quantity)
              : usage.get(itemId)
                ? String(usage.get(itemId)!.qty)
                : asPortion
                  ? "1"
                  : "",
          unitId:
            r.quantity == null && usage.get(itemId)?.unitId
              ? usage.get(itemId)!.unitId!
              : asPortion
                ? portionUnitId
                : sheetUnitId || bu.get(itemId) || portionUnitId,
          isFixed: false,
        };
      }),
    );
    setBusy(null);
  }

  async function extractViaClaude(body: FormData) {
    setBusy("Sheet uitlezen… (kan een minuut duren)");
    const res = await fetch("/api/event-menus/extract-pdf", {
      method: "POST",
      body,
    });
    const json = (await res.json()) as {
      rows?: ImportRow[];
      meta?: SheetMeta;
      error?: string;
    };
    if (!res.ok || !json.rows)
      throw new Error(json.error ?? "Uitlezen mislukt.");
    setMeta(json.meta ?? null);
    await review(json.rows);
  }

  async function readFile(file: File) {
    setError(null);
    setMeta(null);
    const name = file.name.toLowerCase();
    try {
      const fd = new FormData();
      if (name.endsWith(".pdf")) {
        fd.append("file", file);
        await extractViaClaude(fd);
        return;
      }
      setBusy("Sheet lezen…");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const first = XLSX.utils.sheet_to_json<(string | number | null)[]>(
        wb.Sheets[wb.SheetNames[0]],
        {
          header: 1,
          blankrows: false,
          defval: null,
        },
      );
      // Simpele lijst met kopregel (Gerecht / Aantal / …): hier lezen.
      if (hasHeaderRow(first)) {
        await review(parseGrid(first));
        return;
      }
      // Evenementsheet/draaiboek: Claude haalt het eten eruit.
      const text = wb.SheetNames.map(
        (n) =>
          `### ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t", blankrows: false })}`,
      ).join("\n\n");
      fd.append("text", text);
      await extractViaClaude(fd);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "Kan dit bestand niet lezen.");
    }
  }

  function update(key: string, patch: Partial<ReviewRow>) {
    setRows(
      (rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null,
    );
  }

  async function save() {
    if (!rows || !menu) return;
    setBusy("Opslaan…");
    setError(null);
    const supabase = createClient();
    let persons = Math.max(1, menu.person_count || 1);
    if (meta && applyMeta) {
      const patch: Partial<EventMenu> = {};
      if (meta.guests) patch.person_count = meta.guests;
      if (meta.date) patch.service_date = meta.date;
      if (meta.food_price_per_person)
        patch.sales_price_per_person = meta.food_price_per_person;
      if (Object.keys(patch).length > 0) {
        await supabase.from("event_menus").update(patch).eq("id", id);
        if (patch.person_count) persons = patch.person_count;
      }
    }

    // Onderdelen hergebruiken of aanmaken.
    const { data: existingSecs } = await supabase
      .from("event_menu_sections")
      .select("id, name, sort_order")
      .eq("menu_id", id);
    const sectionId = new Map(
      (existingSecs ?? []).map((s) => [s.name.toLowerCase(), s.id as string]),
    );
    let secSort = Math.max(
      0,
      ...(existingSecs ?? []).map((s) => s.sort_order ?? 0),
    );
    for (const name of [
      ...new Set(
        rows
          .filter((r) => r.choice !== "overslaan" && r.section)
          .map((r) => r.section!.trim()),
      ),
    ]) {
      if (sectionId.has(name.toLowerCase())) continue;
      secSort += 10;
      const { data } = await supabase
        .from("event_menu_sections")
        .insert({ menu_id: id, name, sort_order: secSort })
        .select("id")
        .single();
      if (data) sectionId.set(name.toLowerCase(), data.id);
    }

    const { data: last } = await supabase
      .from("event_menu_lines")
      .select("sort_order")
      .eq("menu_id", id)
      .order("sort_order", { ascending: false })
      .limit(1);
    let sort = last?.[0]?.sort_order ?? 0;
    const { data: profile } = await supabase.auth.getUser();
    let created = 0;
    let added = 0;
    let failed = 0;

    for (const r of rows) {
      if (r.choice === "overslaan") continue;
      let recipeId: string | null = null;
      let productId: string | null = null;
      if (r.choice === "nieuw") {
        const { data: rec, error: err } = await supabase
          .from("recipes")
          .insert({
            group_id: menu.group_id,
            company_id: companyId,
            name: r.name,
            recipe_kind: "gerecht" as const,
            category: "Partijgerechten",
            status: "concept" as const,
            created_by: profile.user?.id ?? null,
          })
          .select("id")
          .single();
        if (err || !rec) {
          failed++;
          continue;
        }
        recipeId = rec.id;
        created++;
      } else {
        const [kind, itemId] = r.choice.split(":");
        if (kind === "ingrediënt") productId = itemId;
        else recipeId = itemId;
      }
      const raw = Number(r.qty.replace(",", ".")) || 0;
      const qtyPp = totalsForGroup && !r.isFixed ? raw / persons : raw;
      sort += 10;
      const { error: err } = await supabase.from("event_menu_lines").insert({
        menu_id: id,
        section_id: r.section
          ? (sectionId.get(r.section.trim().toLowerCase()) ?? null)
          : null,
        recipe_id: recipeId,
        product_id: productId,
        quantity_per_person: Math.round(qtyPp * 10000) / 10000,
        unit_id: r.unitId || null,
        is_fixed: r.isFixed,
        note:
          [
            r.note,
            r.choice === "nieuw"
              ? "nieuw uit sheet — recept nog invullen"
              : null,
            raw > 0 ? null : "hoeveelheid p.p. nog invullen",
          ]
            .filter(Boolean)
            .join(" · ") || null,
        sort_order: sort,
      });
      if (err) failed++;
      else added++;
    }
    setBusy(null);
    if (failed > 0) {
      setError(
        `${added} regels toegevoegd (${created} nieuwe gerechten), ${failed} mislukt. Controleer het menu.`,
      );
      return;
    }
    router.push(`/menus/${id}`);
  }

  const missingQty = rows
    ? rows.filter(
        (r) =>
          r.choice !== "overslaan" && !(Number(r.qty.replace(",", ".")) > 0),
      ).length
    : 0;

  const counts = rows
    ? {
        sure: rows.filter(
          (r) =>
            r.confidence === "zeker" &&
            r.choice !== "nieuw" &&
            r.choice !== "overslaan",
        ).length,
        likely: rows.filter((r) => r.confidence === "waarschijnlijk").length,
        nieuw: rows.filter((r) => r.choice === "nieuw").length,
        skip: rows.filter((r) => r.choice === "overslaan").length,
      }
    : null;

  return (
    <>
      <Topbar title="Sheet importeren" />
      <main className="max-w-6xl space-y-4 p-6">
        <p className="text-sm text-muted">
          Menu: <strong className="text-foreground">{menu?.name ?? "…"}</strong>{" "}
          · {menu?.person_count ?? "?"} personen. De regels worden toegevoegd
          aan de bestaande samenstelling.
        </p>

        {!rows && (
          <Card>
            <CardHeader>
              <CardTitle>1. Sheet kiezen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-center hover:border-teal">
                <FileSpreadsheet className="h-8 w-8 text-teal" />
                <span className="font-medium">Excel, CSV of PDF kiezen</span>
                <span className="text-xs text-muted">
                  Kolommen als Onderdeel / Gerecht / Aantal / Eenheid worden
                  herkend. Kopjes zoals &ldquo;KOUD BUFFET&rdquo; worden het
                  onderdeel. Een PDF wordt uitgelezen zoals bij menukaarten.
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.ods,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void readFile(f);
                  }}
                />
              </label>
              <div>
                <p className="mb-1 text-sm font-medium">Of plak de regels</p>
                <textarea
                  rows={6}
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder={
                    "Koud buffet:\nRundercarpaccio\n80 g gerookte zalm\nWarm buffet:\nSaté van kip"
                  }
                  className="input font-mono text-sm"
                />
                <Button
                  className="mt-2"
                  disabled={!pasted.trim() || !!busy}
                  onClick={() => void review(parseText(pasted))}
                >
                  <Upload className="h-4 w-4" /> Regels lezen
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {busy && <p className="text-sm text-teal">{busy}</p>}
        {error && (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {rows &&
          meta &&
          (meta.guests || meta.date || meta.food_price_per_person) && (
            <label className="flex flex-wrap items-center gap-2 rounded-lg border border-teal/40 bg-teal/5 px-4 py-3 text-sm">
              <input
                type="checkbox"
                checked={applyMeta}
                onChange={(e) => setApplyMeta(e.target.checked)}
              />
              <span>
                Van de sheet overnemen in het menu:
                {meta.name && (
                  <>
                    {" "}
                    <strong>{meta.name}</strong> ·
                  </>
                )}
                {meta.date && (
                  <>
                    {" "}
                    datum{" "}
                    <strong>
                      {meta.date.split("-").reverse().join("-")}
                    </strong>{" "}
                    ·
                  </>
                )}
                {meta.guests && (
                  <>
                    {" "}
                    <strong>{meta.guests} personen</strong>
                    {menu && meta.guests !== menu.person_count
                      ? ` (nu ${menu.person_count})`
                      : ""}{" "}
                    ·
                  </>
                )}
                {meta.food_price_per_person && (
                  <>
                    {" "}
                    verkoopprijs eten{" "}
                    <strong>
                      € {meta.food_price_per_person.toFixed(2)}
                    </strong>{" "}
                    p.p.
                  </>
                )}
              </span>
            </label>
          )}

        {rows && counts && (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle>
                2. Controleren en koppelen ({rows.length} regels)
              </CardTitle>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="rounded bg-teal/10 px-2 py-0.5 text-teal">
                  {counts.sure} zeker
                </span>
                <span className="rounded bg-copper/10 px-2 py-0.5 text-copper">
                  {counts.likely} waarschijnlijk — controleren
                </span>
                <span className="rounded bg-surface px-2 py-0.5">
                  {counts.nieuw} nieuw (concept-gerecht)
                </span>
                <span className="text-muted">{counts.skip} overslaan</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-0">
              <label className="flex items-center gap-2 px-4 text-sm">
                <input
                  type="checkbox"
                  checked={totalsForGroup}
                  onChange={(e) => setTotalsForGroup(e.target.checked)}
                />
                De aantallen in de sheet zijn totaal voor de hele groep (dan
                wordt gedeeld door {menu?.person_count ?? "?"} personen)
              </label>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2 font-medium">Onderdeel</th>
                      <th className="px-2 py-2 font-medium">Op de sheet</th>
                      <th className="px-2 py-2 font-medium">Koppelen aan</th>
                      <th className="px-2 py-2 text-right font-medium">
                        {totalsForGroup ? "Totaal" : "Per persoon"}
                      </th>
                      <th className="px-2 py-2 font-medium">Eenheid</th>
                      <th
                        className="px-2 py-2 font-medium"
                        title="Vaste hoeveelheid voor het hele menu"
                      >
                        Vast
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.key}
                        className={cn(
                          "border-t border-border align-top",
                          r.choice === "overslaan" && "opacity-50",
                        )}
                      >
                        <td className="px-4 py-1.5">
                          <input
                            value={r.section ?? ""}
                            onChange={(e) =>
                              update(r.key, { section: e.target.value || null })
                            }
                            placeholder="—"
                            className="input h-8! w-36!"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="font-medium">{r.name}</span>
                          {r.note && (
                            <span className="block text-xs text-muted">
                              {r.note}
                            </span>
                          )}
                          {r.confidence && (
                            <span
                              className={cn(
                                "ml-1 rounded px-1 text-[10px]",
                                r.confidence === "zeker"
                                  ? "bg-teal/10 text-teal"
                                  : "bg-copper/10 text-copper",
                              )}
                            >
                              {r.confidence}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={r.choice}
                            onChange={(e) => {
                              const choice = e.target.value;
                              const used = lastUsage.get(
                                choice.split(":")[1] ?? "",
                              );
                              update(r.key, {
                                choice,
                                confidence: null,
                                unitId:
                                  used?.unitId ?? defaultUnit(choice, r.unit),
                                ...(used && r.quantity == null
                                  ? { qty: String(used.qty) }
                                  : {}),
                              });
                            }}
                            className={cn(
                              "input h-8! min-w-60",
                              r.choice === "nieuw" && "border-copper!",
                            )}
                          >
                            {r.candidates.map((c) => (
                              <option key={choiceKey(c)} value={choiceKey(c)}>
                                {c.name} ({c.kind}
                                {c.status === "concept" ? ", concept" : ""})
                              </option>
                            ))}
                            {r.choice.includes(":") &&
                              !r.candidates.some(
                                (c) => choiceKey(c) === r.choice,
                              ) && (
                                <option value={r.choice}>
                                  {r.choice.split(":")[0]} (gezocht)
                                </option>
                              )}
                            <option value="nieuw">
                              + Nieuw gerecht aanmaken (concept, map
                              Partijgerechten)
                            </option>
                            <option value="overslaan">Overslaan</option>
                          </select>
                          <div className="mt-1 w-60">
                            <MenuItemSearch
                              placeholder="ander item zoeken…"
                              onPick={(h) => {
                                const choice = choiceKey(h);
                                void fetchLastUsage([h.id]).then((u) => {
                                  const used = u.get(h.id);
                                  if (!used) return;
                                  setLastUsage((m) =>
                                    new Map(m).set(h.id, used),
                                  );
                                  if (r.quantity == null)
                                    update(r.key, {
                                      qty: String(used.qty),
                                      unitId: used.unitId ?? portionUnitId,
                                    });
                                });
                                setBaseUnits((m) =>
                                  new Map(m).set(h.id, h.baseUnitId),
                                );
                                update(r.key, {
                                  choice,
                                  confidence: null,
                                  candidates: [
                                    {
                                      kind: h.kind,
                                      id: h.id,
                                      name: h.name,
                                      companyId: null,
                                      status: null,
                                      score: 1,
                                      exact: false,
                                    },
                                    ...r.candidates,
                                  ],
                                  unitId:
                                    h.kind === "gerecht"
                                      ? portionUnitId
                                      : (h.baseUnitId ?? portionUnitId),
                                });
                              }}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={r.qty}
                            onChange={(e) =>
                              update(r.key, { qty: e.target.value })
                            }
                            className={cn(
                              "input h-8! w-24! text-right",
                              !r.qty &&
                                r.choice !== "overslaan" &&
                                "border-danger!",
                            )}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={r.unitId}
                            onChange={(e) =>
                              update(r.key, { unitId: e.target.value })
                            }
                            className="input h-8! w-28!"
                          >
                            {units.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.key === "stuk" ? "portie/stuk" : u.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={r.isFixed}
                            onChange={(e) =>
                              update(r.key, { isFixed: e.target.checked })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
                <Button onClick={() => void save()} disabled={!!busy}>
                  Toevoegen aan menu (
                  {rows.filter((r) => r.choice !== "overslaan").length})
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRows(null);
                    setMeta(null);
                  }}
                >
                  Ander bestand
                </Button>
                {missingQty > 0 ? (
                  <span className="text-sm text-copper">
                    {missingQty} regel(s) zonder hoeveelheid per persoon (rood
                    omrand). Je kunt ze nu invullen, of later in het menu — tot
                    dan tellen ze met 0 mee.
                  </span>
                ) : (
                  <span className="text-xs text-muted">
                    Een gerecht telt per portie (eenheid portie/stuk). Nieuwe
                    gerechten worden als concept aangemaakt; vul daarna het
                    recept in.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}

"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, Link2, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DishCandidate, MatchConfidence } from "@/lib/menu-import/dish-matching";

interface Proposal {
  itemId: string;
  folderName: string;
  cardName: string;
  price: number | null;
  currentRecipe: { id: string; name: string; status: string };
  currentIsEmptyDuplicate: boolean;
  candidates: DishCandidate[];
  suggestedRecipeId: string | null;
  confidence: MatchConfidence;
}

interface RowState {
  selected: boolean;
  recipeId: string;
}

export default function DubbeleGerechtenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: menuCardId } = use(params);

  const [cardName, setCardName] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [deleteEmpty, setDeleteEmpty] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ linked: number; failed: number; deleted: number; kept: number } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      const res = await fetch(`/api/menu-cards/${menuCardId}/dedupe`);
      const body = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(body.error ?? "Laden mislukt.");
        setLoading(false);
        return;
      }
      const list = body.proposals as Proposal[];
      setCardName(body.card?.name ?? "");
      setProposals(list);
      setRows(
        Object.fromEntries(
          list.map((p) => [
            p.itemId,
            {
              selected: p.suggestedRecipeId !== null,
              recipeId: p.suggestedRecipeId ?? p.candidates[0]?.recipe_id ?? "",
            },
          ])
        )
      );
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [menuCardId, reloadToken]);

  const selectedCount = useMemo(
    () => Object.values(rows).filter((r) => r.selected && r.recipeId).length,
    [rows]
  );
  const counts = useMemo(
    () => ({
      sure: proposals.filter((p) => p.confidence === "zeker").length,
      likely: proposals.filter((p) => p.confidence === "waarschijnlijk").length,
      other: proposals.filter((p) => p.confidence === null).length,
    }),
    [proposals]
  );

  function updateRow(itemId: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  function selectWhere(pred: (p: Proposal) => boolean) {
    setRows((prev) => {
      const next = { ...prev };
      for (const p of proposals) next[p.itemId] = { ...next[p.itemId], selected: pred(p) };
      return next;
    });
  }

  async function handleApply() {
    const links = proposals
      .filter((p) => rows[p.itemId]?.selected && rows[p.itemId]?.recipeId)
      .map((p) => ({ itemId: p.itemId, recipeId: rows[p.itemId].recipeId }));
    if (links.length === 0) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/menu-cards/${menuCardId}/dedupe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ links, deleteEmptyDuplicates: deleteEmpty }),
    });
    const body = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(body.error ?? "Koppelen mislukt.");
      return;
    }
    setResult(body);
    setReloadToken((t) => t + 1);
  }

  return (
    <>
      <Topbar title="Dubbele gerechten koppelen" />
      <main className="max-w-5xl space-y-4 p-6">
        <Link
          href={`/menukaarten/${menuCardId}`}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-teal"
        >
          <ArrowLeft className="h-4 w-4" />
          Terug naar {cardName || "menukaart"}
        </Link>

        <p className="text-sm text-muted">
          Gerechten op deze kaart die bij het inlezen nieuw zijn aangemaakt, maar al bestonden
          (bv. van de vorige kaart). Na koppelen gebruikt de kaartregel het bestaande gerecht met
          zijn recept en kostprijs. De prijs op de kaart blijft staan; de verkoopprijs van het
          bestaande gerecht wordt niet gewijzigd.
        </p>

        {result && (
          <Card>
            <CardContent className="py-3 text-sm">
              <p className="flex items-center gap-1 text-success">
                <CircleCheck className="h-4 w-4" />
                {result.linked} kaartregel(s) gekoppeld aan een bestaand gerecht
                {result.deleted > 0 && ` · ${result.deleted} lege dubbele gerecht(en) verwijderd`}
              </p>
              {(result.failed > 0 || result.kept > 0) && (
                <p className="mt-1 text-copper">
                  {result.failed > 0 && `${result.failed} niet gelukt. `}
                  {result.kept > 0 && `${result.kept} dubbel gerecht bewaard (nog in gebruik).`}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {loading ? (
          <p className="text-sm text-muted">Vergelijken met bestaande gerechten…</p>
        ) : proposals.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted">
              Geen dubbele gerechten (meer) gevonden op deze kaart.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="flex items-center gap-1 text-success">
                    <CircleCheck className="h-4 w-4" />
                    {counts.sure} zeker
                  </span>
                  <span className="flex items-center gap-1 text-copper">
                    <TriangleAlert className="h-4 w-4" />
                    {counts.likely} waarschijnlijk
                  </span>
                  <span className="text-muted">{counts.other} alleen gelijkend</span>
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => selectWhere((p) => p.confidence === "zeker")}>
                    Alleen zeker
                  </Button>
                  <Button variant="secondary" onClick={() => selectWhere((p) => p.confidence !== null)}>
                    Zeker + waarschijnlijk
                  </Button>
                  <Button variant="secondary" onClick={() => selectWhere(() => false)}>
                    Niets
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted">
                        <th className="px-4 py-3 font-medium"></th>
                        <th className="px-4 py-3 font-medium">Op de kaart</th>
                        <th className="px-4 py-3 font-medium">Map</th>
                        <th className="px-4 py-3 font-medium">Prijs kaart</th>
                        <th className="px-4 py-3 font-medium">Koppelen aan bestaand gerecht</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposals.map((p) => {
                        const row = rows[p.itemId];
                        const chosen = p.candidates.find((c) => c.recipe_id === row?.recipeId);
                        return (
                          <tr key={p.itemId} className="border-t border-border align-top">
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={row?.selected ?? false}
                                onChange={(e) => updateRow(p.itemId, { selected: e.target.checked })}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-foreground">{p.cardName}</p>
                              <p className="text-xs text-muted">
                                nu: nieuw gerecht ({p.currentRecipe.status})
                                {!p.currentIsEmptyDuplicate && " · heeft al inhoud"}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-muted">{p.folderName}</td>
                            <td className="px-4 py-3">
                              {p.price !== null ? `€ ${Number(p.price).toFixed(2)}` : "—"}
                            </td>
                            <td className="px-4 py-3">
                              {p.confidence === "zeker" ? (
                                <p className="mb-1 flex items-center gap-1 text-xs text-success">
                                  <CircleCheck className="h-3.5 w-3.5" />
                                  Zelfde gerecht
                                </p>
                              ) : p.confidence === "waarschijnlijk" ? (
                                <p className="mb-1 flex items-center gap-1 text-xs text-copper">
                                  <TriangleAlert className="h-3.5 w-3.5" />
                                  Waarschijnlijk — controleer
                                </p>
                              ) : (
                                <p className="mb-1 flex items-center gap-1 text-xs text-muted">
                                  Lijkt erop — alleen koppelen als het hetzelfde is
                                </p>
                              )}
                              <select
                                value={row?.recipeId ?? ""}
                                onChange={(e) =>
                                  updateRow(p.itemId, { recipeId: e.target.value, selected: true })
                                }
                                className="block h-8 w-full min-w-64 rounded border border-border bg-surface px-2 text-[0.8125rem]"
                              >
                                {p.candidates.map((c) => (
                                  <option key={c.recipe_id} value={c.recipe_id}>
                                    {c.recipe_name}
                                    {c.sales_price !== null ? ` (€ ${Number(c.sales_price).toFixed(2)})` : ""}
                                    {c.status ? ` · ${c.status}` : ""}
                                    {c.is_exact ? "" : ` · ${Math.round(c.similarity_score * 100)}%`}
                                  </option>
                                ))}
                              </select>
                              {chosen &&
                                chosen.sales_price !== null &&
                                p.price !== null &&
                                Math.abs(Number(chosen.sales_price) - Number(p.price)) >= 0.01 && (
                                  <p className="mt-1 text-xs text-copper">
                                    Verkoopprijs gerecht € {Number(chosen.sales_price).toFixed(2)} wijkt
                                    af van kaart € {Number(p.price).toFixed(2)} — wordt niet aangepast.
                                  </p>
                                )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={deleteEmpty}
                onChange={(e) => setDeleteEmpty(e.target.checked)}
              />
              <span>
                Lege dubbele gerechten daarna verwijderen
                <span className="block text-xs text-muted">
                  Alleen concept-gerechten zonder ingrediënten die na het koppelen nergens meer
                  op een kaart staan. Gerechten met inhoud blijven altijd bewaard.
                </span>
              </span>
            </label>

            {error && <p className="text-sm text-danger">{error}</p>}

            <Button onClick={handleApply} disabled={saving || selectedCount === 0}>
              <Link2 className="h-4 w-4" />
              {saving ? "Bezig…" : `${selectedCount} gerecht(en) koppelen`}
            </Button>
          </>
        )}
      </main>
    </>
  );
}

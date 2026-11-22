"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Link2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { IngredientSearch, type PickedIngredient } from "@/components/recipes/ingredient-search";
import { createClient } from "@/lib/supabase/client";
import {
  groupAttentionItems,
  ISSUE_LABEL,
  type AttentionGroup,
  type AttentionItem,
  type CostIssueKind,
} from "@/lib/costing/status";

const KIND_TITLE: Record<CostIssueKind, string> = {
  koppeling: "Niet gekoppeld",
  prijs: "Geen inkoopprijs",
  omrekening: "Eenheid niet om te rekenen",
  opbrengst: "Halfproduct zonder opbrengst",
};

const PAGE = 25;

function recipeHref(i: AttentionItem): string | null {
  if (!i.recipe_id) return null;
  return i.recipe_kind === "halfproduct"
    ? `/halfproducten/${i.recipe_id}/bewerken`
    : `/recepturen/${i.recipe_id}/bewerken`;
}

/**
 * Opschonen voor de kostprijs: alles waardoor een kostprijs onvolledig is,
 * met voorrang voor wat op actieve menukaarten en buffetten staat.
 * Een terugkerende ongekoppelde naam koppel je hier één keer, op de
 * recepten die je zelf aanvinkt.
 */
export function CostCleanup({
  unmatchedScope,
  onCount,
}: {
  /**
   * Vanaf het dashboard: alleen niet-gekoppelde receptregels, met precies
   * de filters van de tegel (bedrijf, actuele kaart).
   */
  unmatchedScope?: { companyIds: string[] | null; onlyCurrent: boolean };
  /** Aantal regels en namen, voor de filterbalk. */
  onCount?: (lines: number, names: number) => void;
} = {}) {
  const { activeCompanyIds } = useCompanyScope();
  const companyId = unmatchedScope?.companyIds?.[0] ?? activeCompanyIds[0] ?? null;
  const scopeKey = unmatchedScope ? JSON.stringify(unmatchedScope) : null;
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [kindFilter, setKindFilter] = useState<CostIssueKind | "alle">("alle");
  const [onlyActive, setOnlyActive] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const scoped = scopeKey ? (JSON.parse(scopeKey) as { companyIds: string[] | null; onlyCurrent: boolean }) : null;
      const res = scoped
        ? await createClient().rpc("dashboard_unmatched_lines", {
            p_company_ids: scoped.companyIds,
            p_only_current: scoped.onlyCurrent,
          })
        : companyId
          ? await createClient().rpc("cost_attention_items", { p_company_id: companyId })
          : null;
      if (cancelled) return;
      if (res?.error) setError("Kan de aandachtspunten niet laden: " + res.error.message);
      else setItems((res?.data ?? []) as AttentionItem[]);
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [companyId, reload, scopeKey]);

  const groups = useMemo(() => groupAttentionItems(items), [items]);
  useEffect(() => {
    if (!loading) onCount?.(items.length, groups.length);
  }, [loading, items.length, groups.length, onCount]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { alle: groups.length };
    for (const g of groups) c[g.kind] = (c[g.kind] ?? 0) + 1;
    return c;
  }, [groups]);
  const filtered = groups.filter(
    (g) => (kindFilter === "alle" || g.kind === kindFilter) && (!onlyActive || g.activeCount > 0),
  );
  const activeGroups = groups.filter((g) => g.activeCount > 0).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {unmatchedScope
            ? `Niet-gekoppelde receptregels — ${items.length} regels in ${groups.length} namen`
            : `Kostprijs onvolledig — op te schonen (${groups.length})`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">
          Regels zonder koppeling, inkoopprijs of eenheidsomrekening maken een kostprijs onvolledig.
          Wat op een <strong>actieve menukaart</strong> of in een <strong>komend buffet</strong> staat
          (ook via een halfproduct) staat bovenaan.
          {activeGroups > 0 && <> {activeGroups} daarvan zijn nu in gebruik.</>}
        </p>

        {message && (
          <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-success">{message}</p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        {!companyId && !unmatchedScope && (
          <p className="text-sm text-muted">Kies een bedrijf om de inkoopprijzen te controleren.</p>
        )}

        {groups.length > 0 && !unmatchedScope && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {(["alle", "koppeling", "prijs", "omrekening", "opbrengst"] as const).map((k) =>
              k === "alle" || counts[k] ? (
                <Button
                  key={k}
                  size="sm"
                  variant={kindFilter === k ? "primary" : "secondary"}
                  onClick={() => {
                    setKindFilter(k);
                    setLimit(PAGE);
                  }}
                >
                  {k === "alle" ? "Alles" : KIND_TITLE[k]} ({counts[k] ?? 0})
                </Button>
              ) : null,
            )}
            <label className="ml-auto flex items-center gap-1.5 text-muted">
              <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
              Alleen actief in gebruik
            </label>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted">Bezig met zoeken…</p>
        ) : (companyId || unmatchedScope) && groups.length === 0 && !error ? (
          <p className="text-sm text-muted">
            {unmatchedScope ? "Alle receptregels zijn gekoppeld." : "Alle kostprijzen zijn volledig."}
          </p>
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            {filtered.slice(0, limit).map((g) => (
              <GroupRow
                key={g.key}
                group={g}
                companyId={companyId}
                onLinked={(n, target) => {
                  setMessage(`"${g.name}" gekoppeld aan ${target} in ${n} regel(s).`);
                  setReload((r) => r + 1);
                }}
              />
            ))}
          </div>
        )}
        {filtered.length > limit && (
          <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
            Toon meer ({filtered.length - limit})
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function GroupRow({
  group,
  companyId,
  onLinked,
}: {
  group: AttentionGroup;
  companyId: string | null;
  onLinked: (count: number, targetName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<PickedIngredient | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fixHref =
    group.product_id && group.kind !== "koppeling"
      ? `/producten/${group.product_id}/bewerken`
      : group.sub_recipe_id
        ? `/halfproducten/${group.sub_recipe_id}/bewerken`
        : null;

  function startLink() {
    setOpen(true);
    setError(null);
    setTarget(null);
    // Standaard alle getroffen regels aangevinkt; de beheerder kiest zelf.
    setSelected(new Set(group.items.map((i) => i.line_id)));
    setSearching(true);
  }

  // Een halfproduct niet in zichzelf koppelen.
  const selfLinked = (i: AttentionItem) => target?.type === "halfproduct" && i.recipe_id === target.id;

  async function applyLink() {
    if (!target) return;
    const lineIds = group.items.filter((i) => selected.has(i.line_id) && !selfLinked(i)).map((i) => i.line_id);
    if (lineIds.length === 0) {
      setError("Vink minstens één recept aan.");
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: rpcError } = await createClient().rpc("link_unmatched_lines", {
      p_line_ids: lineIds,
      p_product_id: target.type === "ingrediënt" ? target.id : null,
      p_sub_recipe_id: target.type === "halfproduct" ? target.id : null,
    });
    setSaving(false);
    if (rpcError) {
      setError("Koppelen mislukt: " + rpcError.message);
      return;
    }
    setOpen(false);
    onLinked(Number(data ?? 0), `${target.type} "${target.name}"`);
  }

  return (
    <div className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <TriangleAlert className={group.activeCount > 0 ? "h-4 w-4 text-copper" : "h-4 w-4 text-muted"} />
        <span className="font-medium text-foreground">{group.name}</span>
        <span className="text-xs text-muted">{ISSUE_LABEL[group.kind]}</span>
        <span className="text-xs text-muted">
          {group.recipeCount} recept{group.recipeCount === 1 ? "" : "en"}
          {group.activeCount > 0 && (
            <span className="text-copper"> · {group.activeCount} actief</span>
          )}
        </span>
        {group.activeSources.length > 0 && (
          <span className="text-xs text-muted" title={group.activeSources.join("\n")}>
            {group.activeSources.slice(0, 2).join(", ")}
            {group.activeSources.length > 2 && ` +${group.activeSources.length - 2}`}
          </span>
        )}
        <span className="ml-auto flex gap-2">
          {group.kind === "koppeling" ? (
            <Button size="sm" onClick={startLink} disabled={!companyId}>
              <Link2 className="h-3.5 w-3.5" />
              Koppelen…
            </Button>
          ) : (
            fixHref && (
              <Link href={fixHref} className="text-teal hover:underline">
                Oplossen →
              </Link>
            )
          )}
          <button type="button" className="text-xs text-muted hover:text-foreground" onClick={() => setOpen((o) => !o)}>
            {open ? "Verbergen" : "Recepten"}
          </button>
        </span>
      </div>

      {group.kind === "koppeling" && searching && (
        <IngredientSearch
          companyId={companyId}
          hideTrigger
          open={searching}
          onOpenChange={setSearching}
          initialQuery={group.name}
          onPick={(picked) => {
            setTarget(picked);
            setSearching(false);
          }}
        />
      )}

      {open && (
        <div className="space-y-2 rounded-md border border-border bg-background p-3">
          {group.kind === "koppeling" && (
            <p className="text-xs">
              {target ? (
                <>
                  Koppelen aan {target.type}{" "}
                  <strong className="text-foreground">&quot;{target.name}&quot;</strong>{" "}
                  <button type="button" className="text-teal hover:underline" onClick={() => setSearching(true)}>
                    ander kiezen
                  </button>
                </>
              ) : (
                <button type="button" className="text-teal hover:underline" onClick={() => setSearching(true)}>
                  Kies het juiste ingrediënt of halfproduct…
                </button>
              )}
            </p>
          )}
          <p className="text-xs text-muted">
            {group.kind === "koppeling"
              ? "Deze recepten worden geraakt. Vink uit waar de koppeling niet hoort:"
              : "Hier komt het voor:"}
          </p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {group.items.map((i) => {
              const href = recipeHref(i);
              const self = selfLinked(i);
              return (
                <li key={i.line_id} className="flex items-center gap-2 text-xs">
                  {group.kind === "koppeling" && (
                    <input
                      type="checkbox"
                      disabled={self}
                      checked={selected.has(i.line_id) && !self}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(i.line_id);
                          else next.delete(i.line_id);
                          return next;
                        })
                      }
                    />
                  )}
                  {href ? (
                    <Link href={href} className="text-foreground hover:text-teal hover:underline">
                      {i.recipe_name}
                    </Link>
                  ) : (
                    <span className="text-foreground">{i.recipe_name}</span>
                  )}
                  <span className="text-muted">
                    {i.recipe_kind === "buffet" ? "buffet" : i.recipe_kind}
                    {i.unit_name ? ` · in ${i.unit_name}` : ""}
                  </span>
                  {i.active_sources.length > 0 && (
                    <span className="rounded bg-copper/10 px-1 text-copper" title={i.active_sources.join("\n")}>
                      actief
                    </span>
                  )}
                  {self && <span className="text-muted">(is dit halfproduct zelf)</span>}
                </li>
              );
            })}
          </ul>
          {group.kind === "koppeling" && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={applyLink} disabled={!target || saving}>
                {saving
                  ? "Bezig…"
                  : `Koppelen in ${group.items.filter((i) => selected.has(i.line_id) && !selfLinked(i)).length} regel(s)`}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
                Annuleren
              </Button>
              {error && <span className="text-xs text-danger">{error}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

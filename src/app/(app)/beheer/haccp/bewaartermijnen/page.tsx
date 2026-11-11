"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/components/permissions/permissions-context";
import { useCompanyScope } from "@/components/company-context";
import {
  ProductSearch,
  type StickerProduct,
} from "@/components/stickers/sticker-form";
import { haccpError } from "@/lib/haccp/cleaning";
import type {
  AuditLogEntry,
  StickerFreezerCategory,
  StickerProductSettings,
  UserProfile,
} from "@/lib/types/database";

function fmt(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BewaartermijnenPage() {
  const { can, isGroupAdmin } = usePermissions();
  const canEdit = can("stickers_beheer").canEdit;
  const { activeCompanyIds } = useCompanyScope();

  const [cats, setCats] = useState<StickerFreezerCategory[]>([]);
  const [settings, setSettings] = useState<StickerProductSettings[]>([]);
  const [names, setNames] = useState<
    Record<string, { name: string; kind: string }>
  >({});
  const [people, setPeople] = useState<Record<string, string>>({});
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, Partial<StickerFreezerCategory>>
  >({});
  const [newCat, setNewCat] = useState({ name: "", months: "" });

  const load = useCallback(async () => {
    const supabase = createClient();
    const [c, s, u] = await Promise.all([
      supabase
        .from("sticker_freezer_categories")
        .select("*")
        .order("sort_order")
        .order("name"),
      supabase
        .from("sticker_product_settings")
        .select("*")
        .order("updated_at", { ascending: false }),
      supabase.from("user_profiles").select("*").order("full_name"),
    ]);
    if (c.error) setError(haccpError(c.error));
    const catList = (c.data as StickerFreezerCategory[]) ?? [];
    const setList = (s.data as StickerProductSettings[]) ?? [];
    setCats(catList);
    setSettings(setList);
    const profs = (u.data as UserProfile[]) ?? [];
    setProfiles(profs);
    setPeople(Object.fromEntries(profs.map((p) => [p.id, p.full_name])));

    const recipeIds = setList
      .map((x) => x.recipe_id)
      .filter(Boolean) as string[];
    const productIds = setList
      .map((x) => x.product_id)
      .filter(Boolean) as string[];
    const map: Record<string, { name: string; kind: string }> = {};
    for (let i = 0; i < recipeIds.length; i += 200) {
      const { data } = await supabase
        .from("recipes")
        .select("id, name, recipe_kind")
        .in("id", recipeIds.slice(i, i + 200));
      for (const r of data ?? [])
        map[r.id] = {
          name: r.name,
          kind: r.recipe_kind === "halfproduct" ? "Halfproduct" : "Gerecht",
        };
    }
    for (let i = 0; i < productIds.length; i += 200) {
      const { data } = await supabase
        .from("products")
        .select("id, name, custom_name")
        .in("id", productIds.slice(i, i + 200));
      for (const p of data ?? [])
        map[p.id] = { name: p.custom_name || p.name, kind: "Ingrediënt" };
    }
    setNames(map);

    const { data: a } = await supabase
      .from("audit_log")
      .select("*")
      .in("table_name", [
        "sticker_freezer_categories",
        "sticker_product_settings",
      ])
      .order("changed_at", { ascending: false })
      .limit(100);
    setAudit((a as AuditLogEntry[]) ?? []);
  }, []);

  useEffect(() => {
    // load() zet pas state na het ophalen (asynchroon).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function run(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setError(null);
    setNotice(null);
    const { error: err } = await fn();
    if (err) {
      setError(haccpError(err));
      return false;
    }
    setNotice(ok);
    await load();
    return true;
  }

  async function saveCat(c: StickerFreezerCategory) {
    const d = drafts[c.id];
    if (!d) return;
    const ok = await run(
      () =>
        createClient()
          .from("sticker_freezer_categories")
          .update(d)
          .eq("id", c.id),
      `${c.name} opgeslagen${d.months !== undefined || d.storage_temp !== undefined ? " — opnieuw goedkeuren nodig" : ""}.`,
    );
    if (ok) setDrafts((x) => ({ ...x, [c.id]: undefined as never }));
  }

  const unapproved = cats.filter(
    (c) => c.is_active && c.months && !c.approved_at,
  );

  return (
    <>
      <Topbar title="Bewaartermijnen (HACCP)" />
      <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <p className="text-sm text-muted">
          Standaard bewaartermijnen voor diepvriesstickers (bij -18 °C of
          kouder) en productspecifieke uitzonderingen. Een termijn wordt pas
          automatisch op stickers gebruikt nadat een bevoegde beheerder hem
          heeft goedgekeurd. De lijst is indicatief — controleer hem tegen
          jullie HACCP-plan.
          {!canEdit && " Je kunt dit overzicht alleen bekijken."}
        </p>
        {error && (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-md bg-teal/10 px-3 py-2 text-sm text-teal">
            {notice}
          </p>
        )}

        {/* Diepvriescategorieën */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Diepvries — productgroepen</CardTitle>
            {canEdit && unapproved.length > 0 && (
              <Button
                size="sm"
                onClick={() => {
                  if (
                    !window.confirm(
                      `${unapproved.length} termijnen goedkeuren? Doe dit alleen als je ze hebt gecontroleerd tegen het HACCP-plan.`,
                    )
                  )
                    return;
                  void run(
                    () =>
                      createClient()
                        .from("sticker_freezer_categories")
                        .update({ approved_at: new Date().toISOString() })
                        .in(
                          "id",
                          unapproved.map((c) => c.id),
                        ),
                    `${unapproved.length} termijnen goedgekeurd.`,
                  );
                }}
              >
                <Check className="h-4 w-4" /> Alle {unapproved.length}{" "}
                goedkeuren
              </Button>
            )}
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Productgroep</th>
                  <th className="px-4 py-2 font-medium">Termijn (mnd)</th>
                  <th className="px-4 py-2 font-medium">Bewaartemperatuur</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => {
                  const d = drafts[c.id] ?? {};
                  const dirty = Object.keys(d).length > 0;
                  return (
                    <tr
                      key={c.id}
                      className={cn(
                        "border-t border-border",
                        !c.is_active && "opacity-50",
                      )}
                    >
                      <td className="px-4 py-2 font-medium text-foreground">
                        {c.name}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={1}
                          max={36}
                          disabled={!canEdit}
                          value={
                            d.months !== undefined
                              ? (d.months ?? "")
                              : (c.months ?? "")
                          }
                          placeholder="handmatig"
                          onChange={(e) =>
                            setDrafts((x) => ({
                              ...x,
                              [c.id]: {
                                ...x[c.id],
                                months:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              },
                            }))
                          }
                          className="input w-24!"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          disabled={!canEdit}
                          value={d.storage_temp ?? c.storage_temp}
                          onChange={(e) =>
                            setDrafts((x) => ({
                              ...x,
                              [c.id]: {
                                ...x[c.id],
                                storage_temp: e.target.value,
                              },
                            }))
                          }
                          className="input w-44!"
                        />
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {!c.months ? (
                          <span className="text-muted">datum per sticker</span>
                        ) : c.approved_at ? (
                          <span className="text-teal">
                            ✓ {people[c.approved_by ?? ""] ?? ""} ·{" "}
                            {fmt(c.approved_at)}
                          </span>
                        ) : (
                          <span className="text-copper">
                            nog niet goedgekeurd
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        {canEdit && dirty && (
                          <Button size="sm" onClick={() => void saveCat(c)}>
                            Opslaan
                          </Button>
                        )}
                        {canEdit && !dirty && c.months && !c.approved_at && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              void run(
                                () =>
                                  createClient()
                                    .from("sticker_freezer_categories")
                                    .update({
                                      approved_at: new Date().toISOString(),
                                    })
                                    .eq("id", c.id),
                                `${c.name} goedgekeurd.`,
                              )
                            }
                          >
                            Goedkeuren
                          </Button>
                        )}
                        {canEdit && !dirty && (
                          <button
                            onClick={() =>
                              void run(
                                () =>
                                  createClient()
                                    .from("sticker_freezer_categories")
                                    .update({ is_active: !c.is_active })
                                    .eq("id", c.id),
                                c.is_active
                                  ? `${c.name} verborgen.`
                                  : `${c.name} weer actief.`,
                              )
                            }
                            className="ml-2 text-xs text-muted underline"
                          >
                            {c.is_active ? "verbergen" : "activeren"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {canEdit && (
                  <tr className="border-t border-border bg-background">
                    <td className="px-4 py-2">
                      <input
                        value={newCat.name}
                        onChange={(e) =>
                          setNewCat({ ...newCat, name: e.target.value })
                        }
                        placeholder="Nieuwe productgroep"
                        className="input"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={1}
                        max={36}
                        value={newCat.months}
                        onChange={(e) =>
                          setNewCat({ ...newCat, months: e.target.value })
                        }
                        placeholder="mnd"
                        className="input w-24!"
                      />
                    </td>
                    <td colSpan={3} className="px-4 py-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!newCat.name.trim()}
                        onClick={async () => {
                          const ok = await run(
                            () =>
                              createClient()
                                .from("sticker_freezer_categories")
                                .insert({
                                  name: newCat.name.trim(),
                                  months: newCat.months
                                    ? Number(newCat.months)
                                    : null,
                                  sort_order: 185,
                                }),
                            "Productgroep toegevoegd — nog goedkeuren.",
                          );
                          if (ok) setNewCat({ name: "", months: "" });
                        }}
                      >
                        <Plus className="h-4 w-4" /> Toevoegen
                      </Button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Productspecifiek */}
        <ProductExceptions
          canEdit={canEdit}
          cats={cats}
          settings={settings}
          names={names}
          people={people}
          companyId={activeCompanyIds[0] ?? ""}
          run={run}
        />

        {/* Gedeelde accounts */}
        {isGroupAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Gedeelde keukenaccounts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted">
                Op een gedeeld account (tablet of keukencomputer) moet de
                medewerker zich eerst met zijn pincode melden voordat er een
                sticker kan worden afgedrukt. Pincodes stel je in bij HACCP →
                Instellingen.
              </p>
              <div className="flex flex-wrap gap-2">
                {profiles
                  .filter((p) => p.is_active)
                  .map((p) => (
                    <label
                      key={p.id}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm",
                        p.is_shared_account
                          ? "border-copper bg-copper/10"
                          : "border-border",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(p.is_shared_account)}
                        onChange={(e) =>
                          void run(
                            () =>
                              createClient()
                                .from("user_profiles")
                                .update({ is_shared_account: e.target.checked })
                                .eq("id", p.id),
                            `${p.full_name}: ${e.target.checked ? "gedeeld account" : "persoonlijk account"}.`,
                          )
                        }
                      />
                      {p.full_name}
                    </label>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Wijzigingshistorie */}
        {isGroupAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Wijzigingshistorie</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {audit.length === 0 ? (
                <p className="p-4 text-sm text-muted">Nog geen wijzigingen.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a.id} className="border-t border-border">
                        <td className="whitespace-nowrap px-4 py-2 text-muted">
                          {fmt(a.changed_at)}
                        </td>
                        <td className="px-4 py-2">
                          {people[a.changed_by ?? ""] ?? "systeem"}
                        </td>
                        <td className="px-4 py-2">
                          {describeChange(a, names)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}

function describeChange(
  a: AuditLogEntry,
  names: Record<string, { name: string }>,
): string {
  const n = (a.new_data ?? {}) as Record<string, unknown>;
  const o = (a.old_data ?? {}) as Record<string, unknown>;
  const subject =
    a.table_name === "sticker_freezer_categories"
      ? String(n.name ?? o.name ?? "productgroep")
      : (names[
          String(
            n.recipe_id ?? n.product_id ?? o.recipe_id ?? o.product_id ?? "",
          )
        ]?.name ?? "product");
  if (a.action === "insert") return `${subject}: aangemaakt`;
  if (a.action === "delete") return `${subject}: verwijderd`;
  const parts: string[] = [];
  const label: Record<string, string> = {
    months: "termijn (mnd)",
    storage_temp: "temperatuur",
    is_active: "actief",
    approved_at: "goedkeuring",
    freezer_category_id: "productgroep",
    freezer_months: "diepvries (mnd)",
    fresh_days: "vers (dagen)",
    name: "naam",
  };
  for (const k of Object.keys(label)) {
    if (JSON.stringify(o[k]) !== JSON.stringify(n[k]) && (k in n || k in o)) {
      if (k === "approved_at")
        parts.push(n[k] ? "goedgekeurd" : "goedkeuring vervallen");
      else if (k === "freezer_category_id")
        parts.push("productgroep gewijzigd");
      else parts.push(`${label[k]}: ${o[k] ?? "—"} → ${n[k] ?? "—"}`);
    }
  }
  return `${subject}: ${parts.join(", ") || "bijgewerkt"}`;
}

function ProductExceptions({
  canEdit,
  cats,
  settings,
  names,
  people,
  companyId,
  run,
}: {
  canEdit: boolean;
  cats: StickerFreezerCategory[];
  settings: StickerProductSettings[];
  names: Record<string, { name: string; kind: string }>;
  people: Record<string, string>;
  companyId: string;
  run: (
    fn: () => PromiseLike<{ error: unknown }>,
    ok: string,
  ) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState<StickerProduct | null>(null);
  const [filter, setFilter] = useState("");
  const shown = settings.filter((s) => {
    const nm = names[s.recipe_id ?? s.product_id ?? ""]?.name ?? "";
    return !filter || nm.toLowerCase().includes(filter.toLowerCase());
  });

  async function update(
    s: StickerProductSettings,
    patch: Partial<StickerProductSettings>,
    msg: string,
  ) {
    await run(
      () =>
        createClient()
          .from("sticker_product_settings")
          .update(patch)
          .eq("id", s.id),
      msg,
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Productspecifieke uitzonderingen</CardTitle>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter op product"
          className="input w-56!"
        />
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">
          Een productspecifieke termijn gaat altijd voor de productgroep. De
          productgroep wordt ook automatisch onthouden zodra een medewerker voor
          het eerst een diepvriessticker maakt. De verse termijn van
          halfproducten en gerechten stel je in bij het recept (houdbaarheid).
        </p>
        {canEdit && (
          <div className="rounded-md border border-dashed border-border p-3">
            {adding ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{adding.name}</span>
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!adding.id) return;
                    const ok = await run(
                      () =>
                        createClient()
                          .from("sticker_product_settings")
                          .insert(
                            adding.kind === "recipe"
                              ? { recipe_id: adding.id }
                              : { product_id: adding.id },
                          ),
                      `${adding.name} toegevoegd.`,
                    );
                    if (ok) setAdding(null);
                  }}
                >
                  <Plus className="h-4 w-4" /> Uitzondering toevoegen
                </Button>
                <button
                  onClick={() => setAdding(null)}
                  className="text-sm text-muted underline"
                >
                  annuleren
                </button>
                {!adding.id && (
                  <span className="text-xs text-danger">
                    Kies een bestaand product uit de lijst.
                  </span>
                )}
              </div>
            ) : (
              <ProductSearch
                companyId={companyId}
                value={null}
                onChange={setAdding}
              />
            )}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Product</th>
                <th className="py-2 pr-3 font-medium">
                  Productgroep diepvries
                </th>
                <th className="py-2 pr-3 font-medium">Diepvries (mnd)</th>
                <th className="py-2 pr-3 font-medium">Vers (dagen)</th>
                <th className="py-2 pr-3 font-medium">Vastgesteld door</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-muted">
                    Nog geen productspecifieke instellingen.
                  </td>
                </tr>
              )}
              {shown.map((s) => {
                const n = names[s.recipe_id ?? s.product_id ?? ""];
                const hasTerm =
                  s.freezer_months != null || s.fresh_days != null;
                return (
                  <tr key={s.id} className="border-t border-border">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-foreground">
                        {n?.name ?? "…"}
                      </span>{" "}
                      <span className="text-xs text-muted">{n?.kind}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        disabled={!canEdit}
                        value={s.freezer_category_id ?? ""}
                        onChange={(e) =>
                          void update(
                            s,
                            { freezer_category_id: e.target.value || null },
                            "Productgroep opgeslagen.",
                          )
                        }
                        className="input"
                      >
                        <option value="">—</option>
                        {cats.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {s.category_set_by && (
                        <p className="mt-0.5 text-xs text-muted">
                          gekozen door {people[s.category_set_by] ?? "?"}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <NumberCell
                        disabled={!canEdit}
                        value={s.freezer_months}
                        placeholder={
                          s.freezer_category_id
                            ? `groep: ${cats.find((c) => c.id === s.freezer_category_id)?.months ?? "—"}`
                            : ""
                        }
                        onSave={(v) =>
                          update(
                            s,
                            { freezer_months: v },
                            "Diepvriestermijn vastgesteld.",
                          )
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      {s.product_id ? (
                        <NumberCell
                          disabled={!canEdit}
                          value={s.fresh_days}
                          placeholder="3"
                          onSave={(v) =>
                            update(
                              s,
                              { fresh_days: v },
                              "Verse termijn vastgesteld.",
                            )
                          }
                        />
                      ) : (
                        <span className="text-xs text-muted">via recept</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {hasTerm && s.approved_at ? (
                        <span className="text-teal">
                          ✓ {people[s.approved_by ?? ""] ?? ""} ·{" "}
                          {fmt(s.approved_at)}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {canEdit && (
                        <button
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Uitzondering voor ${n?.name ?? "dit product"} verwijderen? Daarna geldt weer de productgroep.`,
                              )
                            )
                              return;
                            void run(
                              () =>
                                createClient()
                                  .from("sticker_product_settings")
                                  .delete()
                                  .eq("id", s.id),
                              "Uitzondering verwijderd.",
                            );
                          }}
                          className="rounded p-1.5 text-muted hover:text-danger"
                          aria-label="Verwijderen"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Een productspecifieke termijn die je hier vastlegt, geldt direct op
          stickers (alleen beheerders kunnen dit). Leg hem alleen vast als het
          HACCP-plan dat onderbouwt; elke wijziging staat in de
          wijzigingshistorie.
        </p>
      </CardContent>
    </Card>
  );
}

function NumberCell({
  value,
  placeholder,
  disabled,
  onSave,
}: {
  value: number | null;
  placeholder?: string;
  disabled?: boolean;
  onSave: (v: number | null) => Promise<void> | void;
}) {
  const [v, setV] = useState<string>(value == null ? "" : String(value));
  return (
    <input
      type="number"
      min={0}
      disabled={disabled}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const next = v.trim() === "" ? null : Number(v);
        if (next !== value) void onSave(next);
      }}
      className="input w-24!"
    />
  );
}

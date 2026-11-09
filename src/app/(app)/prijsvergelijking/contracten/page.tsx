"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Search, Trash2 } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { PageActions } from "@/components/layout/page-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { SupplierContractPrice } from "@/lib/types/database";
import { euro, shortDate } from "@/lib/price-comparison";

interface Option {
  id: string;
  name: string;
}

interface ArticleHit {
  key: string;
  productId: string;
  productName: string;
  articleNumber: string | null;
  packaging: string | null;
  price: number | null;
}

interface Draft {
  supplierId: string;
  productId: string | null;
  productName: string;
  articleNumber: string;
  description: string;
  packaging: string;
  price: string;
  validFrom: string;
  validTo: string;
  companyId: string;
  note: string;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EMPTY_DRAFT: Draft = {
  supplierId: "",
  productId: null,
  productName: "",
  articleNumber: "",
  description: "",
  packaging: "",
  price: "",
  validFrom: today(),
  validTo: "",
  companyId: "",
  note: "",
};

const inputCls =
  "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm";

export default function ContractprijzenPage() {
  const { companies } = useCompanyScope();
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [contracts, setContracts] = useState<SupplierContractPrice[]>([]);
  const [productNames, setProductNames] = useState<Map<string, string>>(
    new Map(),
  );
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      supabase.from("suppliers").select("id, name").order("name"),
      supabase
        .from("supplier_contract_prices")
        .select("*")
        .order("valid_from", { ascending: false }),
    ]).then(async ([sup, con]) => {
      if (cancelled) return;
      const list = (con.data ?? []) as SupplierContractPrice[];
      const ids = [
        ...new Set(list.map((c) => c.product_id).filter(Boolean)),
      ] as string[];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data } = await supabase
          .from("products")
          .select("id, name")
          .in("id", ids);
        for (const p of data ?? []) names.set(p.id, p.name);
      }
      if (cancelled) return;
      setSuppliers((sup.data ?? []) as Option[]);
      setContracts(list);
      setProductNames(names);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  const supplierName = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s.name])),
    [suppliers],
  );
  const companyName = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name])),
    [companies],
  );

  async function save() {
    if (!draft) return;
    const price = Number(draft.price.replace(",", "."));
    if (!draft.supplierId) return setError("Kies een leverancier.");
    if (!draft.productId && !draft.articleNumber.trim())
      return setError("Kies een artikel of vul een artikelnummer in.");
    if (!(price > 0))
      return setError("Vul een geldige prijs per verpakking in.");
    if (draft.validTo && draft.validTo < draft.validFrom)
      return setError("De einddatum ligt vóór de begindatum.");
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("supplier_contract_prices")
      .insert({
        supplier_id: draft.supplierId,
        product_id: draft.productId,
        article_number: draft.articleNumber.trim() || null,
        description: draft.description.trim() || draft.productName || null,
        packaging_description: draft.packaging.trim() || null,
        price,
        valid_from: draft.validFrom,
        valid_to: draft.validTo || null,
        company_id: draft.companyId || null,
        note: draft.note.trim() || null,
      });
    setSaving(false);
    if (insertError) {
      setError(`Opslaan lukte niet: ${insertError.message}`);
      return;
    }
    setDraft(null);
    setReloadTick((n) => n + 1);
  }

  async function remove(id: string) {
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("supplier_contract_prices")
      .delete()
      .eq("id", id);
    setConfirmDelete(null);
    if (deleteError) {
      setError(`Verwijderen lukte niet: ${deleteError.message}`);
      return;
    }
    setContracts((prev) => prev.filter((c) => c.id !== id));
  }

  const todayIso = today();

  return (
    <>
      <Topbar title="Contractprijzen" />
      <PageActions>
        <Link href="/prijsvergelijking">
          <Button variant="secondary" size="sm">
            <ArrowLeft className="h-4 w-4" /> Prijsvergelijking
          </Button>
        </Link>
        {!draft && (
          <Button
            size="sm"
            onClick={() => setDraft({ ...EMPTY_DRAFT, validFrom: today() })}
          >
            <Plus className="h-4 w-4" /> Contractprijs toevoegen
          </Button>
        )}
        {draft && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDraft(null)}
              disabled={saving}
            >
              Annuleren
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Opslaan…" : "Opslaan"}
            </Button>
          </>
        )}
      </PageActions>
      <main className="space-y-4 p-4 md:p-6">
        <p className="text-sm text-muted">
          Een contractprijs gaat in de prijsvergelijking vóór de prijslijst.
          Wordt er meer gefactureerd dan afgesproken, dan krijgt die regel
          altijd prioriteit 1. De prijs is per verpakking, exclusief btw — zoals
          op de factuur.
        </p>

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {draft && (
          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="text-muted">Leverancier</span>
                <select
                  value={draft.supplierId}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      supplierId: e.target.value,
                      productId: null,
                      productName: "",
                    })
                  }
                  className={inputCls}
                >
                  <option value="">Kies…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="space-y-1 text-sm md:col-span-2">
                <span className="text-muted">Artikel</span>
                <ArticlePicker
                  supplierId={draft.supplierId}
                  selected={draft.productId ? draft.productName : null}
                  onPick={(hit) =>
                    setDraft({
                      ...draft,
                      productId: hit.productId,
                      productName: hit.productName,
                      articleNumber: hit.articleNumber ?? draft.articleNumber,
                      packaging: hit.packaging ?? draft.packaging,
                      price:
                        draft.price ||
                        (hit.price ? String(hit.price).replace(".", ",") : ""),
                    })
                  }
                  onClear={() =>
                    setDraft({ ...draft, productId: null, productName: "" })
                  }
                />
              </div>
              <label className="space-y-1 text-sm">
                <span className="text-muted">Artikelnummer leverancier</span>
                <input
                  value={draft.articleNumber}
                  onChange={(e) =>
                    setDraft({ ...draft, articleNumber: e.target.value })
                  }
                  className={inputCls}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted">Verpakking</span>
                <input
                  value={draft.packaging}
                  onChange={(e) =>
                    setDraft({ ...draft, packaging: e.target.value })
                  }
                  placeholder="bv. 24x20cl"
                  className={inputCls}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted">
                  Contractprijs per verpakking (excl. btw)
                </span>
                <input
                  inputMode="decimal"
                  value={draft.price}
                  onChange={(e) =>
                    setDraft({ ...draft, price: e.target.value })
                  }
                  placeholder="0,00"
                  className={inputCls}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted">Geldig vanaf</span>
                <input
                  type="date"
                  value={draft.validFrom}
                  onChange={(e) =>
                    setDraft({ ...draft, validFrom: e.target.value })
                  }
                  className={inputCls}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted">
                  Geldig t/m (leeg = doorlopend)
                </span>
                <input
                  type="date"
                  value={draft.validTo}
                  onChange={(e) =>
                    setDraft({ ...draft, validTo: e.target.value })
                  }
                  className={inputCls}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted">Geldt voor</span>
                <select
                  value={draft.companyId}
                  onChange={(e) =>
                    setDraft({ ...draft, companyId: e.target.value })
                  }
                  className={inputCls}
                >
                  <option value="">Alle bedrijven</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm md:col-span-3">
                <span className="text-muted">
                  Notitie (bv. afspraak met vertegenwoordiger)
                </span>
                <input
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  className={inputCls}
                />
              </label>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 font-medium">Leverancier</th>
                    <th className="px-3 py-2 font-medium">Art.nr</th>
                    <th className="px-3 py-2 font-medium">Artikel</th>
                    <th className="px-3 py-2 font-medium">Verpakking</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Contractprijs
                    </th>
                    <th className="px-3 py-2 font-medium">Geldig</th>
                    <th className="px-3 py-2 font-medium">Bedrijf</th>
                    <th className="px-3 py-2 font-medium">Notitie</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((c) => {
                    const expired =
                      c.valid_to !== null && c.valid_to < todayIso;
                    return (
                      <tr
                        key={c.id}
                        className={cn(
                          "border-t border-border",
                          expired && "text-muted",
                        )}
                      >
                        <td className="px-3 py-2">
                          {supplierName.get(c.supplier_id) ?? "—"}
                        </td>
                        <td className="px-3 py-2 tabular">
                          {c.article_number ?? "—"}
                        </td>
                        <td className="px-3 py-2 font-medium">
                          {(c.product_id && productNames.get(c.product_id)) ??
                            c.description ??
                            "—"}
                        </td>
                        <td className="px-3 py-2">
                          {c.packaging_description ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular font-semibold">
                          {euro(Number(c.price))}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {shortDate(c.valid_from)} –{" "}
                          {c.valid_to ? shortDate(c.valid_to) : "doorlopend"}
                          {expired && (
                            <span className="ml-1 text-xs">(verlopen)</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {c.company_id
                            ? (companyName.get(c.company_id) ?? "—")
                            : "Alle"}
                        </td>
                        <td className="px-3 py-2 text-muted">{c.note ?? ""}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {confirmDelete === c.id ? (
                            <span className="inline-flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => remove(c.id)}
                              >
                                Ja, verwijderen
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmDelete(null)}
                              >
                                Nee
                              </Button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(c.id)}
                              title="Contractprijs verwijderen"
                              className="rounded p-1 text-muted hover:bg-danger/10 hover:text-danger"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {loaded && contracts.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-8 text-center text-muted"
                      >
                        Nog geen contractprijzen vastgelegd.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

function ArticlePicker({
  supplierId,
  selected,
  onPick,
  onClear,
}: {
  supplierId: string;
  selected: string | null;
  onPick: (hit: ArticleHit) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ArticleHit[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!supplierId || q.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const supabase = createClient();
      const like = `%${q.replace(/[%_]/g, "")}%`;
      const { data: products } = await supabase
        .from("products")
        .select("id, name")
        .ilike("name", like)
        .limit(50);
      const productIds = (products ?? []).map((p) => p.id);
      const filters = [`supplier_article_code.ilike.${like}`];
      if (productIds.length)
        filters.push(`product_id.in.(${productIds.join(",")})`);
      const { data: sp } = await supabase
        .from("supplier_products")
        .select(
          "id, product_id, supplier_article_code, packaging_description, purchase_price, valid_to",
        )
        .eq("supplier_id", supplierId)
        .is("valid_to", null)
        .or(filters.join(","))
        .limit(30);
      const missing = [...new Set((sp ?? []).map((s) => s.product_id))].filter(
        (id) => !(products ?? []).some((p) => p.id === id),
      );
      const names = new Map((products ?? []).map((p) => [p.id, p.name]));
      if (missing.length) {
        const { data: extra } = await supabase
          .from("products")
          .select("id, name")
          .in("id", missing);
        for (const p of extra ?? []) names.set(p.id, p.name);
      }
      if (cancelled) return;
      setHits(
        (sp ?? []).map((s) => ({
          key: s.id,
          productId: s.product_id,
          productName: names.get(s.product_id) ?? "onbekend",
          articleNumber: s.supplier_article_code,
          packaging: s.packaging_description,
          price: s.purchase_price === null ? null : Number(s.purchase_price),
        })),
      );
      setOpen(true);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, supplierId]);

  if (selected) {
    return (
      <div className="flex h-9 items-center justify-between rounded-md border border-border bg-background px-2">
        <span className="font-medium">{selected}</span>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-teal hover:underline"
        >
          Ander artikel
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        value={query}
        disabled={!supplierId}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={
          supplierId
            ? "Zoek op naam of artikelnummer…"
            : "Kies eerst een leverancier"
        }
        className={cn(inputCls, "pl-8")}
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
          {hits.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted">
              Niets gevonden bij deze leverancier.
            </div>
          )}
          {hits.map((h) => (
            <button
              key={h.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(h);
                setOpen(false);
                setQuery("");
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-background"
            >
              <span>
                <span className="font-medium">{h.productName}</span>
                <span className="ml-2 text-xs text-muted">
                  {[h.articleNumber, h.packaging].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="tabular text-muted">{euro(h.price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

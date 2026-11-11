"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronUp,
  History,
  Printer,
  RotateCcw,
  Search,
  Snowflake,
  CalendarDays,
  Leaf,
  TriangleAlert,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useCompanyScope } from "@/components/company-context";
import { StaffSelect } from "@/components/haccp/staff-select";
import {
  haccpError,
  isTabletHome,
  readStaffSession,
  writeStaffSession,
  type StaffSession,
} from "@/lib/haccp/cleaning";
import {
  DEFAULT_FREEZER_TEMP,
  addTerm,
  expiryCheck,
  formatDateNL,
  guessFreezerCategory,
  standardTerm,
  todayISO,
  type StickerType,
} from "@/lib/stickers/stickers";
import {
  STICKER_FORMATS,
  StickerLabel,
  StickerPrintArea,
  readStickerFormat,
  writeStickerFormat,
  type StickerLabelData,
} from "@/components/stickers/sticker-label";
import type {
  StickerFreezerCategory,
  StickerProductSettings,
  StickerStaff,
} from "@/lib/types/database";

export interface StickerProduct {
  kind: "recipe" | "product" | "vrij";
  id: string | null;
  name: string;
  /** halfproduct / gerecht / ingrediënt */
  label: string;
  isPrepared: boolean;
  productGroup: string | null;
  rule: string | null;
  days: number | null;
}

interface Batch {
  labelId: string;
  movementId: string;
  producedAt: string;
  expiry: string;
  batchNumber: string | null;
}

const TYPE_BUTTONS: {
  key: StickerType;
  label: string;
  hint: string;
  icon: typeof Leaf;
}[] = [
  {
    key: "productie",
    label: "Productiedatum",
    hint: "alleen datum",
    icon: CalendarDays,
  },
  { key: "vers", label: "Vers", hint: "standaard 3 dagen", icon: Leaf },
  {
    key: "diepvries",
    label: "Diepvries",
    hint: "THT per productgroep",
    icon: Snowflake,
  },
];

function newId(): string {
  return crypto.randomUUID();
}

export function StickerForm({
  companyId,
  initialRecipeId,
  initialProductId,
}: {
  companyId: string;
  initialRecipeId?: string;
  initialProductId?: string;
}) {
  const { companies } = useCompanyScope();
  const company = companies.find((c) => c.id === companyId);
  const companyName = company?.trade_name || company?.name || "";

  // ---------- basisgegevens ----------
  const [staff, setStaff] = useState<StickerStaff[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [categories, setCategories] = useState<StickerFreezerCategory[]>([]);
  const [session, setSession] = useState<StaffSession | null>(() =>
    typeof window === "undefined" ? null : readStaffSession(companyId),
  );
  const [tablet] = useState(() =>
    typeof window === "undefined" ? false : isTabletHome(),
  );

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      supabase.rpc("sticker_staff", { p_company_id: companyId }),
      supabase.auth.getUser(),
      supabase
        .from("sticker_freezer_categories")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
    ]).then(([s, u, c]) => {
      if (cancelled) return;
      setStaff((s.data as StickerStaff[]) ?? []);
      setMeId(u.data.user?.id ?? null);
      setCategories((c.data as StickerFreezerCategory[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const meStaff = staff.find((s) => s.id === meId) ?? null;
  const employee: { id: string; name: string } | null = session
    ? { id: session.staffId, name: session.name }
    : !tablet && meStaff
      ? { id: meStaff.id, name: meStaff.full_name }
      : null;

  // ---------- product ----------
  const [product, setProduct] = useState<StickerProduct | null>(null);
  const [settings, setSettings] = useState<StickerProductSettings | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);

  // ---------- invoer ----------
  const [type, setType] = useState<StickerType | null>(null);
  const [productionDate, setProductionDate] = useState(() => todayISO());
  const [categoryId, setCategoryId] = useState<string>("");
  const [expiryManual, setExpiryManual] = useState<string | null>(null);
  const [termOverride, setTermOverride] = useState<string>("");
  const [batchChoice, setBatchChoice] = useState<string>("auto");
  const [origManual, setOrigManual] = useState("");
  const [origManualKind, setOrigManualKind] = useState<"THT" | "TGT">("THT");
  const [batchNumber, setBatchNumber] = useState("");
  const [quantity, setQuantity] = useState("");
  const [storageTemp, setStorageTemp] = useState("");
  const [note, setNote] = useState("");
  const [productionTime, setProductionTime] = useState("");
  const [count, setCount] = useState(1);
  const [format, setFormat] = useState(() =>
    typeof window === "undefined"
      ? STICKER_FORMATS[0].value
      : readStickerFormat(),
  );
  const [reason, setReason] = useState("");
  const [approverId, setApproverId] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [preview, setPreview] = useState(false);

  // ---------- afdrukken ----------
  const [requestId, setRequestId] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPrint, setLastPrint] = useState<{
    id: string;
    data: StickerLabelData;
    format: string;
    count: number;
  } | null>(null);
  const [printJob, setPrintJob] = useState<{
    data: StickerLabelData;
    format: string;
    count: number;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    if (!printJob) return;
    const t = setTimeout(() => window.print(), 50);
    return () => clearTimeout(t);
  }, [printJob]);

  // ---------- product kiezen ----------
  async function chooseProduct(p: StickerProduct | null) {
    setProduct(p);
    setSettings(null);
    setBatches([]);
    setBatchChoice("auto");
    setExpiryManual(null);
    setTermOverride("");
    setError(null);
    if (!p) {
      setCategoryId("");
      return;
    }
    // Voorlopige categorie op naam, tot de opgeslagen instelling binnen is.
    const guess = guessFreezerCategory(p.name, {
      isPrepared: p.isPrepared,
      productGroup: p.productGroup,
    });
    const byKey = (key: string | null) =>
      key ? (categories.find((c) => c.key === key)?.id ?? "") : "";
    setCategoryId(byKey(guess));
    if (!p.id) return;

    const supabase = createClient();
    const settingsQuery =
      p.kind === "recipe"
        ? supabase
            .from("sticker_product_settings")
            .select("*")
            .eq("recipe_id", p.id)
        : supabase
            .from("sticker_product_settings")
            .select("*")
            .eq("product_id", p.id);
    const { data: s } = await settingsQuery.maybeSingle();
    const set = (s as StickerProductSettings | null) ?? null;
    setSettings(set);
    if (set?.freezer_category_id) setCategoryId(set.freezer_category_id);

    if (p.kind === "recipe") {
      const since = new Date(Date.now() - 21 * 86400000).toISOString();
      const { data: moves } = await supabase
        .from("stock_movements")
        .select("id, created_at, batch_number, expiry_date, company_id")
        .eq("recipe_id", p.id)
        .eq("movement_type", "productie")
        .eq("company_id", companyId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20);
      const ids = (moves ?? []).map((m) => m.id);
      if (ids.length === 0) return;
      const { data: labels } = await supabase
        .from("production_labels")
        .select(
          "id, stock_movement_id, expiry_at, production_at, printed_at, reprint_of",
        )
        .in("stock_movement_id", ids)
        .is("reprint_of", null)
        .order("printed_at", { ascending: false });
      const list: Batch[] = [];
      for (const l of labels ?? []) {
        const m = (moves ?? []).find((x) => x.id === l.stock_movement_id);
        const exp = (l.expiry_at as string | null) ?? m?.expiry_date ?? null;
        if (!m || !exp) continue;
        if (list.some((b) => b.movementId === m.id)) continue;
        list.push({
          labelId: l.id as string,
          movementId: m.id,
          producedAt: (l.production_at as string) ?? m.created_at,
          expiry: exp.slice(0, 10),
          batchNumber: m.batch_number,
        });
      }
      setBatches(list);
    }
  }

  // Vooraf gekozen product (snelknop bij ingrediënt/halfproduct/gerecht).
  const initialDone = useRef(false);
  useEffect(() => {
    if (initialDone.current || categories.length === 0) return;
    if (!initialRecipeId && !initialProductId) return;
    initialDone.current = true;
    const supabase = createClient();
    (async () => {
      if (initialRecipeId) {
        const { data } = await supabase
          .from("recipes")
          .select(
            "id, name, recipe_kind, category, shelf_life_rule, shelf_life_days",
          )
          .eq("id", initialRecipeId)
          .maybeSingle();
        if (data) await chooseProduct(recipeToProduct(data));
      } else if (initialProductId) {
        const { data } = await supabase
          .from("products")
          .select("id, name, custom_name, product_group")
          .eq("id", initialProductId)
          .maybeSingle();
        if (data) await chooseProduct(productToProduct(data));
      }
    })();
    // chooseProduct is een gewone functie; alleen opnieuw als de lijst binnen is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, initialRecipeId, initialProductId]);

  // ---------- afgeleide waarden ----------
  const category = categories.find((c) => c.id === categoryId) ?? null;

  const activeBatch: Batch | null = useMemo(() => {
    if (batchChoice === "geen") return null;
    if (batchChoice === "auto") {
      if (type !== "diepvries") return null;
      return batches.find((b) => b.expiry > productionDate) ?? null;
    }
    return batches.find((b) => b.labelId === batchChoice) ?? null;
  }, [batchChoice, batches, type, productionDate]);

  const orig = activeBatch
    ? {
        date: activeBatch.expiry,
        kind: "TGT" as const,
        source: "batch" as const,
      }
    : origManual
      ? { date: origManual, kind: origManualKind, source: "handmatig" as const }
      : null;

  const std = type
    ? standardTerm({
        type,
        isRecipe: product?.kind === "recipe",
        recipeRule: product?.rule,
        recipeDays: product?.days,
        productFreshDays: settings?.fresh_days,
        productFreezerMonths: settings?.freezer_months,
        categoryMonths: category?.months,
        categoryApproved: Boolean(category?.approved_at),
      })
    : null;

  const termNum =
    termOverride.trim() === "" ? null : Math.max(0, Number(termOverride));
  const autoExpiry =
    std && std.unit && std.term != null
      ? addTerm(productionDate, std.term, std.unit)
      : "";
  let defaultExpiry = autoExpiry;
  // Nooit stilzwijgend voorbij een bestaande THT/TGT (behalve eigen batch
  // die vóór de TGT wordt ingevroren — volgens de procedure).
  if (
    orig &&
    defaultExpiry &&
    defaultExpiry > orig.date &&
    !(type === "diepvries" && orig.source === "batch")
  ) {
    defaultExpiry = orig.date;
  }
  const expiry =
    type === "productie"
      ? ""
      : expiryManual !== null
        ? expiryManual
        : termNum != null && std?.unit
          ? addTerm(productionDate, termNum, std.unit)
          : defaultExpiry;

  const check = type
    ? expiryCheck({
        type,
        productionDate,
        expiryDate: expiry,
        standard: std ?? { term: null, unit: null, source: null },
        originalExpiry: orig?.date,
        originalKind: orig?.kind,
        originalFromBatch: orig?.source === "batch",
      })
    : null;

  const approvers = staff.filter((s) => s.can_approve);
  const effectiveApprover =
    approverId || (meStaff?.can_approve ? meStaff.id : "");
  const effectiveStorage =
    storageTemp.trim() ||
    (type === "diepvries"
      ? category?.storage_temp || DEFAULT_FREEZER_TEMP
      : "");

  const labelData: StickerLabelData | null =
    product && type
      ? {
          type,
          productName: product.name,
          productionDate,
          productionTime: productionTime || null,
          expiryDate: expiry || null,
          storageTemp: effectiveStorage || null,
          employeeName: employee?.name ?? "—",
          companyName,
          batchNumber: batchNumber || activeBatch?.batchNumber || null,
          quantity: quantity || null,
          note: note || null,
        }
      : null;

  const missing: string[] = [];
  if (!product) missing.push("product");
  if (!type) missing.push("stickertype");
  if (type === "diepvries" && !categoryId) missing.push("productgroep");
  if (type && type !== "productie" && !expiry)
    missing.push("houdbaarheidsdatum");
  if (!employee) missing.push("medewerker");
  if (check?.needsReason && !reason.trim()) missing.push("onderbouwing");
  if (check?.needsApproval && !effectiveApprover) missing.push("goedkeuring");
  const canPrint = missing.length === 0 && !check?.error && !busy;

  // ---------- acties ----------
  async function print() {
    if (!canPrint || !product || !type || !employee || !labelData) return;
    setBusy(true);
    setError(null);
    const payload = {
      id: requestId,
      company_id: companyId,
      session_id: session?.sessionId ?? null,
      sticker_type: type,
      recipe_id: product.kind === "recipe" ? product.id : null,
      product_id: product.kind === "product" ? product.id : null,
      product_name: product.name,
      product_group: product.productGroup,
      freezer_category_id: type === "diepvries" ? categoryId : null,
      production_date: productionDate,
      production_time: productionTime || null,
      expiry_date: type === "productie" ? null : expiry,
      original_expiry: orig?.date ?? null,
      original_expiry_kind: orig?.kind ?? null,
      original_source: orig?.source ?? null,
      source_label_id: activeBatch?.labelId ?? null,
      change_reason: reason.trim() || null,
      approver_id: check?.needsApproval ? effectiveApprover : null,
      storage_temp: effectiveStorage || null,
      batch_number: labelData.batchNumber,
      quantity: quantity || null,
      note: note || null,
      sticker_count: count,
      sticker_format: format,
    };
    const { data, error: err } = await createClient().rpc("sticker_print", {
      p: payload,
    });
    setBusy(false);
    if (err || !data) {
      const msg = haccpError(err);
      if (/sessie verlopen/i.test(msg)) {
        writeStaffSession(null, companyId);
        setSession(null);
      }
      setError(msg);
      return;
    }
    const printed = {
      ...labelData,
      employeeName: data.employee_name ?? employee.name,
    };
    setLastPrint({ id: requestId, data: printed, format, count });
    setPrintJob((prev) => ({
      data: printed,
      format,
      count,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
    // Klaar voor de volgende sticker: product en extra's leeg, rest blijft.
    setRequestId(newId());
    setProduct(null);
    setSettings(null);
    setBatches([]);
    setBatchChoice("auto");
    setExpiryManual(null);
    setTermOverride("");
    setOrigManual("");
    setBatchNumber("");
    setQuantity("");
    setNote("");
    setReason("");
    setCount(1);
    setPreview(false);
  }

  async function reprintLast() {
    if (!lastPrint) return;
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("sticker_reprint", {
      p_id: newId(),
      p_original_id: lastPrint.id,
      p_session_id: session?.sessionId ?? null,
      p_count: lastPrint.count,
      p_format: lastPrint.format,
    });
    setBusy(false);
    if (err) {
      setError(haccpError(err));
      return;
    }
    setPrintJob((prev) => ({ ...lastPrint, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  // ---------- weergave ----------
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 print:p-0">
      <div className="grid gap-5 lg:grid-cols-[1fr_auto] print:hidden">
        <div className="space-y-5 rounded-xl border border-border bg-surface p-4 sm:p-5">
          {/* 1. Product */}
          <ProductSearch
            companyId={companyId}
            value={product}
            onChange={(p) => void chooseProduct(p)}
          />

          {/* 2. Stickertype */}
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">
              Stickertype
            </p>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_BUTTONS.map((t) => {
                const Icon = t.icon;
                const active = type === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => {
                      setType(t.key);
                      setExpiryManual(null);
                      setTermOverride("");
                    }}
                    className={cn(
                      "flex h-20 flex-col items-center justify-center gap-1 rounded-lg border-2 px-2 text-center transition-colors",
                      active
                        ? "border-teal bg-teal/10 text-teal"
                        : "border-border bg-background text-foreground hover:border-teal/60",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-sm font-semibold sm:text-base">
                      {t.label}
                    </span>
                    <span className="hidden text-xs text-muted sm:block">
                      {t.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Diepvries: productgroep */}
          {type === "diepvries" && (
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Productgroep <span className="text-danger">*</span>
              </label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setExpiryManual(null);
                }}
                className="input"
              >
                <option value="">— kies productgroep —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} —{" "}
                    {c.months
                      ? `${c.months} ${c.months === 1 ? "maand" : "maanden"}`
                      : "handmatig"}
                    {c.months && !c.approved_at
                      ? " (nog niet goedgekeurd)"
                      : ""}
                  </option>
                ))}
              </select>
              {product && categoryId && !settings?.freezer_category_id && (
                <p className="mt-1 text-xs text-muted">
                  Voorgesteld op basis van de productnaam — controleer en pas zo
                  nodig aan. De keuze wordt onthouden voor dit product.
                </p>
              )}
              {settings?.freezer_months != null && (
                <p className="mt-1 text-xs text-teal">
                  Productspecifieke bewaartermijn: {settings.freezer_months}{" "}
                  maanden (gaat voor de productgroep).
                </p>
              )}
            </div>
          )}

          {/* 3 + 4. Datums */}
          {type && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {type === "diepvries" ? "Invriesdatum" : "Productiedatum"}
                </label>
                <input
                  type="date"
                  value={productionDate}
                  onChange={(e) => {
                    setProductionDate(e.target.value);
                    setExpiryManual(null);
                  }}
                  className="input"
                />
              </div>
              {type !== "productie" && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    {type === "diepvries"
                      ? "THT (houdbaar tot)"
                      : "Te gebruiken tot"}
                  </label>
                  <input
                    type="date"
                    value={expiry}
                    min={productionDate}
                    onChange={(e) => setExpiryManual(e.target.value)}
                    className={cn("input", check?.changed && "border-copper!")}
                  />
                  <p className="mt-1 text-xs text-muted">
                    {std?.term != null ? (
                      <>
                        Standaard {std.term}{" "}
                        {std.unit === "maanden"
                          ? std.term === 1
                            ? "maand"
                            : "maanden"
                          : std.term === 1
                            ? "dag"
                            : "dagen"}
                        {std.source === "product"
                          ? " (productspecifiek)"
                          : std.source === "categorie"
                            ? ` (${category?.name})`
                            : ""}
                        {autoExpiry && ` → ${formatDateNL(autoExpiry)}`}
                      </>
                    ) : (
                      std?.reason
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Bestaande THT/TGT */}
          {type && orig && (
            <div className="rounded-md border border-border bg-background px-3 py-2 text-sm">
              Oorspronkelijke {orig.kind}:{" "}
              <strong>{formatDateNL(orig.date)}</strong>{" "}
              {orig.source === "batch" ? (
                <span className="text-muted">
                  (batch {activeBatch?.batchNumber ?? ""} van{" "}
                  {formatDateNL(activeBatch?.producedAt)})
                </span>
              ) : (
                <span className="text-muted">(handmatig ingevoerd)</span>
              )}
              {type === "diepvries" &&
                orig.source === "batch" &&
                !check?.error && (
                  <p className="mt-0.5 text-xs text-muted">
                    Eigen productie, ingevroren vóór de TGT: nieuwe
                    diepvriesdatum volgens procedure.
                  </p>
                )}
              {defaultExpiry === orig.date && autoExpiry > orig.date && (
                <p className="mt-0.5 text-xs text-copper">
                  De oorspronkelijke datum wordt niet automatisch verlengd.
                </p>
              )}
            </div>
          )}

          {check?.error && (
            <p className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {check.error}
            </p>
          )}

          {/* Onderbouwing / goedkeuring */}
          {type && !check?.error && check?.needsReason && (
            <div className="space-y-2 rounded-md border border-copper/40 bg-copper/10 p-3">
              <p className="text-sm font-medium text-copper">
                {check.needsApproval
                  ? "Langere houdbaarheid dan standaard — onderbouwing en goedkeuring leidinggevende nodig"
                  : "Handmatige datum — geef een korte onderbouwing"}
              </p>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  check.needsApproval
                    ? "Waarom mag dit langer?"
                    : "bv. termijn volgens leverancier"
                }
                className="input"
              />
              {check.needsApproval && (
                <div>
                  <select
                    value={effectiveApprover}
                    onChange={(e) => setApproverId(e.target.value)}
                    className="input"
                  >
                    <option value="">— leidinggevende —</option>
                    {approvers.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.full_name}
                        {a.id === meId ? " (ingelogd)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* 5. Medewerker + 6. Aantal */}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">
                Medewerker <span className="text-danger">*</span>
              </p>
              <StaffSelect
                companyId={companyId}
                excludeShared
                value={employee}
                onChosen={(sess) => {
                  writeStaffSession(sess, companyId);
                  setSession(sess);
                }}
              />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">
                Aantal stickers
              </p>
              <div className="flex h-12 items-center rounded-lg border border-border bg-background">
                <button
                  type="button"
                  onClick={() => setCount((c) => Math.max(1, c - 1))}
                  className="h-full w-12 text-xl text-muted"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={count}
                  onChange={(e) =>
                    setCount(
                      Math.min(200, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                  className="h-full w-14 border-0! bg-transparent text-center text-lg font-semibold"
                />
                <button
                  type="button"
                  onClick={() => setCount((c) => Math.min(200, c + 1))}
                  className="h-full w-12 text-xl text-muted"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* Meer opties */}
          <div className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm text-muted hover:text-foreground"
            >
              Meer opties
              {moreOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            {moreOpen && (
              <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
                {batches.length > 0 && (
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-muted">
                      Batch (eigen productie)
                    </label>
                    <select
                      value={batchChoice}
                      onChange={(e) => {
                        setBatchChoice(e.target.value);
                        setExpiryManual(null);
                      }}
                      className="input"
                    >
                      <option value="auto">
                        Automatisch{" "}
                        {type === "diepvries"
                          ? "(laatste geldige batch)"
                          : "(geen)"}
                      </option>
                      <option value="geen">Geen batch</option>
                      {batches.map((b) => (
                        <option key={b.labelId} value={b.labelId}>
                          {formatDateNL(b.producedAt)} ·{" "}
                          {b.batchNumber ?? "zonder nummer"} · TGT{" "}
                          {formatDateNL(b.expiry)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <Field label="Batchnummer">
                  <input
                    value={batchNumber}
                    onChange={(e) => setBatchNumber(e.target.value)}
                    placeholder={activeBatch?.batchNumber ?? ""}
                    className="input"
                  />
                </Field>
                <Field label="Hoeveelheid">
                  <input
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="bv. 2 liter"
                    className="input"
                  />
                </Field>
                <Field label="Bewaartemperatuur">
                  <input
                    value={storageTemp}
                    onChange={(e) => setStorageTemp(e.target.value)}
                    placeholder={
                      type === "diepvries" ? effectiveStorage : "bv. ≤ 7 °C"
                    }
                    className="input"
                  />
                </Field>
                <Field label="Productietijd">
                  <input
                    type="time"
                    value={productionTime}
                    onChange={(e) => setProductionTime(e.target.value)}
                    className="input"
                  />
                </Field>
                {type && type !== "productie" && std?.unit && (
                  <Field label={`Afwijkende bewaartermijn (${std.unit})`}>
                    <input
                      type="number"
                      min={0}
                      value={termOverride}
                      onChange={(e) => {
                        setTermOverride(e.target.value);
                        setExpiryManual(null);
                      }}
                      placeholder={std.term != null ? String(std.term) : ""}
                      className="input"
                    />
                  </Field>
                )}
                {!activeBatch && type && type !== "productie" && (
                  <Field label="Bestaande THT/TGT (bv. leverancier)">
                    <div className="flex gap-2">
                      <select
                        value={origManualKind}
                        onChange={(e) =>
                          setOrigManualKind(e.target.value as "THT" | "TGT")
                        }
                        className="input w-20!"
                      >
                        <option>THT</option>
                        <option>TGT</option>
                      </select>
                      <input
                        type="date"
                        value={origManual}
                        onChange={(e) => {
                          setOrigManual(e.target.value);
                          setExpiryManual(null);
                        }}
                        className="input"
                      />
                    </div>
                  </Field>
                )}
                <div className="sm:col-span-2">
                  <Field label="Opmerking">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="bv. zonder zout"
                      className="input"
                    />
                  </Field>
                </div>
                <Field label="Stickerformaat">
                  <select
                    value={format}
                    onChange={(e) => {
                      setFormat(e.target.value);
                      writeStickerFormat(e.target.value);
                    }}
                    className="input"
                  >
                    {STICKER_FORMATS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          {/* 7. Afdrukken */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void print()}
              disabled={!canPrint}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-lg bg-teal px-6 text-lg font-semibold text-white hover:bg-teal-light disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Printer className="h-5 w-5" />
              {busy ? "Bezig…" : `Afdrukken${count > 1 ? ` (${count}×)` : ""}`}
            </button>
            <button
              type="button"
              onClick={() => setPreview((v) => !v)}
              className="h-14 rounded-lg border border-border px-4 text-sm text-muted hover:text-foreground lg:hidden"
            >
              Voorbeeld
            </button>
          </div>
          {!canPrint && !busy && missing.length > 0 && (
            <p className="-mt-3 text-xs text-muted">
              Nog nodig: {missing.join(", ")}.
            </p>
          )}

          {lastPrint && (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-teal/10 px-3 py-2 text-sm text-teal">
              <Check className="h-4 w-4" />
              <span className="flex-1">
                Geregistreerd: {lastPrint.data.productName} ({lastPrint.count}×)
              </span>
              <button
                type="button"
                onClick={() => void reprintLast()}
                disabled={busy}
                className="flex items-center gap-1 underline"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Opnieuw afdrukken
              </button>
            </div>
          )}

          <div className="flex justify-between text-xs text-muted">
            <Link
              href="/stickers/historie"
              className="flex items-center gap-1 hover:text-foreground"
            >
              <History className="h-3.5 w-3.5" /> Stickerhistorie
            </Link>
            <span>{companyName}</span>
          </div>
        </div>

        {/* Voorbeeld */}
        <div className={cn("space-y-2 lg:block", preview ? "block" : "hidden")}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Voorbeeld
          </p>
          {labelData ? (
            <div className="inline-block rounded border border-border shadow-sm">
              <StickerLabel data={labelData} format={format} />
            </div>
          ) : (
            <p className="w-56 text-sm text-muted">
              Kies een product en stickertype.
            </p>
          )}
        </div>
      </div>

      <StickerPrintArea
        key={printJob?.nonce}
        data={printJob?.data ?? null}
        format={printJob?.format ?? format}
        count={printJob?.count ?? 1}
      />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------
// Zoeken
// ------------------------------------------------------------------

type RecipeRow = {
  id: string;
  name: string;
  recipe_kind: string;
  category: string | null;
  shelf_life_rule?: string | null;
  shelf_life_days: number | null;
  company_id?: string | null;
};
type ProductRow = {
  id: string;
  name: string;
  custom_name: string | null;
  product_group: string | null;
};

function recipeToProduct(r: RecipeRow): StickerProduct {
  return {
    kind: "recipe",
    id: r.id,
    name: r.name,
    label: r.recipe_kind === "halfproduct" ? "Halfproduct" : "Gerecht",
    isPrepared: true,
    productGroup: r.category,
    rule: r.shelf_life_rule ?? null,
    days: r.shelf_life_days,
  };
}

function productToProduct(p: ProductRow): StickerProduct {
  return {
    kind: "product",
    id: p.id,
    name: p.custom_name || p.name,
    label: "Ingrediënt",
    isPrepared: false,
    productGroup: p.product_group,
    rule: null,
    days: null,
  };
}

export function ProductSearch({
  companyId,
  value,
  onChange,
}: {
  companyId: string;
  value: StickerProduct | null;
  onChange: (p: StickerProduct | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StickerProduct[]>([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const supabase = createClient();
      const like = `%${term.replace(/[%_]/g, "")}%`;
      const [r, p, pc] = await Promise.all([
        supabase
          .from("recipes")
          .select(
            "id, name, recipe_kind, category, shelf_life_rule, shelf_life_days, company_id",
          )
          .ilike("name", like)
          .neq("status", "vervallen")
          .order("name")
          .limit(20),
        supabase
          .from("products")
          .select("id, name, custom_name, product_group")
          .ilike("name", like)
          .eq("is_active", true)
          .in("item_category", ["food", "onbekend"])
          .order("name")
          .limit(12),
        supabase
          .from("products")
          .select("id, name, custom_name, product_group")
          .ilike("custom_name", like)
          .eq("is_active", true)
          .in("item_category", ["food", "onbekend"])
          .order("name")
          .limit(8),
      ]);
      if (cancelled) return;
      const recipes = ((r.data as RecipeRow[]) ?? [])
        .filter((x) => !x.company_id || x.company_id === companyId)
        .slice(0, 10)
        .map(recipeToProduct);
      const seen = new Set<string>();
      const products = [
        ...((p.data as ProductRow[]) ?? []),
        ...((pc.data as ProductRow[]) ?? []),
      ]
        .filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
        .slice(0, 10)
        .map(productToProduct);
      setResults([...recipes, ...products]);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, companyId]);

  if (value) {
    return (
      <div>
        <p className="mb-1 text-sm font-medium text-foreground">Product</p>
        <div className="flex h-14 items-center gap-3 rounded-lg border-2 border-teal bg-teal/5 px-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-foreground">
              {value.name}
            </p>
            <p className="text-xs text-muted">
              {value.kind === "vrij"
                ? "Vrije invoer (niet in de database)"
                : value.label}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQ("");
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="rounded-md p-2 text-muted hover:bg-background"
            aria-label="Ander product"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  const term = q.trim();
  const shown = term.length >= 2 ? results : [];

  return (
    <div className="relative">
      <label className="mb-1 block text-sm font-medium text-foreground">
        Product
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && term) {
              e.preventDefault();
              const exact = shown.find(
                (s) => s.name.toLowerCase() === term.toLowerCase(),
              );
              onChange(exact ?? vrij(term));
              setOpen(false);
            }
          }}
          placeholder="Zoek ingrediënt, halfproduct of gerecht — of typ een naam"
          className="input h-14! pl-10! text-lg!"
        />
      </div>
      {open && term.length >= 1 && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
          {shown.map((s) => (
            <button
              key={`${s.kind}:${s.id}`}
              type="button"
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-surface"
            >
              <span className="truncate font-medium text-foreground">
                {s.name}
              </span>
              <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-xs text-muted">
                {s.label}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onChange(vrij(term));
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm text-teal hover:bg-surface"
          >
            Gebruik &ldquo;{term}&rdquo; als productnaam
          </button>
        </div>
      )}
    </div>
  );
}

function vrij(name: string): StickerProduct {
  return {
    kind: "vrij",
    id: null,
    name: name.trim(),
    label: "Vrije invoer",
    isPrepared: false,
    productGroup: null,
    rule: null,
    days: null,
  };
}

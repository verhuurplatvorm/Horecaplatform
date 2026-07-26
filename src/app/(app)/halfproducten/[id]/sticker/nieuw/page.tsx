"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Printer, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { Recipe, StockMovement, UserProfile } from "@/lib/types/database";

const FORMATS: { value: string; label: string; widthMm: number; heightMm: number }[] = [
  { value: "29x90mm", label: "29 × 90 mm", widthMm: 29, heightMm: 90 },
  { value: "38x90mm", label: "38 × 90 mm", widthMm: 38, heightMm: 90 },
  { value: "50x30mm", label: "50 × 30 mm", widthMm: 50, heightMm: 30 },
  { value: "62x29mm", label: "62 × 29 mm", widthMm: 62, heightMm: 29 },
  { value: "62x100mm", label: "62 × 100 mm", widthMm: 62, heightMm: 100 },
  { value: "a4", label: "A4-vel", widthMm: 210, heightMm: 297 },
];

interface AllergenSummary {
  bevat: string[];
  sporen: string[];
}

export default function NieuweStickerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: recipeId } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const movementIdFromQuery = searchParams.get("movementId");

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [unitName, setUnitName] = useState<string | null>(null);
  const [allergens, setAllergens] = useState<AllergenSummary | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [recentMovements, setRecentMovements] = useState<StockMovement[]>([]);
  const [movement, setMovement] = useState<StockMovement | null>(null);
  const [existingLabelCount, setExistingLabelCount] = useState<number>(0);

  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [manualNames, setManualNames] = useState("");
  const [productionAt, setProductionAt] = useState("");
  const [expiryAt, setExpiryAt] = useState("");
  const [expiryManuallySet, setExpiryManuallySet] = useState(false);
  const [batchNumber, setBatchNumber] = useState("");
  const [extraText, setExtraText] = useState("");
  const [stickerCount, setStickerCount] = useState("1");
  const [numberSticker, setNumberSticker] = useState(false);
  const [format, setFormat] = useState("62x100mm");
  const [reprintReason, setReprintReason] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const [loading, setLoading] = useState(() => Boolean(searchParams.get("movementId")));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  // Basisgegevens van het halfproduct laden.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const [{ data: r }, { data: allergenData }, { data: userData }, { data: authUser }] =
        await Promise.all([
          supabase.from("recipes").select("*").eq("id", recipeId).single(),
          supabase.rpc("calculate_recipe_allergens", { p_recipe_id: recipeId }),
          supabase.from("user_profiles").select("*").eq("is_active", true).order("full_name"),
          supabase.auth.getUser(),
        ]);
      if (cancelled) return;

      setRecipe(r as Recipe);
      setAllergens((allergenData as AllergenSummary) ?? { bevat: [], sporen: [] });
      setUsers((userData as UserProfile[]) ?? []);

      if (r?.base_unit_id) {
        const { data: unit } = await supabase
          .from("units")
          .select("name")
          .eq("id", r.base_unit_id)
          .single();
        if (!cancelled) setUnitName(unit?.name ?? null);
      }

      const uid = authUser.user?.id;
      if (uid) {
        setCurrentUserId(uid);
        setSelectedUserIds([uid]);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  // Recente producties van dit halfproduct laden (voor de kiezer als er
  // geen movementId is meegegeven).
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data } = await supabase
        .from("stock_movements")
        .select("*")
        .eq("recipe_id", recipeId)
        .eq("movement_type", "productie")
        .order("created_at", { ascending: false })
        .limit(15);
      if (!cancelled) setRecentMovements((data as StockMovement[]) ?? []);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  // Zodra een productie gekozen is (via query param of uit de lijst):
  // vul de standaardwaarden in en check of dit een eerste afdruk of een
  // herdruk is.
  useEffect(() => {
    const targetId = movementIdFromQuery ?? movement?.id;
    if (!targetId) return;
    let cancelled = false;

    async function run(targetId: string) {
      const supabase = createClient();
      const { data: m } = await supabase
        .from("stock_movements")
        .select("*")
        .eq("id", targetId)
        .single();
      if (cancelled || !m) {
        setLoading(false);
        return;
      }
      setMovement(m as StockMovement);

      const { count } = await supabase
        .from("production_labels")
        .select("id", { count: "exact", head: true })
        .eq("stock_movement_id", targetId);
      setExistingLabelCount(count ?? 0);

      const prodAt = new Date(m.created_at);
      setProductionAt(toLocalDatetimeInput(prodAt));
      setBatchNumber(
        m.batch_number ?? `HP-${prodAt.toISOString().slice(0, 10).replace(/-/g, "")}-001`
      );

      setLoading(false);
    }
    run(targetId);
    return () => {
      cancelled = true;
    };
  }, [movementIdFromQuery, movement?.id]);

  // Houdbaarheidsdatum automatisch berekenen zodra productiedatum of
  // het halfproduct (met zijn houdbaarheid) bekend is — tenzij de
  // gebruiker 'm al handmatig heeft aangepast.
  const computedExpiry = (() => {
    if (!productionAt || !recipe?.shelf_life_days) return "";
    const base = new Date(productionAt);
    base.setDate(base.getDate() + recipe.shelf_life_days);
    return base.toISOString().slice(0, 10);
  })();
  const effectiveExpiry = expiryManuallySet ? expiryAt : computedExpiry;

  // QR-code genereren zodra er een movement is (verwijst naar de
  // batchdetailpagina — alleen zichtbaar voor ingelogde gebruikers).
  useEffect(() => {
    if (!movement) return;
    let cancelled = false;
    const url = `${window.location.origin}/halfproducten/${recipeId}/batch/${movement.id}`;
    QRCode.toDataURL(url, { margin: 1, width: 160 }).then((dataUrl) => {
      if (!cancelled) setQrDataUrl(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [movement, recipeId]);

  const formatInfo = FORMATS.find((f) => f.value === format) ?? FORMATS[4];
  const isReprint = existingLabelCount > 0;
  const count = Math.max(1, parseInt(stickerCount, 10) || 1);

  const producedByLabel = useMemo(() => {
    const names = selectedUserIds
      .map((id) => users.find((u) => u.id === id)?.full_name)
      .filter(Boolean) as string[];
    const manual = manualNames
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    return [...names, ...manual].join(", ") || "—";
  }, [selectedUserIds, users, manualNames]);

  function toggleUser(userId: string) {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  async function handlePrint() {
    if (!movement || !recipe) return;
    if (isReprint && !reprintReason.trim()) {
      setError("Geef een reden op voor de herdruk.");
      return;
    }

    setError(null);
    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Batchnummer op de productieboeking bijwerken als dit de eerste
    // afdruk is en er nog geen batchnummer was vastgelegd.
    if (!isReprint && !movement.batch_number) {
      await supabase
        .from("stock_movements")
        .update({ batch_number: batchNumber })
        .eq("id", movement.id);
    }

    const { error: insertError } = await supabase.from("production_labels").insert({
      stock_movement_id: movement.id,
      produced_by_user_ids: selectedUserIds,
      produced_by_manual_names: manualNames
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean),
      production_at: new Date(productionAt).toISOString(),
      expiry_at: effectiveExpiry || null,
      expiry_manually_set: expiryManuallySet,
      extra_text: extraText.trim() || null,
      sticker_format: format,
      sticker_count: count,
      printed_by: user?.id ?? null,
      reprint_of: isReprint ? await getLatestLabelId(supabase, movement.id) : null,
      reprint_reason: isReprint ? reprintReason.trim() : null,
    });
    setSaving(false);

    if (insertError) {
      setError("Kan afdruk niet registreren: " + insertError.message);
      return;
    }

    window.print();
  }

  if (loading) {
    return (
      <>
        <Topbar title="Sticker afdrukken" />
        <main className="p-6 text-sm text-muted">Laden…</main>
      </>
    );
  }

  if (!movement) {
    return (
      <>
        <Topbar title="Sticker afdrukken" />
        <main className="max-w-2xl p-6 space-y-4">
          <p className="text-sm text-muted">
            Kies voor welke productie je een sticker wilt afdrukken.
          </p>
          <Card>
            <CardContent className="p-0">
              {recentMovements.length === 0 ? (
                <p className="p-5 text-sm text-muted">
                  Nog geen producties geregistreerd voor dit halfproduct. Ga
                  naar Voorraad → Productie registreren.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-5 py-3 font-medium">Datum</th>
                      <th className="px-5 py-3 font-medium">Hoeveelheid</th>
                      <th className="px-5 py-3 font-medium">Batchnummer</th>
                      <th className="px-5 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentMovements.map((m) => (
                      <tr key={m.id} className="border-t border-border">
                        <td className="px-5 py-3">
                          {new Date(m.created_at).toLocaleString("nl-NL")}
                        </td>
                        <td className="px-5 py-3 tabular">{m.quantity_change}</td>
                        <td className="px-5 py-3">{m.batch_number ?? "—"}</td>
                        <td className="px-5 py-3">
                          <Button size="sm" onClick={() => setMovement(m)}>
                            Sticker afdrukken
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar title={`Sticker afdrukken — ${recipe?.name ?? ""}`} />
      <main className="grid gap-6 p-6 lg:grid-cols-[1fr_auto] print:block print:p-0">
        <div className="space-y-4 print:hidden">
          {isReprint && (
            <div className="flex items-center gap-2 rounded-md border border-copper/40 bg-copper/10 px-4 py-3 text-sm text-copper">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              Dit is een herdruk (er {existingLabelCount === 1 ? "is al 1 sticker" : `zijn al ${existingLabelCount} stickers`} afgedrukt voor deze batch). Geef een reden op.
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Productiegegevens</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Geproduceerd door
                </label>
                <div className="flex flex-wrap gap-2">
                  {users.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleUser(u.id)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        selectedUserIds.includes(u.id)
                          ? "border-teal bg-teal/10 text-teal"
                          : "border-border text-muted"
                      }`}
                    >
                      {u.full_name}
                      {u.id === currentUserId ? " (jij)" : ""}
                    </button>
                  ))}
                </div>
                <input
                  value={manualNames}
                  onChange={(e) => setManualNames(e.target.value)}
                  placeholder="Overige namen, komma-gescheiden"
                  className="input mt-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Productiedatum &amp; tijd
                  </label>
                  <input
                    type="datetime-local"
                    value={productionAt}
                    onChange={(e) => setProductionAt(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Te gebruiken tot en met
                  </label>
                  <input
                    type="date"
                    value={effectiveExpiry}
                    onChange={(e) => {
                      setExpiryAt(e.target.value);
                      setExpiryManuallySet(true);
                    }}
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Batchnummer
                </label>
                <input
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  disabled={isReprint}
                  className="input"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Extra tekst op sticker
                </label>
                <input
                  value={extraText}
                  onChange={(e) => setExtraText(e.target.value)}
                  placeholder="bv. alleen voor dinerkaart, niet invriezen"
                  className="input"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Aantal stickers
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={stickerCount}
                    onChange={(e) => setStickerCount(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Stickerformaat
                  </label>
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                    className="input"
                  >
                    {FORMATS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {count > 1 && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={numberSticker}
                    onChange={(e) => setNumberSticker(e.target.checked)}
                  />
                  Volgnummer tonen (bak 1 van {count}, bak 2 van {count}, ...)
                </label>
              )}

              {isReprint && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Reden voor herdruk <span className="text-danger">*</span>
                  </label>
                  <input
                    value={reprintReason}
                    onChange={(e) => setReprintReason(e.target.value)}
                    placeholder="bv. sticker beschadigd, extra verpakking"
                    className="input"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={handlePrint} disabled={saving}>
              <Printer className="h-4 w-4" />
              {saving ? "Bezig…" : `Afdrukken (${count}×)`}
            </Button>
            <Button variant="secondary" onClick={() => router.push(`/halfproducten/${recipeId}/bewerken`)}>
              Terug naar halfproduct
            </Button>
          </div>
          <p className="text-xs text-muted">
            &quot;Afdrukken&quot; opent het printvoorbeeld van je browser — kies
            daar je labelprinter (bv. Brother of Dymo), of kies &quot;Opslaan
            als PDF&quot; om de sticker te bewaren.
          </p>
        </div>

        {/* Printvoorbeeld */}
        <div ref={printRef} className="print:block">
          {Array.from({ length: count }).map((_, i) => (
            <div
              key={i}
              className="label-sticker mb-4 border border-border bg-white p-3 shadow-sm print:mb-0 print:border-black print:shadow-none print:break-after-page"
              style={{
                width: `${formatInfo.widthMm}mm`,
                minHeight: `${formatInfo.heightMm}mm`,
              }}
            >
              <p className="text-base font-bold leading-tight">{recipe?.name}</p>
              <p className="mt-1 text-xs">
                <span className="font-medium">Geproduceerd door:</span> {producedByLabel}
              </p>
              <p className="text-xs">
                <span className="font-medium">Productiedatum:</span>{" "}
                {productionAt ? new Date(productionAt).toLocaleString("nl-NL") : "—"}
              </p>
              <p className="text-sm font-semibold">
                <span className="font-medium">Te gebruiken tot en met:</span>{" "}
                {effectiveExpiry ? new Date(effectiveExpiry).toLocaleDateString("nl-NL") : "—"}
              </p>
              {recipe?.storage_method && (
                <p className="text-xs">
                  <span className="font-medium">Bewaren:</span> {recipe.storage_method}
                </p>
              )}
              {allergens && allergens.bevat.length > 0 && (
                <p className="text-xs">
                  <span className="font-medium">Allergenen:</span> Bevat{" "}
                  {allergens.bevat.join(", ")}
                </p>
              )}
              <p className="text-xs">
                <span className="font-medium">Hoeveelheid:</span>{" "}
                {movement.quantity_change} {unitName ?? ""}
              </p>
              <p className="text-xs">
                <span className="font-medium">Batchnummer:</span> {batchNumber}
              </p>
              {extraText && <p className="mt-1 text-xs italic">{extraText}</p>}
              {numberSticker && count > 1 && (
                <p className="text-xs text-muted">
                  bak {i + 1} van {count}
                </p>
              )}
              {qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="QR-code" className="mt-1 h-16 w-16" />
              )}
            </div>
          ))}
        </div>
      </main>

      <style jsx global>{`
        .input {
          display: block;
          width: 100%;
          height: 2.5rem;
          border-radius: 0.375rem;
          border: 1px solid var(--border);
          background: var(--surface);
          padding: 0 0.75rem;
          font-size: 0.875rem;
        }
        @media print {
          body * {
            visibility: hidden;
          }
          .label-sticker,
          .label-sticker * {
            visibility: visible;
          }
        }
      `}</style>
    </>
  );
}

function toLocalDatetimeInput(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

async function getLatestLabelId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  movementId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("production_labels")
    .select("id")
    .eq("stock_movement_id", movementId)
    .order("printed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import type {
  Product,
  ProductPackaging,
  Supplier,
  Unit,
} from "@/lib/types/database";

const ALLERGENS = [
  "gluten",
  "schaaldieren",
  "eieren",
  "vis",
  "pinda",
  "soja",
  "melk",
  "noten",
  "selderij",
  "mosterd",
  "sesam",
  "sulfiet",
  "lupine",
  "weekdieren",
] as const;

const NUTRIENTS: { key: string; label: string; unit: string }[] = [
  { key: "energie", label: "Energie", unit: "kcal" },
  { key: "vet", label: "Vet", unit: "g" },
  { key: "verzadigd_vet", label: "Waarvan verzadigd", unit: "g" },
  { key: "koolhydraten", label: "Koolhydraten", unit: "g" },
  { key: "suikers", label: "Waarvan suikers", unit: "g" },
  { key: "eiwit", label: "Eiwit", unit: "g" },
  { key: "zout", label: "Zout", unit: "g" },
  { key: "vezels", label: "Vezels", unit: "g" },
];

const DIETARY_FLAGS: { key: string; label: string }[] = [
  { key: "vegan", label: "Vegan" },
  { key: "vegetarisch", label: "Vegetarisch" },
  { key: "glutenvrij", label: "Glutenvrij" },
  { key: "lactosevrij", label: "Lactosevrij" },
  { key: "halal", label: "Halal" },
];

interface PackagingRow {
  id?: string;
  name: string;
  quantity_in_base_unit: string; // tekstinvoer, bij opslaan naar number
  is_default: boolean;
}

export interface ProductFormProps {
  /** Bij bewerken: het bestaande product. Leeg = nieuw product. */
  initialProduct?: Product;
  initialPackagings?: ProductPackaging[];
  /** Voorinvulling bij een nieuw product (bv. vanuit een niet-gematchte
   * prijsimportregel — spec: producten worden primair via de prijslijst
   * van leveranciers aangemaakt, niet via handmatige invoer als eerste
   * stap). Wordt genegeerd zodra initialProduct is gezet. */
  prefillName?: string;
  prefillEanCode?: string;
  prefillArticleNumber?: string;
  prefillPackagingName?: string;
  prefillBrand?: string;
  /** 'page' toont een terugknop en navigeert na opslaan; 'dialog' geeft
   * het opgeslagen product terug aan de aanroeper (voor snelinvoer vanuit
   * een receptregel of, zoals hier, vanuit de prijsimport). */
  mode?: "page" | "dialog";
  onSaved?: (product: Product) => void;
  onCancel?: () => void;
}

export function ProductForm({
  initialProduct,
  initialPackagings = [],
  prefillName,
  prefillEanCode,
  prefillArticleNumber,
  prefillPackagingName,
  prefillBrand,
  mode = "page",
  onSaved,
  onCancel,
}: ProductFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialProduct);

  const [units, setUnits] = useState<Unit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [name, setName] = useState(initialProduct?.name ?? prefillName ?? "");
  const [customName, setCustomName] = useState(
    initialProduct?.custom_name ?? initialProduct?.name ?? prefillName ?? ""
  );
  const [customNameTouched, setCustomNameTouched] = useState(Boolean(initialProduct));
  const [initialSupplierId, setInitialSupplierId] = useState("");
  const [initialPackagingDescription, setInitialPackagingDescription] = useState("");
  const [initialPackagingUnitCount, setInitialPackagingUnitCount] = useState("");
  const [initialPurchasePrice, setInitialPurchasePrice] = useState("");
  const [brand, setBrand] = useState(initialProduct?.brand ?? prefillBrand ?? "");
  const [description, setDescription] = useState(
    initialProduct?.description ?? ""
  );
  const [kind, setKind] = useState<Product["kind"]>(
    initialProduct?.kind ?? "inkoopartikel"
  );
  const [productGroup, setProductGroup] = useState(
    initialProduct?.product_group ?? ""
  );
  const [baseUnitId, setBaseUnitId] = useState(
    initialProduct?.base_unit_id ?? ""
  );
  const [eanCode, setEanCode] = useState(
    initialProduct?.ean_code ?? prefillEanCode ?? ""
  );
  const [articleNumber, setArticleNumber] = useState(
    initialProduct?.article_number ?? prefillArticleNumber ?? ""
  );
  const [taxRate, setTaxRate] = useState(
    initialProduct?.tax_rate?.toString() ?? ""
  );
  const [lossPct, setLossPct] = useState(
    initialProduct?.default_loss_percentage?.toString() ?? ""
  );
  const [preferredSupplierId, setPreferredSupplierId] = useState(
    initialProduct?.preferred_supplier_id ?? ""
  );
  const [minStock, setMinStock] = useState(
    initialProduct?.min_stock_quantity?.toString() ?? ""
  );
  const [reorderQty, setReorderQty] = useState(
    initialProduct?.reorder_quantity?.toString() ?? ""
  );
  const [allergens, setAllergens] = useState<Set<string>>(
    new Set(initialProduct?.allergens ?? [])
  );
  const [traces, setTraces] = useState<Set<string>>(
    new Set(initialProduct?.contains_traces ?? [])
  );
  const [nutrition, setNutrition] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(initialProduct?.nutrition_per_100 ?? {}).map(([k, v]) => [
        k,
        String(v),
      ])
    )
  );
  const [dietaryFlags, setDietaryFlags] = useState<Record<string, boolean>>(
    initialProduct?.dietary_flags ?? {}
  );
  const [packagings, setPackagings] = useState<PackagingRow[]>(
    initialPackagings.length > 0
      ? initialPackagings.map((p) => ({
          id: p.id,
          name: p.name,
          quantity_in_base_unit: String(p.quantity_in_base_unit),
          is_default: p.is_default,
        }))
      : [
          {
            name: prefillPackagingName ?? "",
            quantity_in_base_unit: "",
            is_default: true,
          },
        ]
  );

  const [duplicates, setDuplicates] = useState<
    { id: string; name: string; reason: string }[]
  >([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("units")
      .select("*")
      .order("dimension")
      .order("sort_order")
      .then(({ data }) => setUnits((data as Unit[]) ?? []));
    supabase
      .from("suppliers")
      .select("*")
      .order("name")
      .then(({ data }) => setSuppliers((data as Supplier[]) ?? []));
  }, []);

  // Niet-blokkerende duplicaatdetectie: op naam (fuzzy), EAN en
  // artikelnummer (exact) — spec §5/§11: dubbele artikelen moeten
  // zichtbaar zijn vóórdat je opslaat, niet pas achteraf ontdekt.
  useEffect(() => {
    const trimmedName = name.trim();
    if (trimmedName.length < 3 && !eanCode && !articleNumber) return;

    let cancelled = false;
    const timeout = setTimeout(async () => {
      const supabase = createClient();

      // Bewust drie losse queries i.p.v. één samengestelde .or()-filter:
      // een productnaam kan tekens bevatten die de queryformaat-syntax
      // van Supabase/PostgREST verstoren (bv. haakjes, komma's), wat tot
      // een kapotte filter en willekeurige resultaten leidt.
      const queries = [];
      if (trimmedName.length >= 3) {
        queries.push(
          supabase
            .from("products")
            .select("id, name, ean_code, article_number")
            .ilike("name", `%${trimmedName}%`)
            .limit(5)
        );
      }
      if (eanCode) {
        queries.push(
          supabase
            .from("products")
            .select("id, name, ean_code, article_number")
            .eq("ean_code", eanCode)
            .limit(5)
        );
      }
      if (articleNumber) {
        queries.push(
          supabase
            .from("products")
            .select("id, name, ean_code, article_number")
            .eq("article_number", articleNumber)
            .limit(5)
        );
      }
      if (queries.length === 0) return;

      const results = await Promise.all(queries);
      if (cancelled) return;

      const seen = new Map<
        string,
        { id: string; name: string; reason: string }
      >();
      for (const { data } of results) {
        for (const p of data ?? []) {
          if (p.id === initialProduct?.id || seen.has(p.id)) continue;
          seen.set(p.id, {
            id: p.id,
            name: p.name,
            reason:
              p.ean_code && p.ean_code === eanCode
                ? "zelfde EAN-code"
                : p.article_number && p.article_number === articleNumber
                ? "zelfde artikelnummer"
                : "vergelijkbare naam",
          });
        }
      }
      setDuplicates([...seen.values()].slice(0, 5));
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [name, eanCode, articleNumber, initialProduct?.id]);

  const unitsByDimension = useMemo(() => {
    const groups: Record<string, Unit[]> = {};
    for (const u of units) {
      groups[u.dimension] = groups[u.dimension] ?? [];
      groups[u.dimension].push(u);
    }
    return groups;
  }, [units]);

  const visibleDuplicates =
    name.trim().length < 3 && !eanCode && !articleNumber ? [] : duplicates;

  function toggleAllergen(a: string) {
    setAllergens((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
  }

  function toggleTrace(a: string) {
    setTraces((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
  }

  function updatePackaging(index: number, patch: Partial<PackagingRow>) {
    setPackagings((prev) =>
      prev.map((row, i) => {
        if (i !== index) {
          // is_default is uniek: als deze rij default wordt, anderen uitzetten
          return patch.is_default ? { ...row, is_default: false } : row;
        }
        return { ...row, ...patch };
      })
    );
  }

  function addPackaging() {
    setPackagings((prev) => [
      ...prev,
      { name: "", quantity_in_base_unit: "", is_default: prev.length === 0 },
    ]);
  }

  function removePackaging(index: number) {
    setPackagings((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!baseUnitId) {
      setError("Kies een basiseenheid.");
      return;
    }
    const validPackagings = packagings.filter(
      (p) => p.name.trim() && p.quantity_in_base_unit.trim()
    );

    setSaving(true);
    const supabase = createClient();

    const payload = {
      name: name.trim(),
      custom_name: customName.trim() || name.trim(),
      brand: brand.trim() || null,
      description: description.trim() || null,
      kind,
      product_group: productGroup.trim() || null,
      base_unit_id: baseUnitId,
      ean_code: eanCode.trim() || null,
      article_number: articleNumber.trim() || null,
      tax_rate: taxRate ? Number(taxRate) : null,
      default_loss_percentage: lossPct ? Number(lossPct) : null,
      preferred_supplier_id: preferredSupplierId || null,
      min_stock_quantity: minStock ? Number(minStock) : null,
      reorder_quantity: reorderQty ? Number(reorderQty) : null,
      allergens: Array.from(allergens),
      contains_traces: Array.from(traces),
      dietary_flags: dietaryFlags,
      nutrition_per_100: Object.fromEntries(
        Object.entries(nutrition)
          .filter(([, v]) => v.trim() !== "")
          .map(([k, v]) => [k, Number(v)])
      ),
    };

    let productId = initialProduct?.id;

    if (isEdit && productId) {
      const { error: updateError } = await supabase
        .from("products")
        .update(payload)
        .eq("id", productId);
      if (updateError) {
        setError("Opslaan mislukt: " + updateError.message);
        setSaving(false);
        return;
      }
      // Simpel vervangen i.p.v. per-rij diffen: verwijder bestaande
      // verpakkingen en schrijf de huidige lijst opnieuw weg.
      await supabase
        .from("product_packagings")
        .delete()
        .eq("product_id", productId);
    } else {
      const groupId = await getCurrentGroupId(supabase);
      if (!groupId) {
        setError("Kan groep van gebruiker niet bepalen. Log opnieuw in.");
        setSaving(false);
        return;
      }
      const { data: created, error: insertError } = await supabase
        .from("products")
        .insert({ ...payload, group_id: groupId })
        .select("id")
        .single();
      if (insertError || !created) {
        setError("Opslaan mislukt: " + (insertError?.message ?? "onbekende fout"));
        setSaving(false);
        return;
      }
      productId = created.id;

      // Meteen een eerste leveranciersprijs vastleggen als de gebruiker
      // die erbij heeft ingevuld — anders moest je na het aanmaken altijd
      // nog apart naar het product terug om een prijs toe te voegen.
      if (initialSupplierId && initialPurchasePrice && initialPackagingUnitCount) {
        const { error: priceError } = await supabase.from("supplier_products").insert({
          supplier_id: initialSupplierId,
          product_id: productId,
          company_id: null,
          packaging_description: initialPackagingDescription.trim() || null,
          packaging_unit_count: Number(initialPackagingUnitCount),
          purchase_price: Number(initialPurchasePrice),
          is_contract_price: false,
          valid_from: new Date().toISOString().slice(0, 10),
        });
        if (priceError) {
          console.error("Kan initiële leveranciersprijs niet opslaan:", priceError.message);
        }
      }
    }

    if (validPackagings.length > 0 && productId) {
      const { error: packagingError } = await supabase
        .from("product_packagings")
        .insert(
          validPackagings.map((p, i) => ({
            product_id: productId,
            name: p.name.trim(),
            quantity_in_base_unit: Number(p.quantity_in_base_unit),
            is_default: p.is_default,
            sort_order: i,
          }))
        );
      if (packagingError) {
        setError("Product opgeslagen, maar verpakkingen niet: " + packagingError.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);

    const { data: finalProduct } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();

    if (mode === "dialog" && onSaved && finalProduct) {
      onSaved(finalProduct as Product);
    } else {
      router.push("/producten");
    }
  }

  async function handleDelete() {
    if (!initialProduct) return;
    if (
      !window.confirm(
        `"${initialProduct.name}" definitief verwijderen? Dit kan niet ongedaan worden gemaakt.`
      )
    ) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    const supabase = createClient();
    const { error: deleteErr } = await supabase
      .from("products")
      .delete()
      .eq("id", initialProduct.id);
    setDeleting(false);

    if (deleteErr) {
      setDeleteError(
        deleteErr.code === "23503"
          ? "Dit product wordt gebruikt in een receptuur of prijshistorie en kan daarom niet verwijderd worden. Zet het op \"inactief\" in plaats daarvan."
          : "Verwijderen mislukt: " + deleteErr.message
      );
      return;
    }
    router.push("/producten");
  }

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (e.key === "Enter" && target.tagName === "INPUT") {
          e.preventDefault();
        }
      }}
      className="space-y-4">
      {visibleDuplicates.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-copper/40 bg-copper/10 px-4 py-3 text-sm text-copper">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Mogelijk al bestaande artikelen:</p>
            <ul className="mt-1 list-disc pl-4">
              {visibleDuplicates.map((d) => (
                <li key={d.id}>
                  {d.name} ({d.reason})
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs">
              Je kunt gewoon doorgaan als dit toch een ander artikel is.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Basisgegevens</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Naam" required>
            <input
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!customNameTouched) setCustomName(e.target.value);
              }}
              className="input"
            />
          </Field>
          <Field
            label="Eigen productnaam"
            hint="Standaard gelijk aan de naam, vrij aan te passen — wordt meegenomen in alle zoekfuncties."
          >
            <input
              value={customName}
              onChange={(e) => {
                setCustomName(e.target.value);
                setCustomNameTouched(true);
              }}
              className="input"
            />
          </Field>
          <Field label="Merk">
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Productgroep">
            <input
              value={productGroup}
              onChange={(e) => setProductGroup(e.target.value)}
              placeholder="bv. vlees, dranken-alcoholisch"
              className="input"
            />
          </Field>
          <Field label="Type">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Product["kind"])}
              className="input"
            >
              <option value="inkoopartikel">Inkoopartikel</option>
              <option value="verkoopartikel">Verkoopartikel</option>
              <option value="beide">Beide</option>
            </select>
          </Field>
          <Field label="Omschrijving" span2>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="input"
            />
          </Field>
          <Field label="EAN-code">
            <input
              value={eanCode}
              onChange={(e) => setEanCode(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Artikelnummer">
            <input
              value={articleNumber}
              onChange={(e) => setArticleNumber(e.target.value)}
              className="input"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eenheid &amp; verpakkingen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Basiseenheid (waarin recepturen rekenen)" required>
            <select
              required
              value={baseUnitId}
              onChange={(e) => setBaseUnitId(e.target.value)}
              className="input max-w-xs"
            >
              <option value="">Kies een eenheid…</option>
              {Object.entries(unitsByDimension).map(([dimension, list]) => (
                <optgroup key={dimension} label={dimension}>
                  {list.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">
                Verpakkingen
              </label>
              <Button type="button" variant="secondary" size="sm" onClick={addPackaging}>
                <Plus className="h-3.5 w-3.5" />
                Verpakking toevoegen
              </Button>
            </div>
            <p className="mb-2 text-xs text-muted">
              Geef de inhoud op in de basiseenheid hierboven. Bijvoorbeeld:
              &quot;doos van 12 flessen&quot; met inhoud 9000 (als basiseenheid ml
              is en één fles 750 ml bevat).
            </p>
            <div className="space-y-2">
              {packagings.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    placeholder="Naam, bv. doos van 12 flessen"
                    value={row.name}
                    onChange={(e) => updatePackaging(i, { name: e.target.value })}
                    className="input flex-1"
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Inhoud in basiseenheid"
                    value={row.quantity_in_base_unit}
                    onChange={(e) =>
                      updatePackaging(i, { quantity_in_base_unit: e.target.value })
                    }
                    className="input w-48"
                  />
                  <label className="flex items-center gap-1 whitespace-nowrap text-xs text-muted">
                    <input
                      type="radio"
                      name="default-packaging"
                      checked={row.is_default}
                      onChange={() => updatePackaging(i, { is_default: true })}
                    />
                    standaard
                  </label>
                  <button
                    type="button"
                    onClick={() => removePackaging(i)}
                    className="text-muted hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {!isEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Inkoopprijs (optioneel)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted">
              Meteen een leveranciersprijs vastleggen bij het aanmaken — kan ook later nog via het
              product zelf.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Leverancier">
                <select
                  value={initialSupplierId}
                  onChange={(e) => setInitialSupplierId(e.target.value)}
                  className="input"
                >
                  <option value="">Geen (later toevoegen)</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Inkoopprijs (per verpakking)">
                <input
                  type="number"
                  step="0.01"
                  value={initialPurchasePrice}
                  onChange={(e) => setInitialPurchasePrice(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Verpakking (omschrijving)">
                <input
                  value={initialPackagingDescription}
                  onChange={(e) => setInitialPackagingDescription(e.target.value)}
                  placeholder="bv. 1 x 700 ml"
                  className="input"
                />
              </Field>
              <Field label="Inhoud (in basiseenheid)">
                <input
                  type="number"
                  step="any"
                  value={initialPackagingUnitCount}
                  onChange={(e) => setInitialPackagingUnitCount(e.target.value)}
                  className="input"
                />
              </Field>
            </div>
            {initialSupplierId && (!initialPurchasePrice || !initialPackagingUnitCount) && (
              <p className="text-xs text-copper">
                Vul ook prijs én inhoud in om de leveranciersprijs op te slaan.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Allergenen &amp; dieetkenmerken</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">
              Allergenen (14 wettelijk verplichte EU-allergenen)
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {ALLERGENS.map((a) => (
                <label key={a} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allergens.has(a)}
                    onChange={() => toggleAllergen(a)}
                  />
                  <span className="capitalize">{a}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">
              Kan sporen bevatten van
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {ALLERGENS.map((a) => (
                <label key={a} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={traces.has(a)}
                    onChange={() => toggleTrace(a)}
                  />
                  <span className="capitalize">{a}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">
              Dieetkenmerken
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {DIETARY_FLAGS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(dietaryFlags[f.key])}
                    onChange={() =>
                      setDietaryFlags((prev) => ({
                        ...prev,
                        [f.key]: !prev[f.key],
                      }))
                    }
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voedingswaarden (per 100 basiseenheden)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {NUTRIENTS.map((n) => (
              <div key={n.key}>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  {n.label} ({n.unit})
                </label>
                <input
                  type="number"
                  step="any"
                  value={nutrition[n.key] ?? ""}
                  onChange={(e) =>
                    setNutrition((prev) => ({ ...prev, [n.key]: e.target.value }))
                  }
                  className="input"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inkoop &amp; voorraad (optioneel)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Voorkeursleverancier">
            <select
              value={preferredSupplierId}
              onChange={(e) => setPreferredSupplierId(e.target.value)}
              className="input"
            >
              <option value="">Geen voorkeur</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Btw-percentage">
            <input
              type="number"
              step="0.01"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Standaard verlies-/snijverliespercentage">
            <input
              type="number"
              step="0.01"
              value={lossPct}
              onChange={(e) => setLossPct(e.target.value)}
              placeholder="bv. 20 voor 20%"
              className="input"
            />
          </Field>
          <Field label="Minimale voorraad (in basiseenheid)">
            <input
              type="number"
              step="any"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Bestelhoeveelheid (in basiseenheid)">
            <input
              type="number"
              step="any"
              value={reorderQty}
              onChange={(e) => setReorderQty(e.target.value)}
              className="input"
            />
          </Field>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}
      {deleteError && <p className="text-sm text-danger">{deleteError}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Opslaan…" : isEdit ? "Wijzigingen opslaan" : "Product aanmaken"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => (onCancel ? onCancel() : router.push("/producten"))}
        >
          Annuleren
        </Button>
        {isEdit && (
          <Button
            type="button"
            variant="danger"
            disabled={deleting}
            onClick={handleDelete}
            className="ml-auto"
          >
            {deleting ? "Verwijderen…" : "Verwijderen"}
          </Button>
        )}
      </div>

      <style jsx>{`
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
        textarea.input {
          height: auto;
          padding: 0.5rem 0.75rem;
        }
      `}</style>
    </form>
  );
}

function Field({
  label,
  required,
  span2,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  span2?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : undefined}>
      <label className="mb-1 block text-sm font-medium text-foreground">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

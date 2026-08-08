import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import type { ParsedProductRow } from "@/lib/product-import/parse-multi-supplier";

interface FinalizeBody {
  rows: ParsedProductRow[];
  supplierResolution: Record<string, string | null>; // rawSupplierName -> supplierId (null = overslaan)
  companyId: string | null;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  }

  const groupId = await getCurrentGroupId(supabase);
  if (!groupId) {
    return NextResponse.json({ error: "Kan groep niet bepalen." }, { status: 400 });
  }

  const body: FinalizeBody = await request.json();
  const { rows, supplierResolution, companyId } = body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "Geen producten om te importeren." }, { status: 400 });
  }

  // Regels met een niet-opgeloste leverancier worden overgeslagen — nooit
  // automatisch een leverancier aanmaken.
  const included = rows.filter((r) => supplierResolution[r.supplierNameRaw]);
  const skippedNoSupplier = rows.length - included.length;

  if (included.length === 0) {
    return NextResponse.json(
      { error: "Geen enkele regel heeft een gekoppelde leverancier — niets te importeren." },
      { status: 400 }
    );
  }

  console.log(
    `[product-import] Start import: ${included.length} regel(s) met leverancier, ${skippedNoSupplier} overgeslagen (leverancier niet gekoppeld).`
  );

  // Eenheden ophalen (voor het aanmaken van nieuwe producten en het
  // correct omrekenen van verpakkingshoeveelheden naar de basiseenheid
  // van een al bestaand product).
  const { data: units } = await supabase
    .from("units")
    .select("id, key, factor_to_base, dimension");
  const unitByKey = new Map((units ?? []).map((u) => [u.key, u]));
  const unitById = new Map((units ?? []).map((u) => [u.id, u]));

  // Alle bestaande producten van deze groep ophalen (gepagineerd, geen
  // stilzwijgende afkapping bij grote catalogi).
  const existingProducts: {
    id: string;
    name: string;
    article_number: string | null;
    base_unit_id: string | null;
  }[] = [];
  {
    const PAGE_SIZE = 1000;
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from("products")
        .select("id, name, article_number, base_unit_id")
        .eq("group_id", groupId)
        .range(from, from + PAGE_SIZE - 1);
      if (!data || data.length === 0) break;
      existingProducts.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  const productByArticleNumber = new Map<string, (typeof existingProducts)[number]>();
  const productByNormalizedName = new Map<string, (typeof existingProducts)[number]>();
  const productById = new Map<string, (typeof existingProducts)[number]>();
  for (const p of existingProducts) {
    if (p.article_number) productByArticleNumber.set(p.article_number, p);
    productByNormalizedName.set(normalizeName(p.name), p);
    productById.set(p.id, p);
  }

  // Nieuw aan te maken producten verzamelen (dedupliceren binnen dit
  // bestand zelf: dezelfde naam bij meerdere leveranciers wordt niet
  // meerdere keren aangemaakt).
  const newlyCreatedByNormalizedName = new Map<string, string>(); // naam -> product_id
  const rowsNeedingNewProduct: ParsedProductRow[] = [];

  function resolveExistingProductId(row: ParsedProductRow): string | null {
    if (row.supplierArticleNumber) {
      const byArticle = productByArticleNumber.get(row.supplierArticleNumber);
      if (byArticle) return byArticle.id;
    }
    const byName = productByNormalizedName.get(normalizeName(row.name));
    if (byName) return byName.id;
    const createdName = newlyCreatedByNormalizedName.get(normalizeName(row.name));
    if (createdName) return createdName;
    return null;
  }

  for (const row of included) {
    if (!resolveExistingProductId(row)) {
      rowsNeedingNewProduct.push(row);
    }
  }

  // Nieuwe producten in batches aanmaken.
  let productsCreated = 0;
  for (const batch of chunk(rowsNeedingNewProduct, 500)) {
    // Binnen deze batch ook dedupliceren op naam vóór het invoegen.
    const seen = new Set<string>();
    const toInsert = batch.filter((row) => {
      const key = normalizeName(row.name);
      if (newlyCreatedByNormalizedName.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (toInsert.length === 0) continue;

    const { data: inserted, error: insertError } = await supabase
      .from("products")
      .insert(
        toInsert.map((row) => ({
          group_id: groupId,
          name: row.name,
          article_number: row.supplierArticleNumber,
          ean_code: row.eanCode,
          brand: row.brand,
          product_group: row.category,
          base_unit_id: unitByKey.get(row.packagingUnitKey ?? "stuk")?.id ?? unitByKey.get("stuk")?.id,
          kind: "inkoopartikel" as const,
          is_active: row.isAvailable,
        }))
      )
      .select("id, name, article_number, base_unit_id");

    if (insertError) {
      console.error("[product-import] Kan producten niet aanmaken:", insertError.message);
      continue;
    }
    for (const p of inserted ?? []) {
      newlyCreatedByNormalizedName.set(normalizeName(p.name), p.id);
      productById.set(p.id, p);
      productsCreated++;
    }
  }

  // Nu elke regel definitief aan een product koppelen en de prijs
  // vastleggen. Verpakkingshoeveelheid wordt omgerekend naar de
  // werkelijke basiseenheid van het gekoppelde product (kan afwijken
  // van de kleinste eenheid, zelfde correctie als bij facturen).
  const supplierProductsToInsert: {
    supplier_id: string;
    product_id: string;
    company_id: string | null;
    supplier_article_code: string | null;
    packaging_description: string | null;
    packaging_unit_count: number;
    purchase_price: number;
    is_contract_price: boolean;
    flagged_for_review: boolean;
    valid_from: string;
  }[] = [];

  let flaggedBySourceCount = 0;
  let flaggedForReview = 0;
  let skippedMissingPriceOrPackaging = 0;
  let skippedNoProductMatch = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const row of included) {
    if (row.purchasePrice === null || row.packagingUnitCount === null) {
      skippedMissingPriceOrPackaging++;
      if (skippedMissingPriceOrPackaging <= 5) {
        console.warn(
          `[product-import] Regel ${row.rowNumber} ("${row.name}") overgeslagen: prijs=${row.purchasePrice}, verpakking=${row.packagingUnitCount}.`
        );
      }
      continue;
    }

    const productId = resolveExistingProductId(row);
    if (!productId) {
      skippedNoProductMatch++;
      continue;
    }

    const product = productById.get(productId);
    let finalCount = row.packagingUnitCount;

    if (product?.base_unit_id && row.packagingUnitKey) {
      const packagingUnit = unitByKey.get(row.packagingUnitKey);
      const productUnit = unitById.get(product.base_unit_id);
      if (packagingUnit && productUnit) {
        if (packagingUnit.dimension === productUnit.dimension) {
          finalCount = (row.packagingUnitCount * packagingUnit.factor_to_base) / productUnit.factor_to_base;
        } else {
          // Dimensie klopt niet (bv. gewicht bij een product met een
          // inhoudseenheid) — niet gokken, deze regel overslaan voor
          // handmatige controle i.p.v. een verkeerde prijs op te slaan.
          flaggedForReview++;
          continue;
        }
      }
    }

    if (row.flaggedBySource) flaggedBySourceCount++;

    supplierProductsToInsert.push({
      supplier_id: supplierResolution[row.supplierNameRaw]!,
      product_id: productId,
      company_id: companyId || null,
      supplier_article_code: row.supplierArticleNumber,
      packaging_description: row.packagingDescription,
      packaging_unit_count: finalCount,
      purchase_price: row.purchasePrice,
      is_contract_price: false,
      // Rijen die het bronbestand zelf al als onzeker markeerde (bv. de
      // "Niet herkend"-kolom) blokkeren de import niet — ze worden
      // gewoon meegenomen, maar blijven gemarkeerd zodat je ze later in
      // je eigen tempo kunt doorlopen via "Producten opschonen".
      flagged_for_review: row.flaggedBySource,
      valid_from: today,
    });
  }

  let pricesInserted = 0;
  const priceBatches = chunk(supplierProductsToInsert, 500);
  console.log(
    `[product-import] ${supplierProductsToInsert.length} leveranciersprijzen te verwerken in ${priceBatches.length} batch(es).`
  );
  for (let i = 0; i < priceBatches.length; i++) {
    const batch = priceBatches[i];
    const { data: insertedPrices, error: priceError } = await supabase
      .from("supplier_products")
      .insert(batch)
      .select("id");
    if (priceError) {
      console.error(
        `[product-import] Batch ${i + 1}/${priceBatches.length}: kan leveranciersprijzen niet opslaan:`,
        priceError.message
      );
      continue;
    }
    const inserted = insertedPrices?.length ?? 0;
    if (inserted < batch.length) {
      console.warn(
        `[product-import] Batch ${i + 1}/${priceBatches.length}: slechts ${inserted} van ${batch.length} prijzen daadwerkelijk opgeslagen (mogelijk rechten-probleem).`
      );
    }
    pricesInserted += inserted;
    console.log(`[product-import] Batch ${i + 1}/${priceBatches.length} klaar (${pricesInserted} totaal tot nu toe).`);
  }

  const accountedFor =
    pricesInserted +
    skippedNoSupplier +
    flaggedForReview +
    skippedMissingPriceOrPackaging +
    skippedNoProductMatch;
  console.log(
    `[product-import] Klaar: ${productsCreated} nieuwe producten, ${pricesInserted} prijzen opgeslagen (waarvan ${flaggedBySourceCount} gemarkeerd voor latere controle), ${flaggedForReview} met afwijkende dimensie overgeslagen, ${skippedNoSupplier} zonder gekoppelde leverancier overgeslagen, ${skippedMissingPriceOrPackaging} zonder prijs/verpakking overgeslagen, ${skippedNoProductMatch} zonder productmatch overgeslagen. Totaal verantwoord: ${accountedFor}/${rows.length}.`
  );
  if (accountedFor !== rows.length) {
    console.error(
      `[product-import] LET OP: ${rows.length - accountedFor} regel(s) zijn nergens in geteld — dit duidt op een nog niet afgevangen situatie.`
    );
  }

  return NextResponse.json({
    totalRows: rows.length,
    productsCreated,
    pricesInserted,
    flaggedBySourceCount,
    skippedNoSupplier,
    flaggedForReview,
    skippedMissingPriceOrPackaging,
    skippedNoProductMatch,
  });
}

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
    ean_code: string | null;
    base_unit_id: string | null;
  }[] = [];
  {
    const PAGE_SIZE = 1000;
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from("products")
        .select("id, name, article_number, ean_code, base_unit_id")
        .eq("group_id", groupId)
        .range(from, from + PAGE_SIZE - 1);
      if (!data || data.length === 0) break;
      existingProducts.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  const productByArticleNumber = new Map<string, (typeof existingProducts)[number]>();
  const productByEan = new Map<string, (typeof existingProducts)[number]>();
  const productByNormalizedName = new Map<string, (typeof existingProducts)[number]>();
  const productById = new Map<string, (typeof existingProducts)[number]>();
  for (const p of existingProducts) {
    if (p.article_number) productByArticleNumber.set(p.article_number, p);
    if (p.ean_code) productByEan.set(p.ean_code, p);
    productByNormalizedName.set(normalizeName(p.name), p);
    productById.set(p.id, p);
  }

  // Nieuw aan te maken producten verzamelen (dedupliceren binnen dit
  // bestand zelf: dezelfde naam óf dezelfde EAN-code bij meerdere
  // leveranciers wordt niet meerdere keren aangemaakt — een dubbele
  // EAN in één invoegopdracht zou anders de unieke-EAN-check schenden
  // en de HELE batch van tot wel 500 producten laten mislukken).
  const newlyCreatedByNormalizedName = new Map<string, string>(); // naam -> product_id
  const newlyCreatedByEan = new Map<string, string>(); // ean -> product_id
  const rowsNeedingNewProduct: ParsedProductRow[] = [];

  function resolveExistingProductId(row: ParsedProductRow): string | null {
    if (row.supplierArticleNumber) {
      const byArticle = productByArticleNumber.get(row.supplierArticleNumber);
      if (byArticle) return byArticle.id;
    }
    if (row.eanCode) {
      const byEan = productByEan.get(row.eanCode);
      if (byEan) return byEan.id;
      const createdEan = newlyCreatedByEan.get(row.eanCode);
      if (createdEan) return createdEan;
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

  // Nieuwe producten in batches aanmaken. Faalt een hele batch (bv.
  // door één rij die alsnog een unieke-index schendt), dan wordt die
  // batch regel voor regel opnieuw geprobeerd — zodat één foute rij
  // nooit honderden goede rijen meesleurt in de mislukking.
  let productsCreated = 0;
  let productCreationFailures = 0;

  async function insertProductRows(toInsert: ParsedProductRow[]) {
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
      .select("id, name, article_number, base_unit_id, ean_code");
    return { inserted, insertError };
  }

  for (const batch of chunk(rowsNeedingNewProduct, 500)) {
    // Binnen deze batch dedupliceren op naam én EAN vóór het invoegen —
    // de meest voorkomende oorzaak van een volledig mislukte batch.
    const seenNames = new Set<string>();
    const seenEans = new Set<string>();
    const toInsert = batch.filter((row) => {
      const nameKey = normalizeName(row.name);
      if (newlyCreatedByNormalizedName.has(nameKey) || seenNames.has(nameKey)) return false;
      if (row.eanCode && (newlyCreatedByEan.has(row.eanCode) || seenEans.has(row.eanCode))) return false;
      seenNames.add(nameKey);
      if (row.eanCode) seenEans.add(row.eanCode);
      return true;
    });
    if (toInsert.length === 0) continue;

    const { inserted, insertError } = await insertProductRows(toInsert);

    if (!insertError) {
      for (const p of inserted ?? []) {
        newlyCreatedByNormalizedName.set(normalizeName(p.name), p.id);
        if (p.ean_code) newlyCreatedByEan.set(p.ean_code, p.id);
        productById.set(p.id, p);
        productsCreated++;
      }
      continue;
    }

    // Batch als geheel mislukt — per rij opnieuw proberen, zodat alleen
    // de daadwerkelijk foute rij(en) sneuvelen.
    console.warn(
      `[product-import] Batch van ${toInsert.length} nieuwe producten mislukt (${insertError.message}) — probeer regel voor regel opnieuw.`
    );
    for (const row of toInsert) {
      const { inserted: single, insertError: singleError } = await insertProductRows([row]);
      if (singleError || !single?.[0]) {
        productCreationFailures++;
        console.error(
          `[product-import] Kan product "${row.name}" (regel ${row.rowNumber}) niet aanmaken:`,
          singleError?.message
        );
        continue;
      }
      const p = single[0];
      newlyCreatedByNormalizedName.set(normalizeName(p.name), p.id);
      if (p.ean_code) newlyCreatedByEan.set(p.ean_code, p.id);
      productById.set(p.id, p);
      productsCreated++;
    }
  }

  // Bestaande actieve leveranciersprijzen vooraf ophalen — nodig om
  // exacte duplicaten te herkennen (dezelfde leverancier, product,
  // verpakking én prijs opnieuw importeren mag niets toevoegen) en om
  // bij een echte prijswijziging de oude regel netjes af te sluiten
  // i.p.v. een tweede "actieve" prijs ernaast te laten bestaan.
  const relevantSupplierIds = [...new Set(Object.values(supplierResolution).filter(Boolean))] as string[];
  const existingActivePrices = new Map<
    string,
    { id: string; purchase_price: number; packaging_unit_count: number }
  >();
  for (const supplierIdBatch of chunk(relevantSupplierIds, 50)) {
    const { data } = await supabase
      .from("supplier_products")
      .select("id, supplier_id, product_id, company_id, purchase_price, packaging_unit_count")
      .in("supplier_id", supplierIdBatch)
      .is("valid_to", null);
    for (const row of data ?? []) {
      existingActivePrices.set(`${row.supplier_id}:${row.product_id}:${row.company_id ?? "null"}`, row);
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
  const idsToClose: string[] = [];

  let flaggedBySourceCount = 0;
  let flaggedForReview = 0;
  let skippedMissingPriceOrPackaging = 0;
  let skippedNoProductMatch = 0;
  let alreadyUpToDate = 0;
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

    const supplierId = supplierResolution[row.supplierNameRaw]!;
    const dedupKey = `${supplierId}:${productId}:${companyId || "null"}`;
    const existing = existingActivePrices.get(dedupKey);

    if (existing) {
      const samePrice = Math.abs(existing.purchase_price - row.purchasePrice) < 0.0001;
      const samePackaging = Math.abs(existing.packaging_unit_count - finalCount) < 0.0001;
      if (samePrice && samePackaging) {
        // Exact dezelfde prijs staat al actief — niets te doen, geen
        // duplicaat aanmaken.
        alreadyUpToDate++;
        continue;
      }
      // Prijs of verpakking is gewijzigd: oude regel afsluiten, nieuwe
      // erbij — zelfde patroon als een gewone prijswijziging, i.p.v.
      // een tweede "actieve" prijs ernaast te laten bestaan.
      idsToClose.push(existing.id);
    }

    if (row.flaggedBySource) flaggedBySourceCount++;

    supplierProductsToInsert.push({
      supplier_id: supplierId,
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

  // Overschreven prijzen eerst netjes afsluiten (valid_to gisteren) —
  // vóór het invoegen van de nieuwe, zodat er nooit twee "actieve"
  // prijzen voor dezelfde leverancier+product naast elkaar blijven staan.
  if (idsToClose.length > 0) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    for (const idBatch of chunk(idsToClose, 500)) {
      const { error: closeError } = await supabase
        .from("supplier_products")
        .update({ valid_to: yesterday })
        .in("id", idBatch);
      if (closeError) {
        console.error("[product-import] Kan oude prijzen niet afsluiten:", closeError.message);
      }
    }
    console.log(`[product-import] ${idsToClose.length} verouderde prijs(en) afgesloten.`);
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
    alreadyUpToDate +
    skippedNoSupplier +
    flaggedForReview +
    skippedMissingPriceOrPackaging +
    skippedNoProductMatch;
  console.log(
    `[product-import] Klaar: ${productsCreated} nieuwe producten, ${productCreationFailures} product(en) echt niet aan te maken, ${pricesInserted} prijzen opgeslagen (waarvan ${flaggedBySourceCount} gemarkeerd voor latere controle), ${alreadyUpToDate} ongewijzigd (al identiek aanwezig, overgeslagen), ${flaggedForReview} met afwijkende dimensie overgeslagen, ${skippedNoSupplier} zonder gekoppelde leverancier overgeslagen, ${skippedMissingPriceOrPackaging} zonder prijs/verpakking overgeslagen, ${skippedNoProductMatch} zonder productmatch overgeslagen. Totaal verantwoord: ${accountedFor}/${rows.length}.`
  );
  if (accountedFor !== rows.length) {
    console.error(
      `[product-import] LET OP: ${rows.length - accountedFor} regel(s) zijn nergens in geteld — dit duidt op een nog niet afgevangen situatie.`
    );
  }

  return NextResponse.json({
    totalRows: rows.length,
    productsCreated,
    productCreationFailures,
    pricesInserted,
    alreadyUpToDate,
    flaggedBySourceCount,
    skippedNoSupplier,
    flaggedForReview,
    skippedMissingPriceOrPackaging,
    skippedNoProductMatch,
  });
}

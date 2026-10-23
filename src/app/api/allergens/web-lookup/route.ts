import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseOpenFoodFacts, type WebAllergenResult } from "@/lib/allergens/openfoodfacts";

export const maxDuration = 60;

const FIELDS = "product_name,allergens_tags,traces_tags,ingredients_text";

async function lookupEan(ean: string): Promise<WebAllergenResult> {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=${FIELDS}`,
      { headers: { "User-Agent": "Culilogic/1.0" }, signal: AbortSignal.timeout(8000) }
    );
    if (res.status === 404) return { status: "niet_gevonden", allergens: [], traces: [] };
    if (!res.ok) return { status: "fout", allergens: [], traces: [] };
    return parseOpenFoodFacts(await res.json());
  } catch {
    return { status: "fout", allergens: [], traces: [] };
  }
}

/**
 * Zoekt allergenen van ingrediënten op het web (Open Food Facts) via hun
 * EAN-code. Slaat NIETS op: de uitkomst is een voorstel dat de gebruiker in
 * het controlescherm beoordeelt.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 15)
    : [];
  if (ids.length === 0) return NextResponse.json({ results: {} });

  const { data: products, error } = await supabase
    .from("products")
    .select("id, ean_code")
    .in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Record<string, WebAllergenResult> = {};
  const queue = (products ?? []).filter((p) => p.ean_code && String(p.ean_code).trim() !== "");
  // Rustig opzoeken (3 tegelijk) om binnen de gratis limieten van Open Food Facts te blijven.
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      const p = queue[next++];
      results[p.id] = await lookupEan(String(p.ean_code).trim());
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return NextResponse.json({ results });
}

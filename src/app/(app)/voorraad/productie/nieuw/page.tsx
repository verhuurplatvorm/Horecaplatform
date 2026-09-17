"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

interface HalfproductLite {
  id: string;
  name: string;
}

/**
 * Productie registreren gebeurde op drie plekken tegelijk, elk met een
 * eigen ingrediënt- en kostprijsberekening: dit scherm, het schaalblok op
 * het halfproduct zelf, en het stickerscherm. Dat is nu teruggebracht tot
 * één invoerplek: het blok op het halfproduct, want alleen dáár kun je
 * schalen op een gewenste hoeveelheid óf op een beschikbaar ingrediënt,
 * en alleen dáár loopt de kostprijs via de centrale conversieregel
 * (inclusief netto bruikbaar gewicht).
 *
 * Dit scherm is daarom een kiezer geworden: zoek het halfproduct en ga
 * meteen naar de juiste plek. De route blijft bestaan zodat de knop op
 * /voorraad en bestaande bladwijzers blijven werken.
 */
export default function ProductieKiezenPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HalfproductLite[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(async () => {
      setLoading(true);
      const supabase = createClient();
      let q = supabase
        .from("recipes")
        .select("id, name")
        .eq("recipe_kind", "halfproduct")
        .order("name")
        .limit(15);
      if (query.trim()) q = q.ilike("name", `%${query.trim()}%`);
      const { data } = await q;
      if (!cancelled) {
        setResults((data as HalfproductLite[]) ?? []);
        setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  return (
    <>
      <Topbar title="Productie registreren" />
      <main className="max-w-2xl space-y-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Kies het halfproduct</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted">
              Registreren doe je op het halfproduct zelf — daar kun je de hoeveelheid
              schalen (of laten berekenen op basis van een beschikbaar ingrediënt), zie je
              de bijbehorende ingrediënten en kostprijs, en druk je direct de sticker af.
            </p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Zoek een halfproduct…"
                className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
              />
            </div>
            <div className="divide-y divide-border rounded-md border border-border">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => router.push(`/halfproducten/${r.id}/bewerken`)}
                  className="block w-full truncate px-3 py-2.5 text-left text-sm hover:bg-background"
                >
                  {r.name}
                </button>
              ))}
              {results.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted">
                  {loading ? "Zoeken…" : "Geen halfproducten gevonden."}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

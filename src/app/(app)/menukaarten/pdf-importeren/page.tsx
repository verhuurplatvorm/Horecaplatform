"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, TriangleAlert, Link2, CircleCheck } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { MENU_CATEGORIES } from "@/lib/menu-import/claude-menu-ocr";
import {
  candidatesForCompany,
  pickSuggestion,
  type DishCandidate,
  type MatchConfidence,
} from "@/lib/menu-import/dish-matching";

interface ReviewDish {
  name: string;
  description: string | null;
  price: number | null;
  category: string;
  candidates: DishCandidate[];
  include: boolean;
  linkedRecipeId: string | null;
  /** Hoe zeker het automatische voorstel is (null = geen voorstel). */
  confidence: MatchConfidence;
  /** Gebruiker heeft de koppeling zelf gekozen; niet meer automatisch wijzigen. */
  linkTouched: boolean;
}

function applySuggestion(dish: ReviewDish, companyId: string | null): ReviewDish {
  const { recipeId, confidence } = pickSuggestion(dish.candidates, companyId);
  return { ...dish, linkedRecipeId: recipeId, confidence };
}

export default function MenukaartPdfImporterenPage() {
  const router = useRouter();
  const { companies } = useCompanyScope();

  const [step, setStep] = useState<"upload" | "review">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [menuCardName, setMenuCardName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [dishes, setDishes] = useState<ReviewDish[]>([]);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExtract(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setExtracting(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/menu-import/extract", { method: "POST", body: formData });
    const body = await res.json();
    setExtracting(false);

    if (!res.ok) {
      setError(body.error ?? "Uitlezen mislukt.");
      return;
    }

    setDishes(
      body.dishes.map(
        (d: Omit<ReviewDish, "include" | "linkedRecipeId" | "confidence" | "linkTouched">) =>
          applySuggestion(
            {
              ...d,
              candidates: d.candidates ?? [],
              include: true,
              linkedRecipeId: null,
              confidence: null,
              linkTouched: false,
            },
            companyId || null
          )
      )
    );
    setStoragePath(body.storagePath);
    if (!menuCardName) {
      setMenuCardName(file.name.replace(/\.pdf$/i, ""));
    }
    setStep("review");
  }

  function updateDish(index: number, patch: Partial<ReviewDish>) {
    setDishes((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  /** Bij ander bedrijf: voorstellen opnieuw bepalen (alleen niet-handmatig gekozen regels). */
  function changeCompany(value: string) {
    setCompanyId(value);
    setDishes((prev) => prev.map((d) => (d.linkTouched ? d : applySuggestion(d, value || null))));
  }

  function acceptAllSuggestions() {
    setDishes((prev) => prev.map((d) => applySuggestion({ ...d, linkTouched: false }, companyId || null)));
  }

  function linkNothing() {
    setDishes((prev) =>
      prev.map((d) => ({ ...d, linkedRecipeId: null, confidence: null, linkTouched: true }))
    );
  }

  const linkStats = {
    sure: dishes.filter((d) => d.include && d.linkedRecipeId && d.confidence === "zeker").length,
    check: dishes.filter((d) => d.include && d.linkedRecipeId && d.confidence !== "zeker").length,
    created: dishes.filter((d) => d.include && !d.linkedRecipeId).length,
  };

  async function handleImport() {
    const included = dishes.filter((d) => d.include);
    if (included.length === 0) {
      setError("Selecteer minstens één gerecht om te importeren.");
      return;
    }
    setSaving(true);
    setError(null);

    const res = await fetch("/api/menu-import/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        menuCardName,
        companyId: companyId || null,
        storagePath,
        dishes: included.map((d) => ({
          name: d.name,
          description: d.description,
          price: d.price,
          category: d.category,
          linkedRecipeId: d.linkedRecipeId,
        })),
      }),
    });
    const body = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(body.error ?? "Importeren mislukt.");
      return;
    }
    router.push(`/menukaarten/${body.menuCardId}`);
  }

  if (step === "review") {
    return (
      <>
        <Topbar title="Menukaart controleren" />
        <main className="max-w-4xl space-y-4 p-6">
          <Card>
            <CardContent className="grid gap-4 py-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Naam menukaart
                </label>
                <input
                  value={menuCardName}
                  onChange={(e) => setMenuCardName(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Bedrijf</label>
                <select
                  value={companyId}
                  onChange={(e) => changeCompany(e.target.value)}
                  className="input"
                >
                  <option value="">Groepsbreed</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          <p className="text-sm text-muted">
            {dishes.length} gerecht(en) herkend. Controleer naam, omschrijving, prijs en categorie
            vóór definitieve import. Gerechten die al bestaan (bv. van de vorige kaart) worden
            automatisch gekoppeld i.p.v. dubbel aangemaakt.
          </p>

          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="flex items-center gap-1 text-success">
                  <CircleCheck className="h-4 w-4" />
                  {linkStats.sure} bestaand (zeker)
                </span>
                <span className="flex items-center gap-1 text-copper">
                  <TriangleAlert className="h-4 w-4" />
                  {linkStats.check} bestaand (controleren)
                </span>
                <span className="text-muted">{linkStats.created} nieuw aanmaken</span>
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={acceptAllSuggestions}>
                  <Link2 className="h-3.5 w-3.5" />
                  Voorstellen opnieuw toepassen
                </Button>
                <Button variant="secondary" onClick={linkNothing}>
                  Niets koppelen
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
<table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium"></th>
                    <th className="px-4 py-3 font-medium">Naam</th>
                    <th className="px-4 py-3 font-medium">Omschrijving</th>
                    <th className="px-4 py-3 font-medium">Prijs</th>
                    <th className="px-4 py-3 font-medium">Categorie</th>
                    <th className="px-4 py-3 font-medium">Bestaand gerecht</th>
                  </tr>
                </thead>
                <tbody>
                  {dishes.map((dish, i) => (
                    <tr key={i} className="border-t border-border align-top">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={dish.include}
                          onChange={(e) => updateDish(i, { include: e.target.checked })}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={dish.name}
                          onChange={(e) => updateDish(i, { name: e.target.value })}
                          className="input-sm"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={dish.description ?? ""}
                          onChange={(e) => updateDish(i, { description: e.target.value || null })}
                          className="input-sm"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.01"
                          value={dish.price ?? ""}
                          onChange={(e) =>
                            updateDish(i, { price: e.target.value ? Number(e.target.value) : null })
                          }
                          className="input-sm w-24"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={dish.category}
                          onChange={(e) => updateDish(i, { category: e.target.value })}
                          className="input-sm"
                        >
                          {MENU_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <LinkCell
                          dish={dish}
                          companyId={companyId || null}
                          onChange={(recipeId) =>
                            updateDish(i, {
                              linkedRecipeId: recipeId,
                              confidence: recipeId
                                ? dish.candidates.find((c) => c.recipe_id === recipeId)?.is_exact
                                  ? "zeker"
                                  : "waarschijnlijk"
                                : null,
                              linkTouched: true,
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
</div>
            </CardContent>
          </Card>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={handleImport} disabled={saving}>
              {saving ? "Bezig…" : `${dishes.filter((d) => d.include).length} gerecht(en) importeren`}
            </Button>
            <Button variant="secondary" onClick={() => setStep("upload")}>
              Terug
            </Button>
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
            .input-sm {
              display: block;
              width: 100%;
              height: 2rem;
              border-radius: 0.25rem;
              border: 1px solid var(--border);
              background: var(--surface);
              padding: 0 0.5rem;
              font-size: 0.8125rem;
            }
          `}</style>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar title="Menukaart uploaden (PDF)" />
      <main className="max-w-xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Menukaart automatisch inlezen</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleExtract} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  PDF van de menukaart
                </label>
                <input
                  required
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-teal file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-teal-light"
                />
                <p className="mt-1 text-xs text-muted">
                  Gerechten, omschrijvingen, prijzen en categorie worden automatisch herkend — je
                  controleert en past dit hierna nog aan vóór definitieve import.
                </p>
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}

              <Button type="submit" disabled={extracting || !file}>
                <Upload className="h-4 w-4" />
                {extracting ? "Bezig met uitlezen…" : "Uitlezen"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

function LinkCell({
  dish,
  companyId,
  onChange,
}: {
  dish: ReviewDish;
  companyId: string | null;
  onChange: (recipeId: string | null) => void;
}) {
  const usable = candidatesForCompany(dish.candidates, companyId);
  if (usable.length === 0) {
    return <span className="text-xs text-muted">nieuw</span>;
  }

  const linked = usable.find((c) => c.recipe_id === dish.linkedRecipeId);
  return (
    <div className="min-w-56 space-y-1">
      {linked && dish.confidence === "zeker" ? (
        <p className="flex items-center gap-1 text-xs text-success">
          <CircleCheck className="h-3.5 w-3.5" />
          Bestaat al — wordt gekoppeld
        </p>
      ) : linked ? (
        <p className="flex items-center gap-1 text-xs text-copper">
          <TriangleAlert className="h-3.5 w-3.5" />
          Waarschijnlijk hetzelfde — controleer
        </p>
      ) : (
        <p className="flex items-center gap-1 text-xs text-muted">
          <TriangleAlert className="h-3.5 w-3.5" />
          Lijkt op een bestaand gerecht
        </p>
      )}
      <select
        value={dish.linkedRecipeId ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="block h-8 w-full rounded border border-border bg-surface px-2 text-[0.8125rem]"
      >
        <option value="">Nieuw aanmaken</option>
        {usable.map((c) => (
          <option key={c.recipe_id} value={c.recipe_id}>
            Koppel aan &quot;{c.recipe_name}&quot;
            {c.sales_price !== null ? ` (€ ${c.sales_price.toFixed(2)})` : ""}
            {c.is_exact ? "" : ` · ${Math.round(c.similarity_score * 100)}%`}
          </option>
        ))}
      </select>
    </div>
  );
}

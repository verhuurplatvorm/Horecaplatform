"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, TriangleAlert, CheckCircle2 } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";

interface RecipeCandidate {
  recipe_id: string;
  recipe_name: string;
  similarity_score: number;
}

interface ReviewIngredient {
  name: string;
  quantity: number;
  unitRaw: string;
  supplierArticleNumber: string | null;
}

interface ReviewRecipe {
  name: string;
  externalId: string | null;
  folderName?: string | null;
  salesPriceInclVat?: number | null;
  vatRate?: number | null;
  ingredients: ReviewIngredient[];
  candidates: RecipeCandidate[];
  include: boolean;
  linkedRecipeId: string | null;
  /** Zelfde naam komt eerder in dit bestand voor — standaard overgeslagen. */
  inFileDuplicate?: boolean;
}

interface ImportResultRow {
  recipeName: string;
  recipeId: string;
  totalIngredients: number;
  matchedIngredients: number;
  unmatchedIngredients: number;
}

export default function HalfproductenImporterenPage() {
  const router = useRouter();
  const { companies } = useCompanyScope();

  const [step, setStep] = useState<"upload" | "review" | "done">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [recipeKind, setRecipeKind] = useState<"halfproduct" | "gerecht">("halfproduct");
  const [recipes, setRecipes] = useState<ReviewRecipe[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResultRow[]>([]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/recipe-import/upload", { method: "POST", body: formData });
      let body: { recipes?: (ReviewRecipe & { include?: boolean })[]; error?: string };
      try {
        body = await res.json();
      } catch {
        throw new Error(`De server gaf een onverwacht antwoord terug (HTTP ${res.status}).`);
      }
      if (!res.ok) {
        setError(body.error ?? "Kan bestand niet lezen.");
        return;
      }
      const seenNames = new Set<string>();
      setRecipes(
        (body.recipes ?? []).map((r) => {
          // Exacte naamsmatch met een bestaand recept → standaard
          // koppelen in plaats van nieuw aanmaken, zodat een herhaalde
          // import nooit dubbelen oplevert. De gebruiker kan alsnog
          // "Nieuw aanmaken" kiezen als het bewust een apart recept is.
          const exact = (r.candidates ?? []).find(
            (c) =>
              c.recipe_name.trim().toLowerCase() === r.name.trim().toLowerCase()
          );
          // Zelfde naam eerder in ditzelfde bestand (bronbestanden
          // bevatten soms letterlijk dubbele gerechten) → standaard
          // uitgevinkt, met een label erbij. Aanvinken kan altijd.
          const nameKey = r.name.trim().toLowerCase();
          const inFileDuplicate = seenNames.has(nameKey);
          seenNames.add(nameKey);
          return {
            ...r,
            include: !inFileDuplicate,
            linkedRecipeId: exact?.recipe_id ?? null,
            inFileDuplicate,
          };
        })
      );
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis bij het uploaden.");
    } finally {
      setUploading(false);
    }
  }

  function updateRecipe(index: number, patch: Partial<ReviewRecipe>) {
    setRecipes((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleImport() {
    const included = recipes.filter((r) => r.include);
    if (included.length === 0) {
      setError("Selecteer minstens één recept om te importeren.");
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/recipe-import/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipeKind,
          companyId: companyId || null,
          recipes: included.map((r) => ({
            name: r.name,
            externalId: r.externalId,
            folderName: r.folderName ?? null,
            salesPriceInclVat: r.salesPriceInclVat ?? null,
            vatRate: r.vatRate ?? null,
            ingredients: r.ingredients,
            linkedRecipeId: r.linkedRecipeId,
          })),
        }),
      });
      let body: { results?: ImportResultRow[]; error?: string; created?: number; linked?: number };
      try {
        body = await res.json();
      } catch {
        throw new Error(`De server gaf een onverwacht antwoord terug (HTTP ${res.status}).`);
      }
      if (!res.ok) {
        setError(body.error ?? "Importeren mislukt.");
        return;
      }
      setResults(body.results ?? []);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis bij het importeren.");
    } finally {
      setSaving(false);
    }
  }

  if (step === "done") {
    return (
      <>
        <Topbar title="Import voltooid" />
        <main className="max-w-3xl space-y-4 p-6">
          <Card>
            <CardContent className="py-4">
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" />
                {results.length} recept(en) geïmporteerd.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
<table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-medium">Naam</th>
                    <th className="px-5 py-3 font-medium">Ingrediënten</th>
                    <th className="px-5 py-3 font-medium">Gekoppeld</th>
                    <th className="px-5 py-3 font-medium">Nog te koppelen</th>
                    <th className="px-5 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.recipeId} className="border-t border-border">
                      <td className="px-5 py-3 font-medium">{r.recipeName}</td>
                      <td className="px-5 py-3 text-muted">{r.totalIngredients}</td>
                      <td className="px-5 py-3 text-success">{r.matchedIngredients}</td>
                      <td className="px-5 py-3">
                        {r.unmatchedIngredients > 0 ? (
                          <span className="flex items-center gap-1 text-danger">
                            <TriangleAlert className="h-3.5 w-3.5" />
                            {r.unmatchedIngredients}
                          </span>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <a
                          href={
                            recipeKind === "halfproduct"
                              ? `/halfproducten/${r.recipeId}/bewerken`
                              : `/recepturen/${r.recipeId}/bewerken`
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="text-teal hover:underline"
                        >
                          Openen →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
</div>
            </CardContent>
          </Card>
          <Button variant="secondary" onClick={() => router.push("/halfproducten")}>
            Terug naar overzicht
          </Button>
        </main>
      </>
    );
  }

  if (step === "review") {
    return (
      <>
        <Topbar title="Import controleren" />
        <main className="max-w-5xl space-y-4 p-6">
          <p className="text-sm text-muted">
            {recipes.length} recept(en) herkend. Regels met een gelijkende bestaande naam kun je
            koppelen in plaats van dubbel aanmaken. Ingrediënten die niet automatisch gekoppeld
            konden worden, blijven gewoon onderdeel van het recept — je koppelt of maakt ze aan
            op de receptpagina zelf, duidelijk rood gemarkeerd.
          </p>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="space-y-3">
            {recipes.map((recipe, i) => (
              <Card key={i}>
                <CardContent className="space-y-2 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 font-medium text-foreground">
                      <input
                        type="checkbox"
                        checked={recipe.include}
                        onChange={(e) => updateRecipe(i, { include: e.target.checked })}
                      />
                      {recipe.name}
                      {recipe.inFileDuplicate && (
                        <span className="rounded-full bg-copper/10 px-2 py-0.5 text-xs font-normal text-copper">
                          dubbel in bestand — overgeslagen
                        </span>
                      )}
                      {recipe.linkedRecipeId && !recipe.inFileDuplicate && (
                        <span className="rounded-full bg-teal/10 px-2 py-0.5 text-xs font-normal text-teal">
                          wordt gekoppeld aan bestaand
                        </span>
                      )}
                      {recipe.folderName && (
                        <span className="rounded-full bg-background px-2 py-0.5 text-xs font-normal text-muted">
                          map: {recipe.folderName}
                        </span>
                      )}
                      {recipe.externalId && (
                        <span className="text-xs font-normal text-muted">
                          (extern ID: {recipe.externalId})
                        </span>
                      )}
                    </label>
                    <span className="text-xs text-muted">
                      {recipe.ingredients.length} ingrediënt(en)
                    </span>
                  </div>
                  {recipe.candidates.length > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-copper" />
                      <span className="text-copper">Lijkt op bestaand recept:</span>
                      <select
                        value={recipe.linkedRecipeId ?? ""}
                        onChange={(e) =>
                          updateRecipe(i, { linkedRecipeId: e.target.value || null })
                        }
                        className="h-7 rounded-md border border-border bg-surface px-2"
                      >
                        <option value="">Nieuw aanmaken</option>
                        {recipe.candidates.map((c) => (
                          <option key={c.recipe_id} value={c.recipe_id}>
                            Koppel aan &quot;{c.recipe_name}&quot;
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handleImport} disabled={saving}>
              {saving
                ? "Bezig…"
                : `${recipes.filter((r) => r.include).length} recept(en) importeren`}
            </Button>
            <Button variant="secondary" onClick={() => setStep("upload")}>
              Terug
            </Button>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar title="Halfproducten/recepten importeren (Excel)" />
      <main className="max-w-xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Excel-bestand importeren</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Importeren als
                </label>
                <select
                  value={recipeKind}
                  onChange={(e) => setRecipeKind(e.target.value as "halfproduct" | "gerecht")}
                  className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
                >
                  <option value="halfproduct">Halfproducten</option>
                  <option value="gerecht">Gerechten</option>
                </select>
                <p className="mt-1 text-xs text-muted">
                  Geldt voor alle recepten in dit bestand.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Bedrijf (optioneel)
                </label>
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
                >
                  <option value="">Groepsbreed</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Excel-bestand
                </label>
                <input
                  required
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-teal file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-teal-light"
                />
                <p className="mt-1 text-xs text-muted">
                  Verwacht formaat: per recept een rij &quot;Item naam: ...&quot;, gevolgd door
                  ingrediëntregels (Naam, Hoeveelheid, Eenheid, Leverancier artikelnr., ...).
                </p>
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}

              <Button type="submit" disabled={uploading || !file}>
                <Upload className="h-4 w-4" />
                {uploading ? "Bezig met inlezen…" : "Inlezen"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

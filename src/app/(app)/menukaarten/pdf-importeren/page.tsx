"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, TriangleAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { MENU_CATEGORIES } from "@/lib/menu-import/claude-menu-ocr";

interface RecipeCandidate {
  recipe_id: string;
  recipe_name: string;
  similarity_score: number;
}

interface ReviewDish {
  name: string;
  description: string | null;
  price: number | null;
  category: string;
  candidates: RecipeCandidate[];
  include: boolean;
  linkedRecipeId: string | null;
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
      body.dishes.map((d: Omit<ReviewDish, "include" | "linkedRecipeId">) => ({
        ...d,
        include: true,
        linkedRecipeId: null,
      }))
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
                  onChange={(e) => setCompanyId(e.target.value)}
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
            vóór definitieve import — regels met een gelijkend bestaand gerecht kun je koppelen
            i.p.v. dubbel aanmaken.
          </p>

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
                    <th className="px-4 py-3 font-medium">Dubbel?</th>
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
                        {dish.candidates.length > 0 ? (
                          <div className="space-y-1">
                            <p className="flex items-center gap-1 text-xs text-copper">
                              <TriangleAlert className="h-3.5 w-3.5" />
                              Lijkt op:
                            </p>
                            <select
                              value={dish.linkedRecipeId ?? ""}
                              onChange={(e) =>
                                updateDish(i, { linkedRecipeId: e.target.value || null })
                              }
                              className="input-sm"
                            >
                              <option value="">Nieuw aanmaken</option>
                              {dish.candidates.map((c) => (
                                <option key={c.recipe_id} value={c.recipe_id}>
                                  Koppel aan &quot;{c.recipe_name}&quot;
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <span className="text-xs text-muted">nieuw</span>
                        )}
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

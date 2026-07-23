"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { Company, Supplier } from "@/lib/types/database";

export default function ImporterenPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("suppliers")
      .select("*")
      .order("name")
      .then(({ data }) => setSuppliers((data as Supplier[]) ?? []));
    supabase
      .from("companies")
      .select("*")
      .order("name")
      .then(({ data }) => setCompanies((data as Company[]) ?? []));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !supplierId) return;

    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("supplierId", supplierId);
    if (companyId) formData.append("companyId", companyId);

    const res = await fetch("/api/price-imports", {
      method: "POST",
      body: formData,
    });
    const body = await res.json();

    setSubmitting(false);

    if (!res.ok) {
      setError(body.error ?? "Er ging iets mis bij het importeren.");
      return;
    }

    router.push(`/leveranciers/prijzen/importeren/${body.batchId}`);
  }

  return (
    <>
      <Topbar title="Prijslijst importeren" />
      <main className="p-6 max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Nieuwe prijslijst uploaden</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Leverancier
                </label>
                <select
                  required
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
                >
                  <option value="">Kies een leverancier…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Geldig voor bedrijf (optioneel)
                </label>
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
                >
                  <option value="">Groepsbreed (alle bedrijven)</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">
                  Laat leeg als deze leverancier voor de hele groep dezelfde
                  prijzen hanteert.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Bestand (.csv, .xlsx of .xls)
                </label>
                <input
                  required
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-teal file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-teal-light"
                />
                <p className="mt-1 text-xs text-muted">
                  Verwacht minimaal een kolom met EAN-code of artikelnummer,
                  en een kolom met de inkoopprijs.
                </p>
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}

              <Button type="submit" disabled={submitting || !file || !supplierId}>
                <Upload className="h-4 w-4" />
                {submitting ? "Bezig met verwerken…" : "Importeren"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

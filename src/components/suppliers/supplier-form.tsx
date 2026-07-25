"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyScope } from "@/components/company-context";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import type { Supplier } from "@/lib/types/database";

const DAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

export interface SupplierFormProps {
  initialSupplier?: Supplier;
}

export function SupplierForm({ initialSupplier }: SupplierFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialSupplier);
  const { companies } = useCompanyScope();

  const [name, setName] = useState(initialSupplier?.name ?? "");
  const [contactName, setContactName] = useState(initialSupplier?.contact_name ?? "");
  const [email, setEmail] = useState(initialSupplier?.email ?? "");
  const [phone, setPhone] = useState(initialSupplier?.phone ?? "");
  const [street, setStreet] = useState(initialSupplier?.address?.street ?? "");
  const [zip, setZip] = useState(initialSupplier?.address?.zip ?? "");
  const [city, setCity] = useState(initialSupplier?.address?.city ?? "");
  const [paymentTermsDays, setPaymentTermsDays] = useState(
    initialSupplier?.payment_terms_days?.toString() ?? ""
  );
  const [minimumOrderAmount, setMinimumOrderAmount] = useState(
    initialSupplier?.minimum_order_amount?.toString() ?? ""
  );
  const [deliveryDays, setDeliveryDays] = useState<Set<string>>(
    new Set(initialSupplier?.delivery_days ?? [])
  );
  const [scopeChoice, setScopeChoice] = useState<"central" | "company">(
    initialSupplier?.company_id ? "company" : "central"
  );
  const [companyId, setCompanyId] = useState(initialSupplier?.company_id ?? "");
  const [isActive, setIsActive] = useState(initialSupplier?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(day: string) {
    setDeliveryDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (scopeChoice === "company" && !companyId) {
      setError("Kies een bedrijf, of zet het bereik op groepsbreed.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const payload = {
      name: name.trim(),
      contact_name: contactName.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      address:
        street.trim() || zip.trim() || city.trim()
          ? { street: street.trim(), zip: zip.trim(), city: city.trim() }
          : null,
      payment_terms_days: paymentTermsDays ? Number(paymentTermsDays) : null,
      minimum_order_amount: minimumOrderAmount ? Number(minimumOrderAmount) : null,
      delivery_days: Array.from(deliveryDays),
      company_id: scopeChoice === "company" ? companyId : null,
      is_active: isActive,
    };

    if (isEdit && initialSupplier) {
      const { error: updateError } = await supabase
        .from("suppliers")
        .update(payload)
        .eq("id", initialSupplier.id);
      setSaving(false);
      if (updateError) {
        setError("Opslaan mislukt: " + updateError.message);
        return;
      }
    } else {
      const groupId = await getCurrentGroupId(supabase);
      if (!groupId) {
        setError("Kan groep van gebruiker niet bepalen. Log opnieuw in.");
        setSaving(false);
        return;
      }
      const { error: insertError } = await supabase
        .from("suppliers")
        .insert({ ...payload, group_id: groupId });
      setSaving(false);
      if (insertError) {
        setError("Opslaan mislukt: " + insertError.message);
        return;
      }
    }

    router.push("/leveranciers");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Basisgegevens</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Naam" required>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </Field>
          <Field label="Contactpersoon">
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="E-mail">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Telefoon">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" />
          </Field>
          <Field label="Bereik">
            <select
              value={scopeChoice}
              onChange={(e) => setScopeChoice(e.target.value as "central" | "company")}
              className="input"
            >
              <option value="central">Groepsbreed</option>
              <option value="company">Eén bedrijf</option>
            </select>
          </Field>
          {scopeChoice === "company" && (
            <Field label="Bedrijf" required>
              <select
                required
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="input"
              >
                <option value="">Kies…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Adres</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Straat + nummer">
            <input value={street} onChange={(e) => setStreet(e.target.value)} className="input" />
          </Field>
          <Field label="Postcode">
            <input value={zip} onChange={(e) => setZip(e.target.value)} className="input" />
          </Field>
          <Field label="Plaats">
            <input value={city} onChange={(e) => setCity(e.target.value)} className="input" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bestel- en betaalafspraken</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Betaaltermijn (dagen)">
              <input
                type="number"
                value={paymentTermsDays}
                onChange={(e) => setPaymentTermsDays(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Minimale bestelwaarde (€)">
              <input
                type="number"
                step="0.01"
                value={minimumOrderAmount}
                onChange={(e) => setMinimumOrderAmount(e.target.value)}
                className="input"
              />
            </Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">Leverdagen</p>
            <div className="flex flex-wrap gap-3">
              {DAYS.map((day) => (
                <label key={day} className="flex items-center gap-1.5 text-sm capitalize">
                  <input
                    type="checkbox"
                    checked={deliveryDays.has(day)}
                    onChange={() => toggleDay(day)}
                  />
                  {day}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Actief
          </label>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Opslaan…" : isEdit ? "Wijzigingen opslaan" : "Leverancier aanmaken"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push("/leveranciers")}>
          Annuleren
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
      `}</style>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-foreground">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}

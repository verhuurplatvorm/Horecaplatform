"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getCurrentGroupId } from "@/lib/supabase/current-group";

export default function FactuurverwerkingInstellingenPage() {
  const [groupId, setGroupId] = useState<string | null>(null);
  const [foodcostNorm, setFoodcostNorm] = useState("33");
  const [priceAlertThreshold, setPriceAlertThreshold] = useState("10");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const supabase = createClient();
    const id = await getCurrentGroupId(supabase);
    setGroupId(id);
    if (!id) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("groups")
      .select("foodcost_norm_pct, price_alert_threshold_pct")
      .eq("id", id)
      .maybeSingle();
    if (data) {
      setFoodcostNorm(String(data.foodcost_norm_pct));
      setPriceAlertThreshold(String(data.price_alert_threshold_pct));
    }
    setLoading(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("groups")
      .update({
        foodcost_norm_pct: Number(foodcostNorm),
        price_alert_threshold_pct: Number(priceAlertThreshold),
      })
      .eq("id", groupId);
    setSaving(false);
    if (updateError) {
      setError(
        updateError.message.includes("row-level security")
          ? "Alleen groepsbeheerders mogen deze instellingen wijzigen."
          : "Opslaan mislukt: " + updateError.message
      );
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return (
      <>
        <Topbar title="Factuurverwerking" />
        <main className="p-6 text-sm text-muted">Laden…</main>
      </>
    );
  }

  return (
    <>
      <Topbar title="Factuurverwerking" />
      <main className="max-w-2xl space-y-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Factuurmailbox</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted">
              E-mailfacturen komen automatisch binnen via een of meerdere factuur-mailboxen. Elke
              mailbox krijgt een geheime ontvangst-URL die je instelt bij een
              e-mail-ontvangstdienst (bijv. Mailgun of Postmark inbound routing) — die dienst
              ontvangt de e-mail op het adres dat je daar zelf kiest (bv.
              facturen@uwbedrijf.nl) en stuurt de bijlagen vervolgens door naar deze URL.
            </p>
            <div className="flex gap-2">
              <Link href="/leveranciers/facturen/mailboxen">
                <Button variant="secondary">Mailboxen beheren</Button>
              </Link>
              <Link href="/leveranciers/facturen/mailbox">
                <Button variant="secondary">Statusoverzicht</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Signalering</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  Foodcost-norm (%)
                </label>
                <p className="mb-1.5 text-xs text-muted">
                  Een gerecht wordt als margeprobleem gesignaleerd (op het dashboard en in
                  Recepten) zodra de foodcost boven dit percentage komt — ook wanneer dat door
                  een prijswijziging uit een factuur komt. Verkoopprijzen worden hierbij nooit
                  automatisch aangepast, alleen gesignaleerd.
                </p>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={foodcostNorm}
                  onChange={(e) => setFoodcostNorm(e.target.value)}
                  className="input w-32"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  Prijsalarm-drempel (%)
                </label>
                <p className="mb-1.5 text-xs text-muted">
                  Een prijswijziging van een leverancier (ook via de factuurmailbox) wordt als
                  prijsalarm gemarkeerd zodra de afwijking dit percentage overschrijdt.
                </p>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={priceAlertThreshold}
                  onChange={(e) => setPriceAlertThreshold(e.target.value)}
                  className="input w-32"
                />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? "Bezig…" : "Opslaan"}
                </Button>
                {saved && <span className="text-sm text-success">Opgeslagen.</span>}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Veiligheid</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm text-muted">
            <p>
              Een e-mailfactuur wordt alleen automatisch doorgezet naar een prijsimport-batch
              wanneer de leverancier met zekerheid herkend is (btw-nummer, KvK-nummer of IBAN).
              Bij twijfel, een afwijkend IBAN, of een PDF die niet leesbaar is, komt de factuur in
              &quot;Controle nodig&quot; terecht voor een menselijke beoordeling.
            </p>
            <p>
              Ook bij een zekere match worden prijzen niet meteen in de live database
              doorgevoerd: er wordt een batch aangemaakt die je op het Facturen-scherm bevestigt
              voordat de nieuwe prijzen daadwerkelijk gelden.
            </p>
            <p>
              Een e-mailfactuur die al eerder is binnengekomen (zelfde bijlage, of zelfde
              leverancier + factuurnummer + totaalbedrag) wordt herkend als dubbele factuur en
              niet opnieuw verwerkt.
            </p>
          </CardContent>
        </Card>

        <style jsx>{`
          .input {
            display: block;
            height: 2.5rem;
            border-radius: 0.375rem;
            border: 1px solid var(--border);
            background: var(--surface);
            padding: 0 0.75rem;
            font-size: 0.875rem;
          }
        `}</style>
      </main>
    </>
  );
}

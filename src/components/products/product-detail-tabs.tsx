"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ProductForm } from "@/components/products/product-form";
import { ProductPricing } from "@/components/products/product-pricing";
import { ProductUsageTab } from "@/components/products/product-usage-tab";
import { cn } from "@/lib/utils";
import type { Product, ProductPackaging } from "@/lib/types/database";

const TABS = [
  { key: "algemeen", label: "Algemeen" },
  { key: "gebruik", label: "Gebruik & recepten" },
  { key: "prijs", label: "Prijs & historie" },
  { key: "allergenen", label: "Allergenen & voedingswaarden" },
  { key: "voorraad", label: "Voorraad & inkoop" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Het ingrediëntscherm toonde alles tegelijk onder elkaar: basisgegevens,
 * eenheden, allergenen, voedingswaarden, voorraad én prijzen. Dat is nu
 * verdeeld over tabs, met bovenaan een vaste balk met wat een kok als
 * eerste wil zien.
 *
 * Belangrijk: het formulier zelf blijft één geheel. De tabs bepalen
 * alleen wat je ziet — één keer opslaan bewaart alle velden, ook die op
 * een tab die je niet open hebt staan.
 */
export function ProductDetailTabs({
  product,
  packagings,
  baseUnitName,
  supplierName,
  prevId,
  nextId,
}: {
  product: Product;
  packagings: ProductPackaging[];
  baseUnitName: string | null;
  supplierName: string | null;
  prevId: string | null;
  nextId: string | null;
}) {
  const [tab, setTab] = useState<TabKey>("algemeen");

  return (
    <div className="space-y-4">
      {/* Vaste kop: altijd zichtbaar, ongeacht de tab */}
      <div className="sticky top-0 z-30 -mx-6 border-b border-border bg-background px-6 pb-3 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-foreground">
              {product.custom_name?.trim() || product.name}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {product.product_number != null && <span>ID {product.product_number}</span>}
              {product.article_number && <span>art. {product.article_number}</span>}
              <span>{supplierName ?? "geen leverancier"}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5",
                  product.is_active
                    ? "bg-success/10 text-success"
                    : "bg-muted/10 text-muted"
                )}
              >
                {product.is_active ? "Beschikbaar" : "Niet actief"}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            {prevId ? (
              <Link
                href={`/producten/${prevId}/bewerken`}
                title="Vorige ingrediënt"
                className="rounded-md border border-border p-1.5 hover:bg-surface"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
            ) : (
              <span className="rounded-md border border-border p-1.5 opacity-30">
                <ChevronLeft className="h-4 w-4" />
              </span>
            )}
            {nextId ? (
              <Link
                href={`/producten/${nextId}/bewerken`}
                title="Volgende ingrediënt"
                className="rounded-md border border-border p-1.5 hover:bg-surface"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className="rounded-md border border-border p-1.5 opacity-30">
                <ChevronRight className="h-4 w-4" />
              </span>
            )}
          </div>
        </div>

        <nav className="mt-3 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-1.5 text-sm transition-colors",
                tab === t.key
                  ? "border-teal font-medium text-teal"
                  : "border-transparent text-muted hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Het formulier blijft altijd gemonteerd zodat één keer opslaan
          alle velden bewaart; de tab bepaalt welke secties zichtbaar zijn. */}
      <div className={tab === "gebruik" || tab === "prijs" ? "hidden" : undefined}>
        <ProductForm
          initialProduct={product}
          initialPackagings={packagings}
          activeTab={
            tab === "allergenen"
              ? "allergenen"
              : tab === "voorraad"
                ? "voorraad"
                : "algemeen"
          }
        />
      </div>

      {tab === "gebruik" && <ProductUsageTab productId={product.id} />}

      {tab === "prijs" && (
        <div id="prijzen">
          <ProductPricing productId={product.id} baseUnitName={baseUnitName} />
        </div>
      )}
    </div>
  );
}

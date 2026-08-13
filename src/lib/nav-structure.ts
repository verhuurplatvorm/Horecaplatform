import type { LucideIcon } from "lucide-react";
import {
  Package,
  Truck,
  BookOpen,
  SoupIcon,
  Warehouse,
  Building2,
  Users,
  UtensilsCrossed,
  ShoppingCart,
  // PrinterIcon, // terug in gebruik zodra Besteladvies weer actief is
  LineChart,
  History,
  ShieldCheck,
  FileText,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** module_key uit PERMISSION_MODULES — bepaalt zichtbaarheid per rol. null = altijd zichtbaar (geen gevoelige module). */
  moduleKey: string | null;
}

export interface NavTab {
  key: string;
  label: string;
  items: NavItem[];
}

// Hoofdindeling: 5 tabbladen bovenaan, elk met de bestaande pagina's
// gegroepeerd naar waar ze inhoudelijk bij horen. Geen enkele bestaande
// functie is verwijderd — alleen anders ingedeeld.
export const NAV_TABS: NavTab[] = [
  {
    key: "keuken",
    label: "Keuken",
    items: [
      { href: "/recepturen", label: "Recepten (Gerechten)", icon: BookOpen, moduleKey: "recepturen" },
      { href: "/halfproducten", label: "Halfproducten", icon: SoupIcon, moduleKey: "halfproducten" },
      { href: "/menukaarten", label: "Menukaarten", icon: UtensilsCrossed, moduleKey: "menukaarten" },
    ],
  },
  {
    key: "inkoop",
    label: "Inkoop & Voorraad",
    items: [
      { href: "/producten", label: "Ingrediënten", icon: Package, moduleKey: "producten" },
      { href: "/leveranciers", label: "Leveranciers", icon: Truck, moduleKey: "leveranciers" },
      { href: "/verkoopproducten", label: "Verkoopproducten", icon: ShoppingCart, moduleKey: "verkoopproducten" },
    ],
  },
  {
    key: "productie",
    label: "Productie",
    items: [
      { href: "/voorraad", label: "Producties", icon: Warehouse, moduleKey: "producties" },
      // Besteladvies rekent met min_stock_quantity t.o.v. actuele
      // voorraad — de voorraadmodule zelf staat nog niet aan (geen
      // verbruiksregistratie), dus dit advies zou nu op onvolledige
      // cijfers draaien. Verborgen tot voorraad daadwerkelijk in
      // gebruik wordt genomen. De pagina zelf blijft bestaan.
      // { href: "/voorraad/besteladvies", label: "Besteladvies", icon: PrinterIcon, moduleKey: "voorraad" },
    ],
  },
  {
    key: "financieel",
    label: "Financieel",
    items: [
      { href: "/financieel", label: "Overzicht", icon: LineChart, moduleKey: "leveranciers" },
      { href: "/financieel/bedrijven", label: "Per bedrijf", icon: Building2, moduleKey: "leveranciers" },
      { href: "/leveranciers/prijzen/wijzigingen", label: "Prijswijzigingen", icon: History, moduleKey: "leveranciers" },
      { href: "/leveranciers/facturen", label: "Facturen", icon: FileText, moduleKey: "leveranciers" },
    ],
  },
  {
    key: "beheer",
    label: "Beheer",
    items: [
      { href: "/bedrijven", label: "Bedrijven", icon: Building2, moduleKey: "bedrijven" },
      { href: "/gebruikers", label: "Gebruikers & rechten", icon: Users, moduleKey: "gebruikers" },
      { href: "/gebruikers/rollen", label: "Rollen", icon: ShieldCheck, moduleKey: "gebruikers" },
      { href: "/beheer/wijzigingslog", label: "Wijzigingslog", icon: History, moduleKey: "gebruikers" },
    ],
  },
];

/** Zoekt bij een pad het bijbehorende tabblad (voor het markeren van de actieve tab en het bepalen van de zij-navigatie). */
export function findTabForPath(pathname: string): NavTab | null {
  for (const tab of NAV_TABS) {
    if (tab.items.some((item) => pathname.startsWith(item.href))) return tab;
  }
  return null;
}

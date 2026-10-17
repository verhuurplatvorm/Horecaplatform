import type { LucideIcon } from "lucide-react";
import {
  Package,
  Truck,
  BookOpen,
  SoupIcon,
  Warehouse,
  Building2,
  Trash2,
  Users,
  UtensilsCrossed,
  ShoppingCart,
  // PrinterIcon, // terug in gebruik zodra Besteladvies weer actief is
  LineChart,
  History,
  ShieldCheck,
  FileText,
  Mail,
  Upload,
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

// Hoofdindeling: 4 tabbladen. Geen enkele functie is verwijderd — alleen
// anders ingedeeld (opschoning stap 1).
export const NAV_TABS: NavTab[] = [
  {
    key: "keuken",
    label: "Keuken",
    items: [
      { href: "/recepturen", label: "Gerechten", icon: BookOpen, moduleKey: "recepturen" },
      { href: "/halfproducten", label: "Halfproducten", icon: SoupIcon, moduleKey: "halfproducten" },
      { href: "/menus", label: "Menu's & buffetten", icon: UtensilsCrossed, moduleKey: "menukaarten" },
      { href: "/menukaarten", label: "Menukaarten", icon: UtensilsCrossed, moduleKey: "menukaarten" },
      { href: "/afval", label: "Afvalregistratie", icon: Trash2, moduleKey: "afval" },
      { href: "/voorraad", label: "Producties", icon: Warehouse, moduleKey: "producties" },
    ],
  },
  {
    key: "inkoop",
    label: "Inkoop",
    items: [
      { href: "/producten", label: "Ingrediënten", icon: Package, moduleKey: "producten" },
      { href: "/leveranciers", label: "Leveranciers", icon: Truck, moduleKey: "leveranciers" },
      { href: "/verkoopproducten", label: "Verkoopproducten", icon: ShoppingCart, moduleKey: "verkoopproducten" },
    ],
  },
  {
    key: "prijzen",
    label: "Prijzen & facturen",
    items: [
      { href: "/leveranciers/facturen", label: "Facturen", icon: FileText, moduleKey: "leveranciers" },
      { href: "/leveranciers/prijzen/wijzigingen", label: "Prijswijzigingen", icon: History, moduleKey: "leveranciers" },
      { href: "/dashboard/prijzen", label: "Prijsontwikkeling", icon: LineChart, moduleKey: "leveranciers" },
      { href: "/financieel/bedrijven", label: "Per bedrijf", icon: Building2, moduleKey: "leveranciers" },
    ],
  },
  {
    key: "beheer",
    label: "Beheer",
    items: [
      { href: "/importeren", label: "Importeren", icon: Upload, moduleKey: "producten" },
      { href: "/bedrijven", label: "Bedrijven", icon: Building2, moduleKey: "bedrijven" },
      { href: "/gebruikers", label: "Gebruikers & rechten", icon: Users, moduleKey: "gebruikers" },
      { href: "/gebruikers/rollen", label: "Rollen", icon: ShieldCheck, moduleKey: "gebruikers" },
      { href: "/beheer/wijzigingslog", label: "Wijzigingslog", icon: History, moduleKey: "gebruikers" },
      { href: "/beheer/factuurverwerking", label: "Factuurverwerking", icon: Mail, moduleKey: "gebruikers" },
    ],
  },
];

/** Zoekt bij een pad het bijbehorende tabblad (voor het markeren van de actieve tab en het bepalen van de zij-navigatie). */
export function findTabForPath(pathname: string): NavTab | null {
  let best: { tab: NavTab; len: number } | null = null;
  for (const tab of NAV_TABS) {
    for (const item of tab.items) {
      if (pathname.startsWith(item.href) && (!best || item.href.length > best.len)) {
        best = { tab, len: item.href.length };
      }
    }
  }
  return best?.tab ?? null;
}

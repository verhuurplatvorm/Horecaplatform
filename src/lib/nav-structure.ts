import type { LucideIcon } from "lucide-react";
import {
  Search,
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
  Scale,
  ClipboardCheck,
  ListChecks,
  Settings,
  ScrollText,
  ShieldAlert,
  Printer,
  Tags,
  Timer,
  ClipboardList,
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
  /** Pagina die opent als je op het tabblad klikt (als die zichtbaar is); anders het eerste item. */
  homeHref?: string;
}

// Hoofdindeling: 4 tabbladen. Geen enkele functie is verwijderd — alleen
// anders ingedeeld (opschoning stap 1).
export const NAV_TABS: NavTab[] = [
  {
    key: "keuken",
    label: "Keuken",
    homeHref: "/recepturen",
    items: [
      {
        href: "/stickers",
        label: "Sticker afdrukken",
        icon: Printer,
        moduleKey: "stickers",
      },
      {
        href: "/menukaarten",
        label: "Menukaarten",
        icon: UtensilsCrossed,
        moduleKey: "menukaarten",
      },
      {
        href: "/recepturen",
        label: "Gerechten",
        icon: BookOpen,
        moduleKey: "recepturen",
      },
      {
        href: "/halfproducten",
        label: "Halfproducten",
        icon: SoupIcon,
        moduleKey: "halfproducten",
      },
      {
        href: "/menus",
        label: "Menu's & buffetten",
        icon: UtensilsCrossed,
        moduleKey: "menukaarten",
      },
      {
        href: "/afval",
        label: "Afvalregistratie",
        icon: Trash2,
        moduleKey: "afval",
      },
      {
        href: "/keukenlijsten",
        label: "Keukenlijsten",
        icon: ClipboardList,
        moduleKey: "recepturen",
      },
      {
        href: "/voorraad",
        label: "Producties",
        icon: Warehouse,
        moduleKey: "producties",
      },
    ],
  },
  {
    key: "haccp",
    label: "HACCP",
    homeHref: "/haccp/vandaag",
    items: [
      {
        href: "/haccp/vandaag",
        label: "Schoonmaak vandaag",
        icon: ClipboardCheck,
        moduleKey: "haccp",
      },
      {
        href: "/haccp/controle",
        label: "Controle",
        icon: ShieldAlert,
        moduleKey: "haccp_controle",
      },
      {
        href: "/haccp/historie",
        label: "Registratie & historie",
        icon: ScrollText,
        moduleKey: "haccp_controle",
      },
      {
        href: "/stickers/historie",
        label: "Stickerhistorie",
        icon: Tags,
        moduleKey: "stickers",
      },
      {
        href: "/beheer/haccp/bewaartermijnen",
        label: "Bewaartermijnen",
        icon: Timer,
        moduleKey: "stickers_beheer",
      },
      {
        href: "/stickers/printer",
        label: "Stickerprinter instellen",
        icon: Printer,
        moduleKey: "stickers_beheer",
      },
      {
        href: "/haccp/plan",
        label: "Schoonmaakplan",
        icon: ListChecks,
        moduleKey: "haccp_plan",
      },
      {
        href: "/haccp/instellingen",
        label: "Instellingen",
        icon: Settings,
        moduleKey: "haccp_plan",
      },
    ],
  },
  {
    key: "inkoop",
    label: "Inkoop",
    items: [
      {
        href: "/producten",
        label: "Ingrediënten",
        icon: Package,
        moduleKey: "producten",
      },
      {
        href: "/leveranciers",
        label: "Leveranciers",
        icon: Truck,
        moduleKey: "leveranciers",
      },
      {
        href: "/verkoopproducten",
        label: "Verkoopproducten",
        icon: ShoppingCart,
        moduleKey: "verkoopproducten",
      },
      {
        href: "/prijsvergelijking",
        label: "Prijsvergelijking",
        icon: Scale,
        moduleKey: "leveranciers",
      },
    ],
  },
  {
    key: "prijzen",
    label: "Prijzen & facturen",
    items: [
      {
        href: "/leveranciers/facturen",
        label: "Facturen",
        icon: FileText,
        moduleKey: "leveranciers",
      },
      {
        href: "/leveranciers/prijzen/wijzigingen",
        label: "Prijswijzigingen",
        icon: History,
        moduleKey: "leveranciers",
      },
      {
        href: "/dashboard/prijzen",
        label: "Prijsontwikkeling",
        icon: LineChart,
        moduleKey: "leveranciers",
      },
      {
        href: "/financieel/bedrijven",
        label: "Per bedrijf",
        icon: Building2,
        moduleKey: "leveranciers",
      },
    ],
  },
  {
    key: "beheer",
    label: "Beheer",
    items: [
      {
        href: "/importeren",
        label: "Importeren",
        icon: Upload,
        moduleKey: "producten",
      },
      {
        href: "/bedrijven",
        label: "Bedrijven",
        icon: Building2,
        moduleKey: "bedrijven",
      },
      {
        href: "/gebruikers",
        label: "Gebruikers & rechten",
        icon: Users,
        moduleKey: "gebruikers",
      },
      {
        href: "/gebruikers/rollen",
        label: "Rollen",
        icon: ShieldCheck,
        moduleKey: "gebruikers",
      },
      {
        href: "/beheer/wijzigingslog",
        label: "Wijzigingslog",
        icon: History,
        moduleKey: "gebruikers",
      },
      {
        href: "/beheer/factuurverwerking",
        label: "Factuurverwerking",
        icon: Mail,
        moduleKey: "gebruikers",
      },
    ],
  },
];

/** Zoekt bij een pad het bijbehorende tabblad (voor het markeren van de actieve tab en het bepalen van de zij-navigatie). */
export function findTabForPath(pathname: string, tabs: NavTab[] = NAV_TABS): NavTab | null {
  let best: { tab: NavTab; len: number } | null = null;
  for (const tab of tabs) {
    for (const item of tab.items) {
      if (
        pathname.startsWith(item.href) &&
        (!best || item.href.length > best.len)
      ) {
        best = { tab, len: item.href.length };
      }
    }
  }
  if (best) return best.tab;
  // Pagina's die niet in het menu staan (bv. /haccp/rapport): tabblad op basis van het eerste deel van het pad.
  const first = pathname.split("/")[1];
  return tabs.find((tab) => tab.homeHref?.split("/")[1] === first) ?? null;
}

/**
 * Vereenvoudigd menu voor de Operator (keukenmedewerker, alleen bekijken):
 * startscherm met zoeken, stickers, keukenlijsten, producties en afval,
 * plus het HACCP-onderdeel volgens de rolrechten.
 */
export const OPERATOR_TABS: NavTab[] = (() => {
  const keuken = NAV_TABS.find((t) => t.key === "keuken");
  const haccp = NAV_TABS.find((t) => t.key === "haccp");
  const pick = (href: string) => keuken?.items.find((i) => i.href === href);
  const items = [
    { href: "/operator", label: "Zoeken & bekijken", icon: Search, moduleKey: null },
    pick("/stickers"),
    pick("/keukenlijsten"),
    pick("/voorraad"),
    pick("/afval"),
  ].filter((i): i is NonNullable<typeof i> => Boolean(i));
  const tabs: NavTab[] = [{ ...(keuken as NavTab), homeHref: "/operator", items }];
  if (haccp) tabs.push(haccp);
  return tabs;
})();

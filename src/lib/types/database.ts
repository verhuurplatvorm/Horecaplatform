/**
 * Handmatig geschreven types voor de fase 1-tabellen, zodat de app
 * type-veilig is zonder een live Supabase-project nodig te hebben.
 *
 * Zodra er een echt Supabase-project is gekoppeld, vervang dit bestand
 * door de gegenereerde types:
 *
 *   npx supabase gen types typescript --project-id <id> > src/lib/types/database.ts
 */

export type CompanyKind =
  | "restaurant"
  | "strandpaviljoen"
  | "beachclub"
  | "hotel"
  | "verblijfsaccommodatie"
  | "brouwerij"
  | "catering"
  | "verhuur"
  | "evenementenlocatie"
  | "centrale_beheermaatschappij"
  | "holding"
  | "overig";

export type RecipeStatus = "concept" | "goedgekeurd" | "vervallen";
export type RecipeKind = "gerecht" | "halfproduct";

export type Group = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export type LegalEntity = {
  id: string;
  group_id: string;
  name: string;
  legal_type: string | null;
  kvk_number: string | null;
  vat_number: string | null;
  is_active: boolean;
}

export type Company = {
  id: string;
  group_id: string;
  legal_entity_id: string;
  name: string;
  trade_name: string | null;
  kind: CompanyKind;
  is_seasonal: boolean;
  season_start: string | null;
  season_end: string | null;
  timezone: string;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Location = {
  id: string;
  group_id: string;
  company_id: string;
  name: string;
  address: Record<string, unknown> | null;
  is_active: boolean;
}

export type UnitDimension = "gewicht" | "inhoud" | "aantal";

export type Unit = {
  id: string;
  key: string;
  name: string;
  dimension: UnitDimension;
  factor_to_base: number;
  is_base_unit: boolean;
  sort_order: number;
}

export type ProductPackaging = {
  id: string;
  product_id: string;
  name: string;
  quantity_in_base_unit: number;
  is_purchase_unit: boolean;
  is_default: boolean;
  sort_order: number;
}

export type Product = {
  id: string;
  group_id: string;
  name: string;
  custom_name: string | null;
  brand: string | null;
  description: string | null;
  kind: "inkoopartikel" | "verkoopartikel" | "beide";
  product_group: string | null;
  base_unit: string;
  base_unit_id: string | null;
  ean_code: string | null;
  article_number: string | null;
  allergens: string[];
  contains_traces: string[];
  dietary_flags: Record<string, boolean>;
  nutrition_per_100: Record<string, number> | null;
  tax_rate: number | null;
  default_loss_percentage: number | null;
  preferred_supplier_id: string | null;
  min_stock_quantity: number | null;
  reorder_quantity: number | null;
  is_active: boolean;
}

export type Supplier = {
  id: string;
  group_id: string;
  company_id: string | null;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: { street?: string; zip?: string; city?: string } | null;
  payment_terms_days: number | null;
  delivery_days: string[] | null;
  minimum_order_amount: number | null;
  reliability_score: number | null;
  vat_number: string | null;
  kvk_number: string | null;
  iban: string | null;
  iban_verified_at: string | null;
  is_active: boolean;
}

export type SupplierProduct = {
  id: string;
  supplier_id: string;
  product_id: string;
  company_id: string | null;
  supplier_article_code: string | null;
  packaging_description: string | null;
  packaging_unit_count: number;
  purchase_price: number;
  price_per_base_unit: number | null;
  is_contract_price: boolean;
  change_reason: string | null;
  flagged_for_review: boolean;
  valid_from: string;
  valid_to: string | null;
}

export type Recipe = {
  id: string;
  group_id: string;
  company_id: string | null;
  parent_recipe_id: string | null;
  name: string;
  category: string | null;
  preparation: string | null;
  plating_instructions: string | null;
  photo_url: string | null;
  status: RecipeStatus;
  recipe_kind: RecipeKind;
  version: number;
  is_central: boolean;
  is_mandatory: boolean;
  sales_price: number | null;
  vat_rate: number;
  portion_size: number | null;
  portion_unit: string | null;
  yield_quantity: number | null;
  yield_unit: string | null;
  base_unit_id: string | null;
  storage_method: string | null;
  shelf_life_days: number | null;
  waste_percentage: number;
  margin_free_costs: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type RecipeIngredient = {
  id: string;
  recipe_id: string;
  product_id: string | null;
  sub_recipe_id: string | null;
  unmatched_name: string | null;
  quantity: number;
  unit: string;
  unit_id: string | null;
  loss_percentage: number | null;
  is_optional: boolean;
  sort_order: number;
  note: string | null;
}

export type CurrentProductCost = {
  product_id: string;
  company_id: string;
  supplier_id: string;
  price_per_base_unit: number;
  is_contract_price: boolean;
  valid_from: string;
}

export type SalesProduct = {
  id: string;
  group_id: string;
  company_id: string;
  name: string;
  category: string | null;
  sales_price_incl_vat: number;
  vat_rate: number;
  pos_reference: string | null;
  is_active: boolean;
  auto_generated_from_recipe_id: string | null;
}

export type SalesProductComponent = {
  id: string;
  sales_product_id: string;
  recipe_id: string;
  quantity: number;
  sort_order: number;
}

export type StockMovementType =
  | "ontvangst"
  | "verbruik"
  | "productie"
  | "correctie"
  | "derving"
  | "overboeking_uit"
  | "overboeking_in"
  | "telling";

export type StockMovement = {
  id: string;
  group_id: string;
  company_id: string;
  location_id: string | null;
  product_id: string | null;
  recipe_id: string | null;
  movement_type: StockMovementType;
  quantity_change: number;
  batch_number: string | null;
  produced_by: string | null;
  recipe_version: number | null;
  cost_at_production: number | null;
  expiry_date: string | null;
  note: string | null;
  related_movement_id: string | null;
  created_by: string | null;
  created_at: string;
}

export type CurrentStock = {
  company_id: string;
  product_id: string | null;
  recipe_id: string | null;
  on_hand_quantity: number;
}

export type RecipeFavorite = {
  user_id: string;
  recipe_id: string;
}

export type LabelSettings = {
  group_id: string;
  default_format: string;
  font_scale: number;
  show_logo: boolean;
  show_qr: boolean;
  visible_fields: string[];
}

export type ProductionLabel = {
  id: string;
  stock_movement_id: string;
  produced_by_user_ids: string[];
  produced_by_manual_names: string[];
  production_at: string;
  expiry_at: string | null;
  expiry_manually_set: boolean;
  extra_text: string | null;
  sticker_format: string;
  sticker_count: number;
  printed_by: string | null;
  printed_at: string;
  reprint_of: string | null;
  reprint_reason: string | null;
  created_at: string;
}

export type PriceChangeHistory = {
  id: string;
  product_id: string;
  supplier_id: string;
  company_id: string | null;
  new_purchase_price: number;
  new_price_per_base_unit: number | null;
  valid_from: string;
  change_reason: string | null;
  is_contract_price: boolean;
  old_purchase_price: number | null;
  old_price_per_base_unit: number | null;
}

export type UserProfile = {
  id: string;
  group_id: string;
  full_name: string;
  email: string;
  is_group_admin: boolean;
  is_active: boolean;
}

export type Role = {
  id: string;
  group_id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
}

export type UserCompanyAccess = {
  user_id: string;
  company_id: string;
  role_id: string;
}

export type RolePermission = {
  role_id: string;
  module_key: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_view_financial: boolean;
}

export type MenuCardStatus =
  | "concept"
  | "in_voorbereiding"
  | "actief"
  | "gepland"
  | "verlopen"
  | "gearchiveerd";

export type MenuCard = {
  id: string;
  group_id: string;
  company_id: string | null;
  name: string;
  menu_type: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: MenuCardStatus;
  version: number;
  language: string;
  duplicated_from_id: string | null;
  source_file_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type MenuFolder = {
  id: string;
  menu_card_id: string;
  parent_folder_id: string | null;
  name: string;
  sort_order: number;
  is_hidden: boolean;
}

export type MenuItem = {
  id: string;
  folder_id: string;
  recipe_id: string;
  display_name: string | null;
  short_description: string | null;
  price: number | null;
  sort_order: number;
  is_visible: boolean;
  available_from: string | null;
  available_to: string | null;
  is_new: boolean;
  is_popular: boolean;
  is_chefs_special: boolean;
  is_vegetarian: boolean;
  is_vegan: boolean;
  is_gluten_free: boolean;
  supplement_price: number | null;
  paired_drink: string | null;
  created_at: string;
  updated_at: string;
}

export type InvoiceMailbox = {
  id: string;
  group_id: string;
  company_id: string | null;
  label: string;
  webhook_token: string;
  is_active: boolean;
  created_at: string;
}

export type InboundInvoiceQueueItem = {
  id: string;
  group_id: string;
  mailbox_id: string | null;
  company_id: string | null;
  sender_email: string | null;
  original_filename: string;
  storage_path: string;
  file_kind: "ubl" | "pdf" | "onbekend";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsed_header: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsed_lines: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supplier_candidates: any;
  status: "wacht_op_leverancier" | "verwerkt" | "afgewezen";
  resulting_batch_id: string | null;
  received_at: string;
}

export type PriceSourceType = "manual_upload" | "api_sync";
export type PriceImportStatus =
  | "wordt_verwerkt"
  | "wacht_op_controle"
  | "toegepast"
  | "mislukt";
export type PriceImportRowStatus =
  | "gematcht"
  | "niet_gematcht"
  | "toegepast"
  | "overgeslagen"
  | "fout";
export type PriceMatchMethod = "ean" | "artikelnummer" | "handmatig" | "automatisch_aangemaakt";

export type SupplierImportTemplate = {
  supplier_id: string;
  column_mapping: Record<string, string>;
  decimal_separator: string;
  updated_at: string;
}

export type SupplierInvoiceTemplate = {
  supplier_id: string;
  field_notes: string;
  updated_at: string;
}

export type SupplierPriceSource = {
  id: string;
  supplier_id: string;
  source_type: PriceSourceType;
  connector_key: string | null;
  config: Record<string, unknown>;
  is_active: boolean;
  last_synced_at: string | null;
};

export type PriceImportBatch = {
  id: string;
  group_id: string;
  supplier_id: string;
  price_source_id: string;
  company_id: string | null;
  status: PriceImportStatus;
  original_filename: string | null;
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  applied_rows: number;
  error_message: string | null;
  imported_by: string | null;
  created_at: string;
  completed_at: string | null;
  source_kind: "prijslijst" | "factuur";
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  supplier_vat_number_on_invoice: string | null;
  supplier_kvk_number_on_invoice: string | null;
  supplier_iban_on_invoice: string | null;
  iban_mismatch: boolean;
  total_incl_vat: number | null;
  original_file_path: string | null;
};

export type PriceImportRow = {
  id: string;
  batch_id: string;
  row_number: number;
  raw: Record<string, unknown>;
  ean_code: string | null;
  article_number: string | null;
  description: string | null;
  brand: string | null;
  packaging_description: string | null;
  packaging_unit_count: number | null;
  packaging_unit_key: string | null;
  purchase_price: number | null;
  matched_product_id: string | null;
  match_method: PriceMatchMethod | null;
  status: PriceImportRowStatus;
  error_message: string | null;
  resulting_supplier_product_id: string | null;
  reopened_supplier_product_id: string | null;
  match_confidence: string | null;
  suggested_product_ids: string[];
}

/**
 * Minimale Database-typedefinitie in het formaat dat @supabase/ssr en
 * @supabase/supabase-js verwachten. Alleen de fase 1-tabellen zijn
 * uitgewerkt; overige tabellen komen erbij zodra ze in de UI nodig zijn
 * (voorkomt dat dit bestand honderden regels boilerplate wordt voordat
 * er echte generated types zijn).
 *
 * Let op: per tabel bewust een los objectliteral i.p.v. een generieke
 * `TableDef<Row>`-helper met een intersection-type — supabase-js'
 * GenericTable-check matcht een intersection niet betrouwbaar, waardoor
 * elke query stilzwijgend op `never` uitkomt.
 *
 * Vervang dit bestand zodra er een echt Supabase-project is:
 *   npx supabase gen types typescript --project-id <id> > src/lib/types/database.ts
 */
export type Database = {
  public: {
    Tables: {
      groups: {
        Row: Group;
        Insert: Partial<Group>;
        Update: Partial<Group>;
        Relationships: [];
      };
      legal_entities: {
        Row: LegalEntity;
        Insert: Partial<LegalEntity>;
        Update: Partial<LegalEntity>;
        Relationships: [];
      };
      companies: {
        Row: Company;
        Insert: Partial<Company>;
        Update: Partial<Company>;
        Relationships: [];
      };
      locations: {
        Row: Location;
        Insert: Partial<Location>;
        Update: Partial<Location>;
        Relationships: [];
      };
      products: {
        Row: Product;
        Insert: Partial<Product>;
        Update: Partial<Product>;
        Relationships: [];
      };
      suppliers: {
        Row: Supplier;
        Insert: Partial<Supplier>;
        Update: Partial<Supplier>;
        Relationships: [];
      };
      supplier_products: {
        Row: SupplierProduct;
        Insert: Partial<SupplierProduct>;
        Update: Partial<SupplierProduct>;
        Relationships: [];
      };
      recipes: {
        Row: Recipe;
        Insert: Partial<Recipe>;
        Update: Partial<Recipe>;
        Relationships: [];
      };
      user_profiles: {
        Row: UserProfile;
        Insert: Partial<UserProfile>;
        Update: Partial<UserProfile>;
        Relationships: [];
      };
      roles: {
        Row: Role;
        Insert: Partial<Role>;
        Update: Partial<Role>;
        Relationships: [];
      };
      role_permissions: {
        Row: RolePermission;
        Insert: Partial<RolePermission>;
        Update: Partial<RolePermission>;
        Relationships: [];
      };
      user_company_access: {
        Row: UserCompanyAccess;
        Insert: Partial<UserCompanyAccess>;
        Update: Partial<UserCompanyAccess>;
        Relationships: [];
      };
      supplier_price_sources: {
        Row: SupplierPriceSource;
        Insert: Partial<SupplierPriceSource>;
        Update: Partial<SupplierPriceSource>;
        Relationships: [];
      };
      price_import_batches: {
        Row: PriceImportBatch;
        Insert: Partial<PriceImportBatch>;
        Update: Partial<PriceImportBatch>;
        Relationships: [];
      };
      price_import_rows: {
        Row: PriceImportRow;
        Insert: Partial<PriceImportRow>;
        Update: Partial<PriceImportRow>;
        Relationships: [];
      };
      supplier_import_templates: {
        Row: SupplierImportTemplate;
        Insert: Partial<SupplierImportTemplate>;
        Update: Partial<SupplierImportTemplate>;
        Relationships: [];
      };
      supplier_invoice_templates: {
        Row: SupplierInvoiceTemplate;
        Insert: Partial<SupplierInvoiceTemplate>;
        Update: Partial<SupplierInvoiceTemplate>;
        Relationships: [];
      };
      units: {
        Row: Unit;
        Insert: Partial<Unit>;
        Update: Partial<Unit>;
        Relationships: [];
      };
      product_packagings: {
        Row: ProductPackaging;
        Insert: Partial<ProductPackaging>;
        Update: Partial<ProductPackaging>;
        Relationships: [];
      };
      recipe_ingredients: {
        Row: RecipeIngredient;
        Insert: Partial<RecipeIngredient>;
        Update: Partial<RecipeIngredient>;
        Relationships: [];
      };
      sales_products: {
        Row: SalesProduct;
        Insert: Partial<SalesProduct>;
        Update: Partial<SalesProduct>;
        Relationships: [];
      };
      sales_product_components: {
        Row: SalesProductComponent;
        Insert: Partial<SalesProductComponent>;
        Update: Partial<SalesProductComponent>;
        Relationships: [];
      };
      stock_movements: {
        Row: StockMovement;
        Insert: Partial<StockMovement>;
        Update: Partial<StockMovement>;
        Relationships: [];
      };
      recipe_favorites: {
        Row: RecipeFavorite;
        Insert: Partial<RecipeFavorite>;
        Update: Partial<RecipeFavorite>;
        Relationships: [];
      };
      label_settings: {
        Row: LabelSettings;
        Insert: Partial<LabelSettings>;
        Update: Partial<LabelSettings>;
        Relationships: [];
      };
      production_labels: {
        Row: ProductionLabel;
        Insert: Partial<ProductionLabel>;
        Update: Partial<ProductionLabel>;
        Relationships: [];
      };
      menu_cards: {
        Row: MenuCard;
        Insert: Partial<MenuCard>;
        Update: Partial<MenuCard>;
        Relationships: [];
      };
      menu_folders: {
        Row: MenuFolder;
        Insert: Partial<MenuFolder>;
        Update: Partial<MenuFolder>;
        Relationships: [];
      };
      menu_items: {
        Row: MenuItem;
        Insert: Partial<MenuItem>;
        Update: Partial<MenuItem>;
        Relationships: [];
      };
      invoice_mailboxes: {
        Row: InvoiceMailbox;
        Insert: Partial<InvoiceMailbox>;
        Update: Partial<InvoiceMailbox>;
        Relationships: [];
      };
      inbound_invoice_queue: {
        Row: InboundInvoiceQueueItem;
        Insert: Partial<InboundInvoiceQueueItem>;
        Update: Partial<InboundInvoiceQueueItem>;
        Relationships: [];
      };
    };
    Views: {
      current_product_cost: {
        Row: CurrentProductCost;
        Relationships: [];
      };
      current_stock: {
        Row: CurrentStock;
        Relationships: [];
      };
      price_change_history: {
        Row: PriceChangeHistory;
        Relationships: [];
      };
    };
    Functions: {
      apply_price_import_row: {
        Args: { p_row_id: string };
        Returns: void;
      };
      rollback_price_import_batch: {
        Args: { p_batch_id: string };
        Returns: void;
      };
      duplicate_menu_card: {
        Args: {
          p_menu_card_id: string;
          p_new_name: string;
          p_new_company_id?: string;
          p_new_start_date?: string;
        };
        Returns: string;
      };
      match_supplier_from_invoice: {
        Args: {
          p_group_id: string;
          p_vat_number: string | null;
          p_kvk_number: string | null;
          p_iban: string | null;
          p_name: string | null;
        };
        Returns: {
          supplier_id: string;
          supplier_name: string;
          match_method: string;
          iban_mismatch: boolean;
        }[];
      };
      match_recipe_by_name: {
        Args: { p_group_id: string; p_name: string };
        Returns: { recipe_id: string; recipe_name: string; similarity_score: number }[];
      };
      match_product_by_name: {
        Args: { p_group_id: string; p_name: string };
        Returns: { product_id: string; product_name: string; similarity_score: number }[];
      };
      match_supplier_by_name: {
        Args: { p_group_id: string; p_name: string };
        Returns: { supplier_id: string; supplier_name: string; similarity_score: number }[];
      };
      calculate_recipe_cost: {
        Args: { p_recipe_id: string; p_company_id: string; p_depth?: number };
        Returns: number;
      };
      calculate_sales_product_cost: {
        Args: { p_sales_product_id: string; p_company_id: string };
        Returns: number;
      };
      calculate_recipe_allergens: {
        Args: { p_recipe_id: string; p_depth?: number };
        Returns: { bevat: string[]; sporen: string[] };
      };
      calculate_recipe_nutrition: {
        Args: { p_recipe_id: string; p_depth?: number };
        Returns: Record<string, number>;
      };
      register_recipe_production: {
        Args: {
          p_recipe_id: string;
          p_company_id: string;
          p_quantity: number;
          p_produced_by: string;
          p_note?: string;
        };
        Returns: string;
      };
      get_recipe_cost_breakdown: {
        Args: { p_recipe_id: string; p_company_id: string };
        Returns: {
          sort_order: number;
          ingredient_name: string | null;
          quantity: number;
          unit_name: string | null;
          line_cost: number | null;
          quantity_in_recipe_unit: number | null;
        }[];
      };
      get_recipe_usage: {
        Args: { p_recipe_id: string; p_company_id: string };
        Returns: {
          using_recipe_id: string;
          using_recipe_name: string;
          using_recipe_kind: RecipeKind;
          company_name: string | null;
          quantity: number;
          unit_name: string | null;
          cost_contribution: number | null;
        }[];
      };
      calculate_recipe_cost_override: {
        Args: {
          p_recipe_id: string;
          p_company_id: string;
          p_override_product_id: string;
          p_override_price_per_base_unit: number;
          p_depth?: number;
        };
        Returns: number;
      };
      get_price_change_impact: {
        Args: {
          p_product_id: string;
          p_company_id: string;
          p_new_price_per_base_unit: number;
        };
        Returns: {
          recipe_id: string;
          recipe_name: string;
          recipe_kind: RecipeKind;
          old_cost: number;
          new_cost: number;
          delta: number;
          sales_price: number | null;
          old_foodcost_pct: number | null;
          new_foodcost_pct: number | null;
        }[];
      };
      calculate_recipe_cost_asof: {
        Args: {
          p_recipe_id: string;
          p_company_id: string;
          p_asof_date: string;
          p_depth?: number;
        };
        Returns: number;
      };
    };
  };
}

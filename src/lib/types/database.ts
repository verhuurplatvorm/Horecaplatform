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
  brand: string | null;
  description: string | null;
  kind: "inkoopartikel" | "verkoopartikel" | "beide";
  product_group: string | null;
  base_unit: string;
  base_unit_id: string | null;
  ean_code: string | null;
  article_number: string | null;
  allergens: string[];
  dietary_flags: Record<string, boolean>;
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
  email: string | null;
  phone: string | null;
  reliability_score: number | null;
  is_active: boolean;
}

export type SupplierProduct = {
  id: string;
  supplier_id: string;
  product_id: string;
  company_id: string | null;
  packaging_description: string | null;
  packaging_unit_count: number;
  purchase_price: number;
  price_per_base_unit: number | null;
  is_contract_price: boolean;
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
  portion_size: number | null;
  portion_unit: string | null;
  yield_quantity: number | null;
  yield_unit: string | null;
  base_unit_id: string | null;
}

export type RecipeIngredient = {
  id: string;
  recipe_id: string;
  product_id: string | null;
  sub_recipe_id: string | null;
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
}

export type SalesProductComponent = {
  id: string;
  sales_product_id: string;
  recipe_id: string;
  quantity: number;
  sort_order: number;
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
export type PriceMatchMethod = "ean" | "artikelnummer" | "handmatig";

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
};

export type PriceImportRow = {
  id: string;
  batch_id: string;
  row_number: number;
  raw: Record<string, unknown>;
  ean_code: string | null;
  article_number: string | null;
  description: string | null;
  packaging_description: string | null;
  packaging_unit_count: number | null;
  purchase_price: number | null;
  matched_product_id: string | null;
  match_method: PriceMatchMethod | null;
  status: PriceImportRowStatus;
  error_message: string | null;
};

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
    };
    Views: {
      current_product_cost: {
        Row: CurrentProductCost;
        Relationships: [];
      };
    };
    Functions: {
      apply_price_import_row: {
        Args: { p_row_id: string };
        Returns: void;
      };
      calculate_recipe_cost: {
        Args: { p_recipe_id: string; p_company_id: string; p_depth?: number };
        Returns: number;
      };
      calculate_sales_product_cost: {
        Args: { p_sales_product_id: string; p_company_id: string };
        Returns: number;
      };
    };
  };
}

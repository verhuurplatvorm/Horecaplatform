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

export type Product = {
  id: string;
  group_id: string;
  name: string;
  kind: "inkoopartikel" | "verkoopartikel" | "beide";
  product_group: string | null;
  base_unit: string;
  ean_code: string | null;
  article_number: string | null;
  allergens: string[];
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
  status: RecipeStatus;
  version: number;
  is_central: boolean;
  is_mandatory: boolean;
  sales_price: number | null;
  portion_size: number | null;
  portion_unit: string | null;
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
    };
    Views: Record<string, never>;
    Functions: {
      apply_price_import_row: {
        Args: { p_row_id: string };
        Returns: void;
      };
    };
  };
}

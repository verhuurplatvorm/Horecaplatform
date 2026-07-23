-- 0004_producten_leveranciers.sql
-- Centrale product-/ingrediëntendatabase (spec §6) en leveranciersbeheer (spec §10).
-- Eén centraal artikel kan door één, meerdere of alle bedrijven gebruikt
-- worden; lokale bedrijven kunnen eigen leverancier/prijs/verpakking/
-- artikelcode hebben (spec §6) via product_company_settings /
-- supplier_products.

create type public.product_kind as enum ('inkoopartikel', 'verkoopartikel', 'beide');

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references public.groups(id) on delete cascade,
  name                text not null,
  kind                public.product_kind not null default 'inkoopartikel',
  product_group       text,               -- productgroep, bv. 'vlees', 'dranken-alcoholisch'
  base_unit           text not null,      -- eenheid waarin recepturen rekenen, bv. 'g', 'ml', 'stuk'
  ean_code            text,
  article_number      text,
  allergens           jsonb not null default '[]'::jsonb,   -- lijst van de 14 EU-allergenen
  contains_traces     jsonb not null default '[]'::jsonb,
  dietary_flags       jsonb not null default '{}'::jsonb,   -- {vegan, vegetarisch, glutenvrij, lactosevrij, halal}
  nutrition_per_100   jsonb,              -- {energie, vet, verzadigd_vet, koolhydraten, suikers, eiwit, zout, vezels}
  origin              text,
  certifications       jsonb not null default '[]'::jsonb,   -- keurmerken
  tax_rate            numeric(5,2),       -- btw-tarief, kan lokaal overschreven worden
  deposit_amount      numeric(10,2),      -- statiegeld/emballage
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_products_group on public.products(group_id);
create index idx_products_name_trgm on public.products using gin (name gin_trgm_ops);
create unique index uq_products_group_ean on public.products(group_id, ean_code) where ean_code is not null;

create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- Welke bedrijven gebruiken dit centrale product, met eventuele lokale
-- afwijkingen (eigen artikelcode, voorraadlocatie, verkoopprijs, btw).
create table public.product_company_settings (
  product_id       uuid not null references public.products(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,
  is_enabled       boolean not null default true,
  local_article_code text,
  local_tax_rate   numeric(5,2),
  sales_price      numeric(10,2),
  default_storage_location text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (product_id, company_id)
);

create trigger trg_product_company_settings_updated_at
  before update on public.product_company_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Leveranciers. Kan centraal (group-breed, company_id null) of lokaal
-- (aan één bedrijf gekoppeld) zijn.
-- ---------------------------------------------------------------------
create table public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups(id) on delete cascade,
  company_id     uuid references public.companies(id) on delete cascade, -- null = centrale/groepsleverancier
  name           text not null,
  contact_name   text,
  email          text,
  phone          text,
  address        jsonb,
  payment_terms_days integer,
  delivery_days  jsonb,             -- bv. ['maandag','donderdag']
  minimum_order_amount numeric(10,2),
  reliability_score numeric(3,2),   -- 0-5, afgeleid van leverbetrouwbaarheid
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_suppliers_group on public.suppliers(group_id);
create index idx_suppliers_company on public.suppliers(company_id);

create trigger trg_suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

-- Prijs van een artikel bij een leverancier, eventueel per bedrijf
-- verschillend (staffelkortingen/contractprijzen). Historie blijft
-- bewaard via valid_from/valid_to i.p.v. overschrijven, zodat
-- prijsontwikkeling en contractafwijkingen zichtbaar blijven (spec §10).
create table public.supplier_products (
  id               uuid primary key default gen_random_uuid(),
  supplier_id      uuid not null references public.suppliers(id) on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  company_id       uuid references public.companies(id) on delete cascade, -- null = geldt groepsbreed
  supplier_article_code text,
  packaging_description text,        -- bv. 'doos van 6 x 1L'
  packaging_unit_count numeric(12,4) not null default 1, -- omrekening naar base_unit
  purchase_price   numeric(12,4) not null,   -- prijs per verpakking
  price_per_base_unit numeric(12,6) generated always as
    (case when packaging_unit_count > 0 then purchase_price / packaging_unit_count else null end) stored,
  is_contract_price boolean not null default false,
  valid_from       date not null default current_date,
  valid_to         date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_supplier_products_product on public.supplier_products(product_id);
create index idx_supplier_products_supplier on public.supplier_products(supplier_id);
create index idx_supplier_products_company on public.supplier_products(company_id);

create trigger trg_supplier_products_updated_at
  before update on public.supplier_products
  for each row execute function public.set_updated_at();

comment on table public.products is 'Centrale product-/ingrediëntendatabase (spec §6), groepsbreed, met per-bedrijf instellingen via product_company_settings.';
comment on table public.suppliers is 'Leveranciers, centraal (company_id null) of lokaal per bedrijf (spec §10).';
comment on table public.supplier_products is 'Prijs/verpakking van een artikel bij een leverancier, met historie via valid_from/valid_to (spec §10).';

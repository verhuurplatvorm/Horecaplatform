-- 0002_organisatie.sql
-- Organisatiestructuur: horecagroep -> juridisch bedrijf -> operationeel bedrijf
-- -> vestiging -> afdeling / kostenplaats.
--
-- Uitgangspunt (spec §2 en §31): één centrale database, scheiding via
-- group_id / legal_entity_id / company_id / location_id / department_id /
-- cost_center_id. Geen losse database per bedrijf.

-- ---------------------------------------------------------------------
-- Horecagroep (in de praktijk meestal 1 rij; tabel bestaat voor
-- toekomstige multi-groep scenario's, bv. white-label hergebruik).
-- ---------------------------------------------------------------------
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_groups_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Juridisch bedrijf (BV / holding / werkmaatschappij als rechtspersoon).
-- ---------------------------------------------------------------------
create table public.legal_entities (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  name          text not null,
  legal_type    text,                     -- bv, holding, eenmanszaak, ...
  kvk_number    text,
  vat_number    text,
  iban          text,
  address       jsonb,                    -- {street, number, zip, city, country}
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_legal_entities_group on public.legal_entities(group_id);

create trigger trg_legal_entities_updated_at
  before update on public.legal_entities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Operationeel bedrijf / handelsnaam / concept. Dit is de eenheid
-- waaraan de meeste operationele data wordt gekoppeld (company_id).
-- ---------------------------------------------------------------------
create type public.company_kind as enum (
  'restaurant',
  'strandpaviljoen',
  'beachclub',
  'hotel',
  'verblijfsaccommodatie',
  'brouwerij',
  'catering',
  'verhuur',
  'evenementenlocatie',
  'centrale_beheermaatschappij',
  'holding',
  'overig'
);

create table public.companies (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.groups(id) on delete cascade,
  legal_entity_id   uuid not null references public.legal_entities(id) on delete restrict,
  name              text not null,
  trade_name        text,
  kind              public.company_kind not null default 'overig',
  is_seasonal       boolean not null default false,
  season_start      date,                 -- alleen relevant als is_seasonal = true
  season_end        date,
  timezone          text not null default 'Europe/Amsterdam',
  currency          text not null default 'EUR',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_companies_group on public.companies(group_id);
create index idx_companies_legal_entity on public.companies(legal_entity_id);

create trigger trg_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- Welke modules staan aan voor dit bedrijf (spec §1: "niet ieder bedrijf
-- hoeft alle modules te gebruiken").
create table public.company_modules (
  company_id   uuid not null references public.companies(id) on delete cascade,
  module_key   text not null,             -- bv. 'inkoop', 'voorraad', 'verhuur', 'haccp'
  is_enabled   boolean not null default true,
  primary key (company_id, module_key)
);

-- ---------------------------------------------------------------------
-- Vestiging.
-- ---------------------------------------------------------------------
create table public.locations (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  address      jsonb,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_locations_company on public.locations(company_id);

create trigger trg_locations_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Afdeling (keuken, bar, terras, magazijn, productielocatie, ...).
-- ---------------------------------------------------------------------
create table public.departments (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  location_id   uuid not null references public.locations(id) on delete cascade,
  name          text not null,
  department_type text,                   -- keuken, bar, terras, magazijn, productie, verhuur
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_departments_location on public.departments(location_id);

create trigger trg_departments_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Kostenplaats (voor financiële toewijzing, los van fysieke afdeling).
-- ---------------------------------------------------------------------
create table public.cost_centers (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  location_id   uuid references public.locations(id) on delete set null,
  code          text not null,
  name          text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, code)
);

create index idx_cost_centers_company on public.cost_centers(company_id);

create trigger trg_cost_centers_updated_at
  before update on public.cost_centers
  for each row execute function public.set_updated_at();

comment on table public.groups is 'De horecagroep als geheel (spec §2).';
comment on table public.legal_entities is 'Juridisch bedrijf / BV / holding (spec §2, §22: administratie blijft gescheiden per juridisch bedrijf).';
comment on table public.companies is 'Operationeel bedrijf / concept / handelsnaam. Belangrijkste scheidingssleutel (company_id) voor operationele data (spec §31).';
comment on table public.locations is 'Vestiging binnen een bedrijf.';
comment on table public.departments is 'Afdeling binnen een vestiging (keuken, bar, terras, magazijn, ...).';
comment on table public.cost_centers is 'Kostenplaats voor financiële rapportage, optioneel gekoppeld aan een vestiging.';

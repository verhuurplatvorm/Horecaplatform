-- 0009_price_imports.sql
-- Actuele leveranciersprijzen bijhouden (spec §10: "prijs per leverancier
-- ... historische prijsontwikkeling") zonder aan één importmethode vast
-- te zitten. Een leverancier heeft één of meer "prijsbronnen": vandaag is
-- dat een handmatige CSV/Excel-upload, later kan dat een live
-- API-koppeling zijn (bv. inOne). Beide lopen door dezelfde
-- batch/rows-pipeline en dezelfde matching- en toepasfunctie, zodat een
-- automatische koppeling later kan worden toegevoegd zonder de
-- CSV-import te herbouwen.

create type public.price_source_type as enum ('manual_upload', 'api_sync');
create type public.price_import_status as enum (
  'wordt_verwerkt', 'wacht_op_controle', 'toegepast', 'mislukt'
);
create type public.price_import_row_status as enum (
  'gematcht', 'niet_gematcht', 'toegepast', 'overgeslagen', 'fout'
);
create type public.price_match_method as enum ('ean', 'artikelnummer', 'handmatig');

-- Eén rij per manier waarop een leverancier prijzen aanlevert. Voor de
-- meeste leveranciers vandaag: één rij met source_type = 'manual_upload'.
-- Zodra een live koppeling (inOne of anders) beschikbaar komt, komt daar
-- een tweede rij bij met source_type = 'api_sync' en de connector_key
-- (bv. 'inone'); een achtergrondtaak kan dan periodiek dezelfde
-- apply_price_import_batch-functie aanroepen als de handmatige import nu
-- gebruikt.
create table public.supplier_price_sources (
  id             uuid primary key default gen_random_uuid(),
  supplier_id    uuid not null references public.suppliers(id) on delete cascade,
  source_type    public.price_source_type not null default 'manual_upload',
  connector_key  text,               -- bv. 'inone', null = handmatige upload
  config         jsonb not null default '{}'::jsonb, -- toekomstig: API-credentials-referentie, sync-frequentie, ...
  is_active      boolean not null default true,
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_supplier_price_sources_supplier on public.supplier_price_sources(supplier_id);

create trigger trg_supplier_price_sources_updated_at
  before update on public.supplier_price_sources
  for each row execute function public.set_updated_at();

-- Eén upload/sync-run. Bewaart bronregistratie, tijdstip, status en
-- foutmelding zoals vereist voor iedere import (spec §28).
create table public.price_import_batches (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references public.groups(id) on delete cascade,
  supplier_id      uuid not null references public.suppliers(id) on delete cascade,
  price_source_id  uuid not null references public.supplier_price_sources(id) on delete cascade,
  company_id       uuid references public.companies(id) on delete cascade, -- null = groepsbrede prijzen
  status           public.price_import_status not null default 'wordt_verwerkt',
  original_filename text,
  total_rows       integer not null default 0,
  matched_rows     integer not null default 0,
  unmatched_rows   integer not null default 0,
  applied_rows     integer not null default 0,
  error_message    text,
  imported_by      uuid references public.user_profiles(id),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index idx_price_import_batches_supplier on public.price_import_batches(supplier_id);
create index idx_price_import_batches_group on public.price_import_batches(group_id);

-- Eén rij per regel uit het bestand (of API-antwoord). raw bewaart de
-- oorspronkelijke data 1-op-1, zodat een mislukte matching herstelbaar
-- is zonder opnieuw te hoeven importeren (spec §28: herstartmogelijkheid).
create table public.price_import_rows (
  id                    uuid primary key default gen_random_uuid(),
  batch_id              uuid not null references public.price_import_batches(id) on delete cascade,
  row_number            integer not null,
  raw                   jsonb not null,
  ean_code              text,
  article_number        text,
  description           text,
  packaging_description text,
  packaging_unit_count  numeric(12,4),
  purchase_price        numeric(12,4),
  matched_product_id    uuid references public.products(id) on delete set null,
  match_method          public.price_match_method,
  status                public.price_import_row_status not null default 'niet_gematcht',
  error_message         text
);

create index idx_price_import_rows_batch on public.price_import_rows(batch_id);
create index idx_price_import_rows_product on public.price_import_rows(matched_product_id);

-- ---------------------------------------------------------------------
-- Toepasfunctie: zet een goedgekeurde importregel om in een nieuwe
-- supplier_products-rij, met behoud van prijshistorie (spec §10: oude
-- prijs blijft zichtbaar via valid_to i.p.v. overschrijven). Dit is de
-- ene plek waar een nieuwe prijs "binnenkomt", ongeacht of de bron een
-- handmatige upload of straks een live API-sync is.
-- ---------------------------------------------------------------------
create or replace function public.apply_price_import_row(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.price_import_rows%rowtype;
  v_batch public.price_import_batches%rowtype;
begin
  select * into v_row from public.price_import_rows where id = p_row_id;
  if v_row.matched_product_id is null then
    raise exception 'Kan regel % niet toepassen: geen gekoppeld product', p_row_id;
  end if;

  select * into v_batch from public.price_import_batches where id = v_row.batch_id;

  -- Sluit de vorige geldige prijs voor dit product/leverancier/bedrijf af.
  update public.supplier_products
  set valid_to = current_date - interval '1 day'
  where supplier_id = v_batch.supplier_id
    and product_id = v_row.matched_product_id
    and company_id is not distinct from v_batch.company_id
    and valid_to is null;

  insert into public.supplier_products (
    supplier_id, product_id, company_id, supplier_article_code,
    packaging_description, packaging_unit_count, purchase_price,
    is_contract_price, valid_from
  ) values (
    v_batch.supplier_id, v_row.matched_product_id, v_batch.company_id, v_row.article_number,
    v_row.packaging_description, coalesce(v_row.packaging_unit_count, 1), v_row.purchase_price,
    false, current_date
  );

  update public.price_import_rows
  set status = 'toegepast'
  where id = p_row_id;
end;
$$;

comment on function public.apply_price_import_row(uuid) is
  'Verwerkt één importregel tot een nieuwe supplier_products-prijs, met behoud van historie. Wordt zowel door de CSV/Excel-import als (later) een live API-sync aangeroepen.';

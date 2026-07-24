-- 0011_units_and_product_packaging.sql
-- Eenhedensysteem (spec §3): eenheden zijn geen losse tekstvelden meer,
-- maar een vaste, systeembrede lijst met een dimensie (gewicht/inhoud/
-- aantal) en een omrekenfactor naar de basiseenheid van die dimensie.
-- Producten kiezen hun basiseenheid uit deze lijst; verpakkingen worden
-- per product vastgelegd in exact die basiseenheid (bv. "doos" = 9000 ml
-- als de basiseenheid ml is), zodat er nooit tussen incompatibele
-- dimensies gerekend kan worden zonder expliciete, per-product vastgelegde
-- omrekening.

create type public.unit_dimension as enum ('gewicht', 'inhoud', 'aantal');

-- Systeembrede eenhedenlijst (géén group_id: dit is vaste referentiedata,
-- net als een enum, maar dan bevraagbaar/uitbreidbaar via SQL in plaats
-- van een applicatie-redeploy).
create table public.units (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique,   -- machine-naam, bv. 'g', 'kg', 'ml', 'stuk'
  name             text not null,          -- weergavenaam, bv. 'kilogram'
  dimension        public.unit_dimension not null,
  factor_to_base   numeric(18,6) not null, -- vermenigvuldigingsfactor naar de basiseenheid van de dimensie
  is_base_unit     boolean not null default false, -- g voor gewicht, ml voor inhoud, stuk voor aantal
  sort_order       integer not null default 0
);

comment on table public.units is
  'Systeembrede, vaste eenhedenlijst (spec §3). Basiseenheden: gram (gewicht), milliliter (inhoud), stuk (aantal). factor_to_base zet iedere eenheid om naar die basiseenheid.';

insert into public.units (key, name, dimension, factor_to_base, is_base_unit, sort_order) values
  -- Gewicht (basis: gram)
  ('mg', 'milligram', 'gewicht', 0.001, false, 1),
  ('g',  'gram',       'gewicht', 1,      true,  2),
  ('kg', 'kilogram',   'gewicht', 1000,   false, 3),
  -- Inhoud (basis: milliliter)
  ('ml', 'milliliter', 'inhoud', 1,    true,  1),
  ('cl', 'centiliter', 'inhoud', 10,   false, 2),
  ('dl', 'deciliter',  'inhoud', 100,  false, 3),
  ('l',  'liter',      'inhoud', 1000, false, 4),
  -- Aantal (basis: stuk) — dit zijn generieke telbare eenheden; concrete
  -- verpakkingen (fles, doos, krat, ...) worden per product vastgelegd in
  -- product_packagings, niet hier als losse globale eenheid, omdat "1 fles"
  -- per product een andere inhoud vertegenwoordigt.
  ('stuk', 'stuk', 'aantal', 1, true, 1);

-- ---------------------------------------------------------------------
-- Producten krijgen een echte basiseenheid (FK i.p.v. vrije tekst).
-- De oude tekstkolom blijft bestaan en wordt door een trigger gesynchro-
-- niseerd, zodat bestaande code die products.base_unit leest niet breekt
-- terwijl nieuwe code de FK gebruikt.
-- ---------------------------------------------------------------------
alter table public.products
  add column base_unit_id uuid references public.units(id),
  add column brand text,
  add column description text,
  add column default_loss_percentage numeric(5,2),
  add column preferred_supplier_id uuid references public.suppliers(id) on delete set null,
  add column min_stock_quantity numeric(14,4),
  add column reorder_quantity numeric(14,4);

comment on column public.products.default_loss_percentage is
  'Standaard afval-/snijverliespercentage (spec §2, §7). Kan per receptregel worden overschreven zodra recepturen dit ondersteunen (fase 2c).';
comment on column public.products.base_unit_id is
  'Verwijst naar units.id. products.base_unit (tekst) wordt hieruit gesynchroniseerd door trg_products_sync_base_unit_text.';

create or replace function public.sync_product_base_unit_text()
returns trigger
language plpgsql
as $$
begin
  if new.base_unit_id is not null then
    select key into new.base_unit from public.units where id = new.base_unit_id;
  end if;
  return new;
end;
$$;

create trigger trg_products_sync_base_unit_text
  before insert or update of base_unit_id on public.products
  for each row execute function public.sync_product_base_unit_text();

-- ---------------------------------------------------------------------
-- Verpakkingen per product (spec §3): "1 doos bevat 12 flessen van 750 ml"
-- wordt vastgelegd als één rij met quantity_in_base_unit = 9000 (als
-- base_unit = ml). Dit voorkomt generieke, mogelijk foutieve conversies
-- tussen incompatibele eenheden — iedere verpakking is een expliciete,
-- door de gebruiker ingevoerde hoeveelheid in de basiseenheid van dát
-- product.
-- ---------------------------------------------------------------------
create table public.product_packagings (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references public.products(id) on delete cascade,
  name                  text not null,        -- bv. 'fles 750ml', 'doos van 12', 'krat 24 flesjes'
  quantity_in_base_unit numeric(18,6) not null check (quantity_in_base_unit > 0),
  is_purchase_unit      boolean not null default true,  -- dit is een inkoopeenheid (vs. bv. een portie-eenheid)
  is_default            boolean not null default false,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_product_packagings_product on public.product_packagings(product_id);

create trigger trg_product_packagings_updated_at
  before update on public.product_packagings
  for each row execute function public.set_updated_at();

-- Precies één standaardverpakking per product.
create unique index uq_product_packagings_one_default
  on public.product_packagings(product_id)
  where is_default;

comment on table public.product_packagings is
  'Verpakkingsniveaus per product, elk uitgedrukt in de basiseenheid van het product (spec §3). Vervangt de losse tekstvelden packaging_description/packaging_unit_count op supplier_products voor nieuwe invoer.';

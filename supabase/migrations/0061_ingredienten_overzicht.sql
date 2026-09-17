-- 0061_ingredienten_overzicht.sql
--
-- Twee toevoegingen voor het nieuwe ingrediëntenoverzicht. Alle overige
-- kolommen van dat scherm bestaan al en worden hergebruikt — er zijn
-- bewust geen velden gedupliceerd:
--   waarschuwing        -> supplier_products.flagged_for_review
--   naam                -> products.name / custom_name
--   leveranciersartikel -> supplier_products.supplier_article_code
--   merk                -> products.brand
--   leverancier         -> suppliers.name via supplier_products
--   categorie           -> products.product_group
--   prijs per verpakking-> supplier_products.purchase_price
--   inhoud verpakking   -> supplier_products.packaging_unit_count
--   eenheid             -> products.base_unit_id
--   prijs per basis     -> supplier_products.price_per_base_unit
--   prijswijziging %/EUR-> afgeleid uit public.price_change_history
--   laatste wijziging   -> supplier_products.valid_from
--   aangemaakt/gewijzigd-> products.created_at / updated_at
--   prijshistorie       -> public.price_change_history
--   beschikbaar/actief  -> products.is_active
--   notitie             -> products.description
--   EAN                 -> products.ean_code

-- 1. Kort, oplopend nummer per groep. Een UUID is onbruikbaar als
--    ID-kolom in een overzicht; dit geeft elk ingrediënt een kort
--    nummer zoals in de oude situatie, zonder de UUID te vervangen.
create sequence if not exists public.product_number_seq;

alter table public.products
  add column if not exists product_number integer;

-- Bestaande ingrediënten een nummer geven op volgorde van aanmaak.
update public.products p
set product_number = s.rn
from (
  select id, row_number() over (order by created_at, id) as rn
  from public.products
  where product_number is null
) s
where p.id = s.id and p.product_number is null;

-- Sequence doorzetten voorbij de hoogste bestaande waarde.
select setval(
  'public.product_number_seq',
  greatest(coalesce((select max(product_number) from public.products), 0), 1)
);

alter table public.products
  alter column product_number set default nextval('public.product_number_seq');

create unique index if not exists idx_products_number
  on public.products(product_number);

comment on column public.products.product_number is
  'Kort oplopend nummer voor weergave in overzichten. De UUID (id) blijft de echte sleutel voor alle koppelingen.';

-- 2. Prijsalarm: drempel waarboven een prijswijziging opvalt. Bestond
--    nog niet; wordt per groep ingesteld en in het ingrediëntenoverzicht
--    gebruikt om stijgingen/dalingen te markeren.
alter table public.groups
  add column if not exists price_alert_threshold_pct numeric(5,2) not null default 10;

comment on column public.groups.price_alert_threshold_pct is
  'Prijsalarm: een prijswijziging van meer dan dit percentage wordt in het ingrediëntenoverzicht gemarkeerd. Standaard 10%.';

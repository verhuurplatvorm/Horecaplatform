-- 0071_factuur_categorie_en_levering.sql
--
-- Twee gaten in de bestaande factuurverwerking:
--
-- 1. NIET-FOOD. Elke factuurregel werd als inkoopartikel behandeld en kon
--    zo als ingrediënt in de keuken belanden. Op de Horesca-factuur staan
--    naast voedsel ook handdoekrollen, werkdoekjes, schuursponzen, folie
--    en afvalzakken. Die horen geen ingrediënt te worden.
--
-- 2. LEVERDATUM EN PAKBON. Beide voorbeeldfacturen groeperen regels per
--    levering ("Volgens pakbon nr. van 212942 07-09-2026", "Levering 252 6,
--    op 08-09-26"). Die informatie werd niet bewaard, terwijl je daarmee
--    een prijs aan een concrete levering kunt koppelen.
--
-- De verwerkingsengine zelf blijft één generieke stroom; dit voegt alleen
-- velden toe die elke leverancier kan vullen.

create type public.item_category as enum (
  'food',            -- ingrediënt voor de keuken
  'verpakking',      -- bakjes, deksels, folie, zakken
  'schoonmaak',      -- doekjes, sponzen, reinigingsmiddelen
  'keukenmateriaal', -- roosters, gereedschap
  'overig',
  'onbekend'         -- niet vast te stellen -> controle nodig
);

alter table public.products
  add column if not exists item_category public.item_category not null default 'food';

comment on column public.products.item_category is
  'Wat voor soort artikel dit is. Alleen "food" hoort als ingrediënt in recepten thuis; de rest wordt wel ingekocht maar niet in de keuken gebruikt.';

create index if not exists idx_products_item_category
  on public.products(group_id, item_category);

-- Op de importregel, zodat de gebruiker het vóór het doorvoeren ziet.
alter table public.price_import_rows
  add column if not exists item_category public.item_category,
  add column if not exists vat_rate numeric(5,2),
  add column if not exists quality_mark text,
  add column if not exists delivery_date date,
  add column if not exists delivery_note text;

comment on column public.price_import_rows.item_category is
  'Door de uitlezing voorgestelde soort. "onbekend" betekent: controle nodig, niet automatisch als ingrediënt aanmaken.';
comment on column public.price_import_rows.delivery_note is
  'Pakbon- of leveringsnummer waar deze regel bij hoort, zoals op de factuur vermeld.';

-- ---------------------------------------------------------------------
-- Vuistregels voor niet-food, als terugval wanneer de uitlezing niets
-- meegeeft. Bewust conservatief: bij twijfel 'onbekend', zodat er niets
-- stilzwijgend als ingrediënt wordt aangemaakt.
-- ---------------------------------------------------------------------
create or replace function public.guess_item_category(
  p_description text,
  p_vat_rate numeric default null
)
returns public.item_category
language sql
immutable
as $$
  select case
    when p_description is null then 'onbekend'::public.item_category
    -- Geen \M aan het eind: dan matchen ook meervouden en verkleinvormen
    -- ("werkdoekjes", "sponzen", "bakjes"), wat op deze facturen de regel is.
    when p_description ~* '\m(handdoek|werkdoek|theedoek|spons|schuurspons|pannenspons|vaatdoek|reiniger|ontkalk|zeep|afwas)'
      then 'schoonmaak'::public.item_category
    when p_description ~* '\m(afvalzak|vuilniszak|folie|filmrol|bakje|deksel|beker|servet|draagtas|krimpfolie|slagersrol|sterkozak|poolbak)'
      then 'verpakking'::public.item_category
    when p_description ~* '\m(rooster|koekenpan|snijplank|bakplaat|gereedschap|thermometer)\M'
      then 'keukenmateriaal'::public.item_category
    -- In Nederland is voedsel vrijwel altijd 9% en non-food 21%. Dat is
    -- een aanwijzing, geen bewijs: 21% zonder herkenbaar trefwoord blijft
    -- daarom 'onbekend' in plaats van automatisch non-food.
    when p_vat_rate is not null and p_vat_rate >= 20 then 'onbekend'::public.item_category
    when p_vat_rate is not null and p_vat_rate < 15 then 'food'::public.item_category
    else 'onbekend'::public.item_category
  end;
$$;

comment on function public.guess_item_category(text, numeric) is
  'Vuistregel voor de soort artikel op basis van omschrijving en btw-tarief. Bij twijfel "onbekend", zodat niet-food nooit stilzwijgend als ingrediënt wordt aangemaakt.';

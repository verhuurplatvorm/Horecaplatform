-- 0062_ingredient_detailvelden.sql
--
-- Drie velden die het herontworpen ingrediëntscherm nodig heeft en die
-- nog niet bestonden. Al het overige op dat scherm (naam, omschrijving,
-- merk, categorie, EAN, artikelnummer, eenheid, conversies, netto
-- bruikbaar, verlies%, prijs, verpakkingen, allergenen, voedingswaarden,
-- min. voorraad, bestelhoeveelheid, voorkeursleverancier) bestaat al en
-- wordt alleen anders ingedeeld — er zijn bewust geen velden verdubbeld.
--
-- Opmerkingen gebruiken het bestaande products.description; daar komt
-- dus géén apart notitieveld bij.

alter table public.products
  add column if not exists storage_location text,
  add column if not exists image_url text,
  add column if not exists synonyms text[] not null default '{}';

comment on column public.products.storage_location is
  'Waar dit ingrediënt bewaard wordt (bv. "Koeling 2", "Droogvoorraad"). Vrije tekst.';
comment on column public.products.image_url is
  'Productafbeelding, als URL. Puur informatief op het ingrediëntscherm.';
comment on column public.products.synonyms is
  'Alternatieve benamingen waarop dit ingrediënt ook gevonden moet worden (bv. "aubergine" naast "eierplant"). Wordt meegenomen in de zoekfuncties.';

-- Synoniemen doorzoekbaar maken zonder aparte tabel of dubbele opslag.
create index if not exists idx_products_synonyms
  on public.products using gin (synonyms);

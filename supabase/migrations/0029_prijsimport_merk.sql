-- 0029_prijsimport_merk.sql
-- Merk apart tonen in het prijsimport-controlescherm, voor vergelijking
-- naast de artikelnaam (spec: kolomherkenning ondersteunt al "merk").

alter table public.price_import_rows
  add column brand text;

comment on column public.price_import_rows.brand is
  'Merk uit de bronkolom, alleen voor weergave/vergelijking in het controlescherm en als voorinvulling bij het aanmaken van een nieuw product.';

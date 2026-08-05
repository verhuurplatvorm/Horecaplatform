-- 0042_eigen_productnaam.sql
-- Vrij bewerkbaar "eigen productnaam"-veld per product, naast de
-- oorspronkelijke naam. Standaard gevuld met de huidige productnaam,
-- maar de gebruiker kan dit aanpassen naar een eigen, herkenbare naam.
-- Wordt overal waar op productnaam gezocht wordt meegenomen.

alter table public.products
  add column if not exists custom_name text;

update public.products
set custom_name = name
where custom_name is null;

comment on column public.products.custom_name is
  'Vrij bewerkbare eigen naam voor dit product, naast de oorspronkelijke productnaam. Standaard gelijk aan naam bij aanmaken. Wordt meegenomen in alle productzoekfuncties.';

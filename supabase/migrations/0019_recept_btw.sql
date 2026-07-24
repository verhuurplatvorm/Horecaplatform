-- 0019_recept_btw.sql
-- Gerechten met een eigen sales_price (het simpele geval, zonder een
-- apart verkoopproduct) hadden geen btw-percentage — de foodcost-
-- berekening in de UI nam de verkoopprijs dus ten onrechte als zijnde
-- exclusief btw. Voeg vat_rate toe, net als op sales_products.

alter table public.recipes
  add column vat_rate numeric(5,2) not null default 9;

comment on column public.recipes.vat_rate is
  'Btw-percentage over sales_price (bv. 0, 9 of 21). Alleen relevant voor gerechten met een directe verkoopprijs.';

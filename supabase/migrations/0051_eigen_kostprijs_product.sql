-- 0051_eigen_kostprijs_product.sql
-- "Eigen kostprijs" voor producten zonder leverancier (bv. kraanwater,
-- eigen kweekkruiden). Mag €0,00 zijn — daarmee is expliciet vastgelegd
-- dat het ingrediënt gratis is, in plaats van dat de prijs stilzwijgend
-- ontbreekt in de receptkostprijs.
--
-- Voorrangsregels blijven ongewijzigd voor leveranciersprijzen:
--   bedrijfsspecifiek > centraal, contract > spot, meest recent eerst.
-- De eigen kostprijs geldt alleen als er GEEN actieve leveranciersprijs
-- is. Alle kostprijsfuncties (recept, simulatie, historisch) lezen uit
-- deze view en werken dus automatisch mee.

alter table public.products
  add column if not exists manual_price_per_base_unit numeric(12,6)
  check (manual_price_per_base_unit is null or manual_price_per_base_unit >= 0);

comment on column public.products.manual_price_per_base_unit is
  'Eigen kostprijs per basiseenheid voor producten zonder leverancier (€0 toegestaan). Een actieve leveranciersprijs gaat altijd voor.';

create or replace view public.current_product_cost as
select distinct on (product_id, company_id)
  product_id,
  company_id,
  supplier_id,
  price_per_base_unit,
  is_contract_price,
  valid_from
from (
  -- Bron 1: actieve leveranciersprijzen (gaat altijd voor)
  select
    sp.product_id,
    c.id as company_id,
    sp.supplier_id,
    sp.price_per_base_unit,
    sp.is_contract_price,
    sp.valid_from,
    1 as source_rank,
    (sp.company_id is not null) as company_specific
  from public.supplier_products sp
  cross join public.companies c
  where (sp.company_id is null or sp.company_id = c.id)
    and sp.valid_from <= current_date
    and (sp.valid_to is null or sp.valid_to >= current_date)

  union all

  -- Bron 2: eigen kostprijs op het product (terugval, geldt groepsbreed)
  select
    p.id as product_id,
    c.id as company_id,
    null::uuid as supplier_id,
    p.manual_price_per_base_unit as price_per_base_unit,
    false as is_contract_price,
    null::date as valid_from,
    2 as source_rank,
    false as company_specific
  from public.products p
  cross join public.companies c
  where p.manual_price_per_base_unit is not null
) prijsbronnen
order by
  product_id, company_id,
  source_rank,                  -- leveranciersprijs gaat voor eigen prijs
  company_specific desc,        -- bedrijfsspecifieke prijs gaat voor centrale prijs
  is_contract_price desc,       -- contractprijs gaat voor spotprijs
  valid_from desc nulls last;

comment on view public.current_product_cost is
  'Actuele inkoopprijs per product per bedrijf: leveranciersprijs (bedrijfsspecifiek > centraal, contract > spot, meest recent) gaat voor; anders de eigen kostprijs van het product (supplier_id is dan null).';

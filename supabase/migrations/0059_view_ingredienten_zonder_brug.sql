-- 0059_view_ingredienten_zonder_brug.sql
--
-- Overzicht van ingrediënten die een stuk-brug ("1 stuk = X gram/ml")
-- NODIG hebben maar er geen hebben: producten waarvan een receptregel
-- of een actieve leveranciersprijs in een andere dimensie staat dan de
-- basiseenheid van het product (aantal vs. gewicht/inhoud), terwijl
-- avg_unit_quantity leeg is. Precies deze gevallen vallen nu stil weg
-- uit kostprijs en totale hoeveelheid, of worden bij import geweigerd.
--
-- Wordt getoond onder Ingrediënten → Te controleren.

create or replace view public.products_missing_unit_bridge as
with product_dims as (
  select
    p.id,
    p.group_id,
    p.name,
    coalesce(nullif(p.custom_name, ''), p.name) as display_name,
    p.base_unit_id,
    bu.dimension as base_dimension
  from public.products p
  join public.units bu on bu.id = p.base_unit_id
  where p.avg_unit_quantity is null
    and p.is_active
),
recipe_mismatch as (
  select
    pd.id as product_id,
    count(distinct ri.recipe_id) as recipe_count,
    string_agg(distinct r.name, ', ' order by r.name) as recipe_names
  from product_dims pd
  join public.recipe_ingredients ri on ri.product_id = pd.id
  join public.units lu on lu.id = ri.unit_id
  join public.recipes r on r.id = ri.recipe_id
  where (lu.dimension = 'aantal') <> (pd.base_dimension = 'aantal')
  group by pd.id
),
price_mismatch as (
  -- Leveranciersprijzen bewaren hun oorspronkelijke eenheid niet; wel
  -- verraadt een omschrijving met "stuk"/"st" bij een gewicht/inhoud-
  -- product (of andersom een gewichts-/inhoudsmaat bij een stuk-product)
  -- dat er per stuk wordt ingekocht.
  select
    pd.id as product_id,
    count(*) as price_count
  from product_dims pd
  join public.supplier_products sp on sp.product_id = pd.id and sp.valid_to is null
  where (
      pd.base_dimension <> 'aantal'
      and sp.packaging_description ~* '\m(stuks?|st\.?|stk)\M'
    ) or (
      pd.base_dimension = 'aantal'
      and sp.packaging_description ~* '\m(\d+[.,]?\d*)\s*(g|gr|gram|kg|ml|cl|dl|l|ltr|liter)\M'
    )
  group by pd.id
)
select
  pd.id as product_id,
  pd.group_id,
  pd.display_name as product_name,
  pd.base_dimension,
  coalesce(rm.recipe_count, 0) as recipe_count,
  rm.recipe_names,
  coalesce(pm.price_count, 0) as price_count
from product_dims pd
left join recipe_mismatch rm on rm.product_id = pd.id
left join price_mismatch pm on pm.product_id = pd.id
where rm.product_id is not null or pm.product_id is not null;

comment on view public.products_missing_unit_bridge is
  'Ingrediënten zonder stuk-brug (avg_unit_quantity leeg) die wél in recepten of leveranciersprijzen in de andere dimensie (aantal vs. gewicht/inhoud) voorkomen. Kandidaten om "Gemiddeld gewicht/inhoud per stuk" in te vullen.';

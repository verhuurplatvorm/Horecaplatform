-- 0045_ingredienten_import_ongekoppeld.sql
-- Ondersteunt het importeren van recepten/halfproducten uit een extern
-- systeem waarbij niet elk ingrediënt meteen aan een bestaand product
-- gekoppeld kan worden. In plaats van de hele receptregel weg te laten
-- (waardoor het recept onvolledig lijkt), wordt de regel bewaard met de
-- oorspronkelijke naam, duidelijk herkenbaar als "nog niet gekoppeld".

alter table public.recipe_ingredients
  add column if not exists unmatched_name text;

comment on column public.recipe_ingredients.unmatched_name is
  'Oorspronkelijke ingrediëntnaam uit een import, zolang deze regel nog niet aan een product of halfproduct is gekoppeld. Null zodra product_id of sub_recipe_id is ingevuld.';

alter table public.recipe_ingredients
  drop constraint if exists chk_ingredient_source;

alter table public.recipe_ingredients
  add constraint chk_ingredient_source check (
    (product_id is not null and sub_recipe_id is null and unmatched_name is null) or
    (product_id is null and sub_recipe_id is not null and unmatched_name is null) or
    (product_id is null and sub_recipe_id is null and unmatched_name is not null)
  );

create or replace function public.match_product_by_name(
  p_group_id uuid,
  p_name text
)
returns table (
  product_id uuid,
  product_name text,
  similarity_score real
)
language sql
stable
as $$
  select p.id, p.name,
    greatest(
      similarity(lower(p.name), lower(p_name)),
      similarity(lower(coalesce(p.custom_name, '')), lower(p_name))
    )
  from public.products p
  where p.group_id = p_group_id
    and p.is_active
    and (
      similarity(lower(p.name), lower(p_name)) > 0.35
      or similarity(lower(coalesce(p.custom_name, '')), lower(p_name)) > 0.35
    )
  order by 3 desc
  limit 5;
$$;

comment on function public.match_product_by_name(uuid, text) is
  'Zoekt bestaande producten met een gelijkende naam (origineel of eigen productnaam), voor het koppelen van ingrediënten bij het importeren van recepten/halfproducten.';

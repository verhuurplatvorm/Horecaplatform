-- Actuele ingrediënten: automatisch afgeleid, geen eigen vlag.
-- Een ingrediënt is actueel als het (direct of via halfproducten, op elke
-- diepte) gebruikt wordt in
--   * een actueel halfproduct (recipes.is_current_menu), of
--   * een gerecht op een actuele menukaart (menu_cards.status = 'actief').
-- Security invoker: dezelfde RLS als de rest van het overzicht.
create or replace function public.get_current_products(p_company_id uuid)
returns table (
  product_id uuid,
  name text,
  custom_name text,
  base_unit text,
  is_provisional boolean,
  price_per_base_unit numeric,
  supplier_name text,
  purchase_price numeric,
  packaging_description text,
  usage_count bigint,
  used_in text
)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive roots as (
    select r.id
      from recipes r
     where r.is_current_menu and r.status <> 'vervallen'
    union
    select mi.recipe_id
      from menu_items mi
      join menu_folders f on f.id = mi.folder_id
      join menu_cards c on c.id = f.menu_card_id
     where c.status = 'actief'
  ),
  tree (recipe_id, root_id) as (
    select id, id from roots
    union
    select ri.sub_recipe_id, t.root_id
      from recipe_ingredients ri
      join tree t on t.recipe_id = ri.recipe_id
     where ri.sub_recipe_id is not null
  ),
  used as (
    select ri.product_id,
           count(distinct t.root_id) as usage_count,
           string_agg(distinct rr.name, ', ') as used_in
      from tree t
      join recipe_ingredients ri on ri.recipe_id = t.recipe_id
      join recipes rr on rr.id = t.root_id
     where ri.product_id is not null
     group by ri.product_id
  )
  select
    p.id,
    p.name,
    p.custom_name,
    p.base_unit,
    p.is_provisional,
    cpc.price_per_base_unit,
    s.name,
    sp.purchase_price,
    sp.packaging_description,
    u.usage_count,
    u.used_in
  from used u
  join products p on p.id = u.product_id
  left join current_product_cost cpc
         on cpc.product_id = p.id and cpc.company_id = p_company_id
  left join lateral (
    select x.purchase_price, x.packaging_description, x.supplier_id
      from supplier_products x
     where x.product_id = p.id
       and (cpc.supplier_id is null or x.supplier_id = cpc.supplier_id)
       and (x.valid_to is null or x.valid_to >= current_date)
     order by x.valid_from desc nulls last
     limit 1
  ) sp on true
  left join suppliers s on s.id = sp.supplier_id
  order by coalesce(nullif(p.custom_name, ''), p.name);
$$;

grant execute on function public.get_current_products(uuid) to authenticated;

-- Halfproducten die (op elke diepte) gebruikt worden in een gerecht op een
-- actieve menukaart tellen automatisch als actueel, naast de handmatig
-- aangevinkte (recipes.is_current_menu).
create or replace function public.current_menu_halfproduct_ids()
returns table (recipe_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive roots as (
    select mi.recipe_id
      from menu_items mi
      join menu_folders f on f.id = mi.folder_id
      join menu_cards c on c.id = f.menu_card_id
     where c.status = 'actief'
  ),
  tree (recipe_id) as (
    select recipe_id from roots
    union
    select ri.sub_recipe_id
      from recipe_ingredients ri
      join tree t on t.recipe_id = ri.recipe_id
     where ri.sub_recipe_id is not null
  )
  select t.recipe_id
    from tree t
    join recipes r on r.id = t.recipe_id
   where r.recipe_kind = 'halfproduct'
     and r.status <> 'vervallen';
$$;

grant execute on function public.current_menu_halfproduct_ids() to authenticated;

create or replace function public.get_halfproduct_overview(
  p_company_id uuid,
  p_only_current boolean default false
)
returns table (recipe_id uuid, cost_price numeric, usage_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.id,
    case when p_company_id is null then null
         else public.calculate_recipe_cost(r.id, p_company_id) end,
    (select count(*) from public.recipe_ingredients ri where ri.sub_recipe_id = r.id)
  from public.recipes r
  where r.recipe_kind = 'halfproduct'
    and (not p_only_current
         or r.is_current_menu
         or r.id in (select m.recipe_id from public.current_menu_halfproduct_ids() m));
$$;

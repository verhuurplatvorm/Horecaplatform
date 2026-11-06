-- Halfproductenoverzicht in één aanroep: kostprijs en aantal gebruikende
-- recepten voor alle halfproducten tegelijk, in plaats van twee aanvragen
-- per halfproduct vanuit de browser. Security invoker: dezelfde RLS als
-- de losse aanvragen hiervoor.
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
    and (not p_only_current or r.is_current_menu);
$$;

grant execute on function public.get_halfproduct_overview(uuid, boolean) to authenticated;

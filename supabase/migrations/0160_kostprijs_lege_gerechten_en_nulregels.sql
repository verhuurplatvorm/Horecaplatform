-- 0160: Kostprijsstatus
-- 1. Een niet-gekoppelde regel met hoeveelheid 0 (bv. importrest "Kleurstof,
--    Bron: Niet vermeld" in Limoensaus) blokkeert de kostprijs niet meer.
-- 2. Een gerecht/halfproduct zonder één ingrediëntregel krijgt de melding
--    "nog geen ingrediënten" i.p.v. € 0,00 en 0,0% foodcost.

create or replace function public.recipe_own_cost_issues(p_company_id uuid, p_recipe_ids uuid[])
returns table(recipe_id uuid, line_id uuid, kind text, name text, product_id uuid, sub_recipe_id uuid, unit_name text)
language sql
stable
set search_path to 'public'
as $function$
  select ri.recipe_id, ri.id, 'koppeling'::text, ri.unmatched_name,
         null::uuid, null::uuid, uf.name
  from public.recipe_ingredients ri
  left join public.units uf on uf.id = ri.unit_id
  where ri.recipe_id = any(p_recipe_ids)
    and ri.product_id is null and ri.sub_recipe_id is null
    and coalesce(ri.quantity, 0) <> 0

  union all

  select r.id, null::uuid, 'leeg'::text, r.name, null::uuid, null::uuid, null::text
  from public.recipes r
  where r.id = any(p_recipe_ids)
    and not exists (select 1 from public.recipe_ingredients ri where ri.recipe_id = r.id)

  union all

  select x.recipe_id, x.id,
         case when x.price is null then 'prijs' else 'omrekening' end,
         x.pname, x.product_id, null::uuid, x.uname
  from (
    select ri.recipe_id, ri.id, ri.product_id, p.name as pname, uf.name as uname,
           cpc.price_per_base_unit as price,
           case
             when ri.quantity is null then null
             when ri.unit_id = p.base_unit_id then ri.quantity
             when uf.dimension is null or ut.dimension is null then null
             when uf.dimension = ut.dimension or (uf.dimension <> 'aantal' and ut.dimension <> 'aantal') then
               case when coalesce(ut.factor_to_base, 0) = 0 then null else ri.quantity end
             when coalesce(p.net_unit_quantity, p.avg_unit_quantity) is null
                  or coalesce(p.net_unit_quantity, p.avg_unit_quantity) <= 0
                  or ua.dimension is null or ua.dimension = 'aantal' then null
             when uf.dimension = 'aantal' then
               case when coalesce(ut.factor_to_base, 0) = 0 then null else ri.quantity end
             else
               case when coalesce(ua.factor_to_base, 0) = 0 then null else ri.quantity end
           end as qty
    from public.recipe_ingredients ri
    join public.products p on p.id = ri.product_id
    left join public.current_product_cost cpc
           on cpc.product_id = ri.product_id and cpc.company_id = p_company_id
    left join public.units uf on uf.id = ri.unit_id
    left join public.units ut on ut.id = p.base_unit_id
    left join public.units ua on ua.id = p.avg_unit_id
    where ri.recipe_id = any(p_recipe_ids)
  ) x
  where x.price is null or x.qty is null

  union all

  select y.recipe_id, y.id,
         case when y.yield is null or y.yield <= 0 then 'opbrengst' else 'omrekening' end,
         y.sname, null::uuid, y.sub_recipe_id, y.uname
  from (
    select ri.recipe_id, ri.id, ri.sub_recipe_id, s.name as sname, uf.name as uname,
           s.yield_quantity as yield,
           case
             when ri.quantity is null then null
             when ri.unit_id = s.base_unit_id then ri.quantity
             when uf.dimension is null or ut.dimension is null then null
             when uf.dimension = ut.dimension or (uf.dimension <> 'aantal' and ut.dimension <> 'aantal') then
               case when coalesce(ut.factor_to_base, 0) = 0 then null else ri.quantity end
             when s.piece_quantity is null or s.piece_quantity <= 0
                  or up.dimension is null or up.dimension = 'aantal' then null
             when uf.dimension = 'aantal' then
               case when coalesce(ut.factor_to_base, 0) = 0 then null else ri.quantity end
             else
               case when coalesce(up.factor_to_base, 0) = 0 then null else ri.quantity end
           end as qty
    from public.recipe_ingredients ri
    join public.recipes s on s.id = ri.sub_recipe_id
    left join public.units uf on uf.id = ri.unit_id
    left join public.units ut on ut.id = s.base_unit_id
    left join public.units up on up.id = s.piece_unit_id
    where ri.recipe_id = any(p_recipe_ids)
  ) y
  where y.yield is null or y.yield <= 0 or y.qty is null;
$function$;

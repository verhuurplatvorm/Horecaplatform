-- Snelle kostprijzen voor overzichten: alle recepten in één keer, met
-- dezelfde rekenregels als calculate_recipe_cost, maar
--  * prijzen van alle ingrediënten in één query,
--  * elk (sub)recept maar één keer uitgerekend (geheugen), van onder naar boven.
-- Recepten in een lus of te diep genest vallen terug op calculate_recipe_cost.
create or replace function public.calculate_recipe_costs(p_company_id uuid, p_recipe_ids uuid[])
returns table(recipe_id uuid, cost numeric)
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_all uuid[];
  v_prices jsonb;
  v_memo jsonb := '{}'::jsonb;
  v_pending uuid[];
  v_ready uuid[];
  v_rid uuid;
  v_line record;
  v_total numeric;
  v_waste numeric;
  v_free numeric;
  v_qty numeric;
  v_price numeric;
  v_sub numeric;
  v_rounds integer := 0;
begin
  if p_company_id is null or p_recipe_ids is null then
    return;
  end if;

  -- Alle recepten die (via halfproducten) nodig zijn.
  with recursive tree(id, depth) as (
    select unnest(p_recipe_ids), 0
    union
    select ri.sub_recipe_id, t.depth + 1
    from tree t
    join public.recipe_ingredients ri on ri.recipe_id = t.id
    where ri.sub_recipe_id is not null and t.depth < 15
  )
  select array_agg(distinct id) into v_all from tree;

  -- Prijzen van alle betrokken ingrediënten in één keer.
  select coalesce(jsonb_object_agg(cpc.product_id::text, cpc.price_per_base_unit), '{}'::jsonb)
  into v_prices
  from public.current_product_cost cpc
  where cpc.company_id = p_company_id
    and cpc.product_id in (
      select distinct ri.product_id from public.recipe_ingredients ri
      where ri.recipe_id = any(v_all) and ri.product_id is not null
    );

  v_pending := v_all;
  loop
    v_rounds := v_rounds + 1;
    -- Klaar om te rekenen: alle subrecepten zijn al berekend.
    select array_agg(p) into v_ready
    from unnest(v_pending) p
    where not exists (
      select 1 from public.recipe_ingredients ri
      where ri.recipe_id = p and ri.sub_recipe_id is not null
        and not (v_memo ? ri.sub_recipe_id::text)
    );
    exit when v_ready is null or v_rounds > 20;

    foreach v_rid in array v_ready loop
      select coalesce(r.waste_percentage, 0), coalesce(r.margin_free_costs, 0)
      into v_waste, v_free
      from public.recipes r where r.id = v_rid;
      v_total := 0;
      for v_line in
        select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id, ri.loss_percentage,
               p.base_unit_id as product_base, s.yield_quantity as sub_yield, s.base_unit_id as sub_base
        from public.recipe_ingredients ri
        left join public.products p on p.id = ri.product_id
        left join public.recipes s on s.id = ri.sub_recipe_id
        where ri.recipe_id = v_rid
      loop
        if v_line.product_id is not null then
          v_price := (v_prices ->> v_line.product_id::text)::numeric;
          v_qty := public.convert_quantity(v_line.product_id, v_line.quantity, v_line.unit_id, v_line.product_base, true);
          if v_price is not null and v_qty is not null then
            v_total := v_total + v_qty * v_price
              * (1 + public.product_effective_loss_pct(v_line.product_id, v_line.loss_percentage) / 100.0);
          end if;
        elsif v_line.sub_recipe_id is not null then
          v_sub := (v_memo ->> v_line.sub_recipe_id::text)::numeric;
          if v_sub is null or v_line.sub_yield is null or v_line.sub_yield <= 0 then
            continue;
          end if;
          v_qty := public.convert_recipe_quantity(v_line.sub_recipe_id, v_line.quantity, v_line.unit_id, v_line.sub_base);
          if v_qty is null then
            continue;
          end if;
          v_total := v_total + v_sub * (v_qty / v_line.sub_yield);
        end if;
      end loop;
      v_total := round(v_total * (1 + v_waste / 100.0) + v_free, 4);
      v_memo := v_memo || jsonb_build_object(v_rid::text, v_total);
    end loop;

    select array_agg(p) into v_pending from unnest(v_pending) p where not (v_memo ? p::text);
    exit when v_pending is null;
  end loop;

  return query
    select i, case when v_memo ? i::text then (v_memo ->> i::text)::numeric
                   else (select public.calculate_recipe_cost(i, p_company_id)) end
    from unnest(p_recipe_ids) i;
exception when others then
  -- Vangnet (bv. lus in halfproducten): per recept de oude berekening.
  return query
    select i, public.calculate_recipe_cost(i, p_company_id) from unnest(p_recipe_ids) i;
end;
$$;

grant execute on function public.calculate_recipe_costs(uuid, uuid[]) to authenticated;

-- Halfproducten-overzicht via de snelle berekening.
create or replace function public.get_halfproduct_overview(p_company_id uuid, p_only_current boolean default false)
returns table(recipe_id uuid, cost_price numeric, usage_count bigint)
language sql
stable
set search_path to 'public'
as $$
  with hp as (
    select r.id
    from public.recipes r
    where r.recipe_kind = 'halfproduct'
      and (not p_only_current
           or r.is_current_menu
           or r.id in (select m.recipe_id from public.current_menu_halfproduct_ids() m))
  ),
  costs as (
    select c.recipe_id, c.cost
    from public.calculate_recipe_costs(p_company_id, (select array_agg(id) from hp)) c
  ),
  usage as (
    select ri.sub_recipe_id, count(*) n
    from public.recipe_ingredients ri
    where ri.sub_recipe_id in (select id from hp)
    group by ri.sub_recipe_id
  )
  select hp.id,
         case when p_company_id is null then null else costs.cost end,
         coalesce(usage.n, 0)
  from hp
  left join costs on costs.recipe_id = hp.id
  left join usage on usage.sub_recipe_id = hp.id;
$$;

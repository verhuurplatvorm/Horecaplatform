-- 0025_prijswijziging_impact.sql
-- Handmatige prijswijzigingen krijgen een reden/opmerking, en er komt een
-- manier om vóór het opslaan te laten zien wat een prijswijziging
-- betekent voor alle gekoppelde halfproducten en gerechten (spec §2,
-- §13) — zonder de prijs al daadwerkelijk te wijzigen.

alter table public.supplier_products
  add column change_reason text;

comment on column public.supplier_products.change_reason is
  'Reden/opmerking bij een prijswijziging (spec §2). Wie/wanneer wordt al automatisch vastgelegd via de audit_log-trigger op deze tabel.';

-- ---------------------------------------------------------------------
-- calculate_recipe_cost_override: identiek aan calculate_recipe_cost,
-- maar voor precies één product wordt niet de actuele inkoopprijs
-- gebruikt, maar een opgegeven "wat als"-prijs. Zo kan de impact van een
-- prijswijziging doorgerekend worden zonder de prijs al op te slaan.
-- ---------------------------------------------------------------------
create or replace function public.calculate_recipe_cost_override(
  p_recipe_id uuid,
  p_company_id uuid,
  p_override_product_id uuid,
  p_override_price_per_base_unit numeric,
  p_depth integer default 0
)
returns numeric
language plpgsql
stable
as $$
declare
  v_total numeric := 0;
  v_line record;
  v_line_cost numeric;
  v_product_base_unit_id uuid;
  v_ingredient_factor numeric;
  v_ingredient_dimension public.unit_dimension;
  v_target_dimension public.unit_dimension;
  v_price_per_base numeric;
  v_loss_pct numeric;
  v_sub_yield numeric;
  v_sub_base_unit_id uuid;
  v_sub_cost numeric;
  v_converted_qty numeric;
begin
  if p_depth > 15 then
    raise exception 'Kostprijsberekening afgebroken: te diepe halfproduct-nesting.';
  end if;

  for v_line in
    select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id, ri.loss_percentage
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
  loop
    if v_line.product_id is not null then
      select p.base_unit_id, p.default_loss_percentage
      into v_product_base_unit_id, v_loss_pct
      from public.products p where p.id = v_line.product_id;

      if v_line.product_id = p_override_product_id then
        v_price_per_base := p_override_price_per_base_unit;
      else
        select cpc.price_per_base_unit into v_price_per_base
        from public.current_product_cost cpc
        where cpc.product_id = v_line.product_id and cpc.company_id = p_company_id;
      end if;

      v_loss_pct := coalesce(v_line.loss_percentage, v_loss_pct, 0);

      v_ingredient_factor := null;
      if v_line.unit_id is not null and v_product_base_unit_id is not null then
        select u1.factor_to_base, u1.dimension, u2.dimension
        into v_ingredient_factor, v_ingredient_dimension, v_target_dimension
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_product_base_unit_id;

        if v_ingredient_dimension is distinct from v_target_dimension then
          v_ingredient_factor := null;
        end if;
      end if;

      if v_price_per_base is not null and v_ingredient_factor is not null then
        v_line_cost := v_line.quantity * v_ingredient_factor * v_price_per_base
                        * (1 + v_loss_pct / 100.0);
        v_total := v_total + v_line_cost;
      end if;

    elsif v_line.sub_recipe_id is not null then
      select r.yield_quantity, r.base_unit_id
      into v_sub_yield, v_sub_base_unit_id
      from public.recipes r where r.id = v_line.sub_recipe_id;

      v_sub_cost := public.calculate_recipe_cost_override(
        v_line.sub_recipe_id, p_company_id, p_override_product_id,
        p_override_price_per_base_unit, p_depth + 1
      );

      if v_sub_cost is null or v_sub_yield is null or v_sub_yield <= 0 then
        continue;
      end if;

      if v_sub_base_unit_id is not null and v_line.unit_id is not null then
        v_ingredient_factor := null;
        select u1.factor_to_base, u1.dimension, u2.dimension
        into v_ingredient_factor, v_ingredient_dimension, v_target_dimension
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_sub_base_unit_id;

        if v_ingredient_dimension is distinct from v_target_dimension then
          continue;
        end if;

        v_converted_qty := v_line.quantity * v_ingredient_factor;
        v_total := v_total + v_sub_cost * (v_converted_qty / v_sub_yield);
      else
        v_total := v_total + v_sub_cost * (v_line.quantity / v_sub_yield);
      end if;
    end if;
  end loop;

  return round(v_total, 4);
end;
$$;

comment on function public.calculate_recipe_cost_override(uuid, uuid, uuid, numeric, integer) is
  '"Wat als"-variant van calculate_recipe_cost: rekent met een opgegeven prijs voor één product i.p.v. de actuele inkoopprijs, voor impactanalyse vóór een prijswijziging wordt opgeslagen.';

-- ---------------------------------------------------------------------
-- get_price_change_impact: vindt alle gerechten/halfproducten die dit
-- product gebruiken — direct, of indirect via een keten van
-- halfproducten — en vergelijkt hun huidige kostprijs met de kostprijs
-- bij de nieuwe prijs (spec §2, §13).
-- ---------------------------------------------------------------------
create or replace function public.get_price_change_impact(
  p_product_id uuid,
  p_company_id uuid,
  p_new_price_per_base_unit numeric
)
returns table (
  recipe_id uuid,
  recipe_name text,
  recipe_kind public.recipe_kind,
  old_cost numeric,
  new_cost numeric,
  delta numeric,
  sales_price numeric,
  old_foodcost_pct numeric,
  new_foodcost_pct numeric
)
language plpgsql
stable
as $$
begin
  return query
  with recursive affected as (
    select distinct ri.recipe_id
    from public.recipe_ingredients ri
    where ri.product_id = p_product_id

    union

    select ri.recipe_id
    from public.recipe_ingredients ri
    join affected a on ri.sub_recipe_id = a.recipe_id
  )
  select
    r.id,
    r.name,
    r.recipe_kind,
    public.calculate_recipe_cost(r.id, p_company_id),
    public.calculate_recipe_cost_override(r.id, p_company_id, p_product_id, p_new_price_per_base_unit),
    public.calculate_recipe_cost_override(r.id, p_company_id, p_product_id, p_new_price_per_base_unit)
      - public.calculate_recipe_cost(r.id, p_company_id),
    r.sales_price,
    case when r.sales_price is not null then
      public.calculate_recipe_cost(r.id, p_company_id) / (r.sales_price / (1 + r.vat_rate / 100)) * 100
    end,
    case when r.sales_price is not null then
      public.calculate_recipe_cost_override(r.id, p_company_id, p_product_id, p_new_price_per_base_unit)
        / (r.sales_price / (1 + r.vat_rate / 100)) * 100
    end
  from affected a
  join public.recipes r on r.id = a.recipe_id
  order by r.recipe_kind, r.name;
end;
$$;

comment on function public.get_price_change_impact(uuid, uuid, numeric) is
  'Voor een voorgestelde nieuwe prijs: alle gerechten/halfproducten die dit product (direct of via halfproducten) gebruiken, met oude/nieuwe kostprijs en foodcost%. Wijzigt niets, alleen simulatie.';

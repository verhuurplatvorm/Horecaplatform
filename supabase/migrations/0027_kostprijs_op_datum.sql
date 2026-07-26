-- 0027_kostprijs_op_datum.sql
-- Voor het prijzendashboard is een manier nodig om de kostprijs te
-- herberekenen met de prijzen zoals die op een bepaalde datum in het
-- verleden golden — niet slechts één productprijs gesimuleerd (dat deed
-- calculate_recipe_cost_override al), maar de volledige, cumulatieve
-- situatie van toen. Dit maakt "kostprijs nu" vergelijken met "kostprijs
-- 30 dagen geleden" correct, ongeacht hoeveel verschillende ingrediënten
-- in die periode van prijs zijn veranderd.

create or replace function public.calculate_recipe_cost_asof(
  p_recipe_id uuid,
  p_company_id uuid,
  p_asof_date date,
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

      select sp.price_per_base_unit
      into v_price_per_base
      from public.supplier_products sp
      where sp.product_id = v_line.product_id
        and (sp.company_id is null or sp.company_id = p_company_id)
        and sp.valid_from <= p_asof_date
        and (sp.valid_to is null or sp.valid_to >= p_asof_date)
      order by
        sp.company_id nulls last,
        sp.is_contract_price desc,
        sp.valid_from desc
      limit 1;

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

      v_sub_cost := public.calculate_recipe_cost_asof(
        v_line.sub_recipe_id, p_company_id, p_asof_date, p_depth + 1
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

comment on function public.calculate_recipe_cost_asof(uuid, uuid, date, integer) is
  'Kostprijs van een gerecht/halfproduct met de prijzen zoals die op p_asof_date golden. Vergelijk met calculate_recipe_cost(nu) om de cumulatieve prijsimpact over een periode te tonen, ongeacht hoeveel ingrediënten wijzigden.';

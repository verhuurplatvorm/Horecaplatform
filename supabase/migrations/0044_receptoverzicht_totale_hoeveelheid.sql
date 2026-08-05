-- 0044_receptoverzicht_totale_hoeveelheid.sql
-- Voegt aan get_recipe_cost_breakdown een kolom toe met de hoeveelheid
-- omgerekend naar de basiseenheid van het recept zelf (null als de
-- dimensie niet overeenkomt, bv. gewicht bij een recept met een
-- inhoudseenheid) — zodat het scherm een betrouwbare "totale
-- hoeveelheid" kan tonen zonder appels met peren op te tellen.

-- Het returntype (de OUT-parameters) verandert hier — Postgres staat dat
-- niet toe via CREATE OR REPLACE, de functie moet dan eerst expliciet
-- verwijderd worden.
drop function if exists public.get_recipe_cost_breakdown(uuid, uuid);

create or replace function public.get_recipe_cost_breakdown(
  p_recipe_id uuid,
  p_company_id uuid
)
returns table (
  sort_order integer,
  ingredient_name text,
  quantity numeric,
  unit_name text,
  line_cost numeric,
  quantity_in_recipe_unit numeric
)
language plpgsql
stable
as $$
declare
  v_line record;
  v_product_base_unit_id uuid;
  v_loss_pct numeric;
  v_ingredient_factor numeric;
  v_ingredient_dimension public.unit_dimension;
  v_target_dimension public.unit_dimension;
  v_price_per_base numeric;
  v_sub_yield numeric;
  v_sub_base_unit_id uuid;
  v_sub_cost numeric;
  v_converted_qty numeric;
  v_name text;
  v_unit_name text;
  v_cost numeric;
  v_recipe_base_unit_id uuid;
  v_recipe_unit_factor numeric;
  v_recipe_unit_dimension public.unit_dimension;
  v_line_unit_factor numeric;
  v_line_unit_dimension public.unit_dimension;
  v_qty_in_recipe_unit numeric;
begin
  select base_unit_id into v_recipe_base_unit_id
  from public.recipes where id = p_recipe_id;

  if v_recipe_base_unit_id is not null then
    select factor_to_base, dimension into v_recipe_unit_factor, v_recipe_unit_dimension
    from public.units where id = v_recipe_base_unit_id;
  end if;

  for v_line in
    select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id, ri.loss_percentage, ri.sort_order
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
    order by ri.sort_order
  loop
    v_cost := null;
    v_qty_in_recipe_unit := null;
    select u.name into v_unit_name from public.units u where u.id = v_line.unit_id;

    if v_line.unit_id is not null and v_recipe_base_unit_id is not null then
      select factor_to_base, dimension into v_line_unit_factor, v_line_unit_dimension
      from public.units where id = v_line.unit_id;

      if v_line_unit_dimension is not distinct from v_recipe_unit_dimension
         and v_line_unit_factor is not null and v_recipe_unit_factor is not null then
        v_qty_in_recipe_unit := v_line.quantity * v_line_unit_factor / v_recipe_unit_factor;
      end if;
    end if;

    if v_line.product_id is not null then
      select coalesce(nullif(p.custom_name, ''), p.name), p.base_unit_id, p.default_loss_percentage
      into v_name, v_product_base_unit_id, v_loss_pct
      from public.products p where p.id = v_line.product_id;

      select cpc.price_per_base_unit into v_price_per_base
      from public.current_product_cost cpc
      where cpc.product_id = v_line.product_id and cpc.company_id = p_company_id;

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
        v_cost := v_line.quantity * v_ingredient_factor * v_price_per_base * (1 + v_loss_pct / 100.0);
      end if;

    elsif v_line.sub_recipe_id is not null then
      select r.name, r.yield_quantity, r.base_unit_id
      into v_name, v_sub_yield, v_sub_base_unit_id
      from public.recipes r where r.id = v_line.sub_recipe_id;

      v_sub_cost := public.calculate_recipe_cost(v_line.sub_recipe_id, p_company_id);

      if v_sub_cost is not null and v_sub_yield is not null and v_sub_yield > 0 then
        if v_sub_base_unit_id is not null and v_line.unit_id is not null then
          select u1.factor_to_base, u1.dimension, u2.dimension
          into v_ingredient_factor, v_ingredient_dimension, v_target_dimension
          from public.units u1, public.units u2
          where u1.id = v_line.unit_id and u2.id = v_sub_base_unit_id;

          if v_ingredient_dimension is not distinct from v_target_dimension and v_ingredient_factor is not null then
            v_converted_qty := v_line.quantity * v_ingredient_factor;
            v_cost := v_sub_cost * (v_converted_qty / v_sub_yield);
          end if;
        else
          v_cost := v_sub_cost * (v_line.quantity / v_sub_yield);
        end if;
      end if;
    end if;

    return query select v_line.sort_order, v_name, v_line.quantity, v_unit_name, v_cost, v_qty_in_recipe_unit;
  end loop;
end;
$$;

comment on function public.get_recipe_cost_breakdown(uuid, uuid) is
  'Kostprijs per ingrediëntregel van een recept, met de hoeveelheid ook omgerekend naar de eigen basiseenheid van het recept (null bij afwijkende dimensie) zodat een betrouwbare totale hoeveelheid getoond kan worden.';

-- 0032_productie_schaling_fix.sql
-- Bugfix: register_recipe_production trok tot nu toe té veel (of te
-- weinig) voorraad af bij ieder halfproduct met een opbrengst ongelijk
-- aan 1. Een receptregel-hoeveelheid is altijd "nodig voor één volledige
-- batch van yield_quantity" (zo rekent calculate_recipe_cost ook al) —
-- niet "nodig per geproduceerde eenheid". Bij een 10-liter-recept en een
-- productie van 15 liter moet dus met een factor 15/10 = 1,5 geschaald
-- worden, niet met 15.

create or replace function public.register_recipe_production(
  p_recipe_id uuid,
  p_company_id uuid,
  p_quantity numeric,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_production_movement_id uuid;
  v_line record;
  v_user_id uuid := auth.uid();
  v_base_unit_id uuid;
  v_factor numeric;
  v_dim1 public.unit_dimension;
  v_dim2 public.unit_dimension;
  v_converted numeric;
  v_yield_quantity numeric;
  v_scale numeric;
begin
  if p_quantity <= 0 then
    raise exception 'Geproduceerde hoeveelheid moet groter dan 0 zijn.';
  end if;

  select group_id, yield_quantity into v_group_id, v_yield_quantity
  from public.recipes where id = p_recipe_id;
  if v_group_id is null then
    raise exception 'Receptuur % niet gevonden.', p_recipe_id;
  end if;

  v_scale := p_quantity / nullif(v_yield_quantity, 0);
  if v_scale is null then
    v_scale := 1;
  end if;

  insert into public.stock_movements (
    group_id, company_id, recipe_id, movement_type, quantity_change, note, created_by
  ) values (
    v_group_id, p_company_id, p_recipe_id, 'productie', p_quantity, p_note, v_user_id
  )
  returning id into v_production_movement_id;

  for v_line in
    select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
  loop
    if v_line.product_id is not null then
      select base_unit_id into v_base_unit_id from public.products where id = v_line.product_id;
    else
      select base_unit_id into v_base_unit_id from public.recipes where id = v_line.sub_recipe_id;
    end if;

    if v_line.unit_id is null or v_base_unit_id is null then
      continue;
    end if;

    select u1.factor_to_base / u2.factor_to_base, u1.dimension, u2.dimension
    into v_factor, v_dim1, v_dim2
    from public.units u1, public.units u2
    where u1.id = v_line.unit_id and u2.id = v_base_unit_id;

    if v_dim1 is distinct from v_dim2 then
      continue;
    end if;

    v_converted := v_line.quantity * v_factor * v_scale;

    insert into public.stock_movements (
      group_id, company_id, product_id, recipe_id, movement_type,
      quantity_change, note, related_movement_id, created_by
    ) values (
      v_group_id, p_company_id, v_line.product_id, v_line.sub_recipe_id, 'verbruik',
      -v_converted, 'Theoretisch verbruik voor productie', v_production_movement_id, v_user_id
    );
  end loop;

  return v_production_movement_id;
end;
$$;

comment on function public.register_recipe_production(uuid, uuid, numeric, text) is
  'Registreert productie van een halfproduct en trekt automatisch het theoretisch benodigde, evenredig geschaalde ingrediëntverbruik van de voorraad af.';

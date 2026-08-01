-- 0034_batchnummer_producent_receptoverzicht.sql

alter table public.stock_movements
  add column produced_by text,
  add column recipe_version integer;

comment on column public.stock_movements.produced_by is
  'Naam van de producent — verplicht bij elke productieregistratie.';
comment on column public.stock_movements.recipe_version is
  'Snapshot van recipes.version op het moment van productie.';

create or replace function public.register_recipe_production(
  p_recipe_id uuid,
  p_company_id uuid,
  p_quantity numeric,
  p_produced_by text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_recipe_version integer;
  v_production_movement_id uuid;
  v_user_id uuid := auth.uid();
  v_batch_number text;
  v_today_count integer;
begin
  if p_quantity <= 0 then
    raise exception 'Geproduceerde hoeveelheid moet groter dan 0 zijn.';
  end if;

  if p_produced_by is null or btrim(p_produced_by) = '' then
    raise exception 'Naam producent is verplicht.';
  end if;

  select group_id, version into v_group_id, v_recipe_version
  from public.recipes where id = p_recipe_id;
  if v_group_id is null then
    raise exception 'Receptuur % niet gevonden.', p_recipe_id;
  end if;

  select count(*) into v_today_count
  from public.stock_movements
  where company_id = p_company_id
    and movement_type = 'productie'
    and created_at::date = current_date;

  v_batch_number := 'HP-' || to_char(current_date, 'YYYYMMDD') || '-'
                     || lpad((v_today_count + 1)::text, 3, '0');

  insert into public.stock_movements (
    group_id, company_id, recipe_id, movement_type, quantity_change,
    batch_number, produced_by, recipe_version, note, created_by
  ) values (
    v_group_id, p_company_id, p_recipe_id, 'productie', p_quantity,
    v_batch_number, btrim(p_produced_by), v_recipe_version, p_note, v_user_id
  )
  returning id into v_production_movement_id;

  return v_production_movement_id;
end;
$$;

comment on function public.register_recipe_production(uuid, uuid, numeric, text, text) is
  'Registreert een productie: genereert automatisch een uniek batchnummer, vereist een producentnaam, en legt de gebruikte receptversie vast. Boekt bewust geen voorraad af.';

create or replace function public.get_recipe_cost_breakdown(
  p_recipe_id uuid,
  p_company_id uuid
)
returns table (
  sort_order integer,
  ingredient_name text,
  quantity numeric,
  unit_name text,
  line_cost numeric
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
begin
  for v_line in
    select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id, ri.loss_percentage, ri.sort_order
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
    order by ri.sort_order
  loop
    v_cost := null;
    select u.name into v_unit_name from public.units u where u.id = v_line.unit_id;

    if v_line.product_id is not null then
      select p.name, p.base_unit_id, p.default_loss_percentage
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

    return query select v_line.sort_order, v_name, v_line.quantity, v_unit_name, v_cost;
  end loop;
end;
$$;

comment on function public.get_recipe_cost_breakdown(uuid, uuid) is
  'Kostprijs per ingrediëntregel van een recept, voor het receptoverzicht op de halfproduct-pagina.';

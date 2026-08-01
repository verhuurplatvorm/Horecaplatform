-- 0033_geen_voorraadverwerking.sql
-- Voorraad wordt bewust niet bijgehouden/verwerkt. Productie registreren
-- dient uitsluitend voor het productieoverzicht en de sticker — er wordt
-- geen ingrediëntverbruik meer van de voorraad afgeboekt.

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
  v_user_id uuid := auth.uid();
begin
  if p_quantity <= 0 then
    raise exception 'Geproduceerde hoeveelheid moet groter dan 0 zijn.';
  end if;

  select group_id into v_group_id from public.recipes where id = p_recipe_id;
  if v_group_id is null then
    raise exception 'Receptuur % niet gevonden.', p_recipe_id;
  end if;

  insert into public.stock_movements (
    group_id, company_id, recipe_id, movement_type, quantity_change, note, created_by
  ) values (
    v_group_id, p_company_id, p_recipe_id, 'productie', p_quantity, p_note, v_user_id
  )
  returning id into v_production_movement_id;

  return v_production_movement_id;
end;
$$;

comment on function public.register_recipe_production(uuid, uuid, numeric, text) is
  'Registreert alleen de productie zelf (voor het productieoverzicht en de sticker) — er wordt bewust geen ingrediëntverbruik van de voorraad afgeboekt.';

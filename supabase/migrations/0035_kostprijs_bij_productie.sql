-- 0035_kostprijs_bij_productie.sql
-- Aanvulling op 0034: de totale kostprijs van een productie moet
-- worden opgeslagen op het moment van registreren, niet pas achteraf
-- herberekend.

alter table public.stock_movements
  add column if not exists cost_at_production numeric(12,4);

comment on column public.stock_movements.cost_at_production is
  'Totale kostprijs van de productie op het moment van registreren (evenredig geschaald t.o.v. de standaardopbrengst), nooit achteraf herberekend.';

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
  v_yield_quantity numeric;
  v_production_movement_id uuid;
  v_user_id uuid := auth.uid();
  v_batch_number text;
  v_today_count integer;
  v_base_cost numeric;
  v_scale numeric;
begin
  if p_quantity <= 0 then
    raise exception 'Geproduceerde hoeveelheid moet groter dan 0 zijn.';
  end if;

  if p_produced_by is null or btrim(p_produced_by) = '' then
    raise exception 'Naam producent is verplicht.';
  end if;

  select group_id, version, yield_quantity
  into v_group_id, v_recipe_version, v_yield_quantity
  from public.recipes where id = p_recipe_id;
  if v_group_id is null then
    raise exception 'Receptuur % niet gevonden.', p_recipe_id;
  end if;

  v_scale := p_quantity / nullif(v_yield_quantity, 0);
  if v_scale is null then
    v_scale := 1;
  end if;

  v_base_cost := public.calculate_recipe_cost(p_recipe_id, p_company_id);

  select count(*) into v_today_count
  from public.stock_movements
  where company_id = p_company_id
    and movement_type = 'productie'
    and created_at::date = current_date;

  v_batch_number := 'HP-' || to_char(current_date, 'YYYYMMDD') || '-'
                     || lpad((v_today_count + 1)::text, 3, '0');

  insert into public.stock_movements (
    group_id, company_id, recipe_id, movement_type, quantity_change,
    batch_number, produced_by, recipe_version, cost_at_production, note, created_by
  ) values (
    v_group_id, p_company_id, p_recipe_id, 'productie', p_quantity,
    v_batch_number, btrim(p_produced_by), v_recipe_version,
    case when v_base_cost is not null then round(v_base_cost * v_scale, 4) else null end,
    p_note, v_user_id
  )
  returning id into v_production_movement_id;

  return v_production_movement_id;
end;
$$;

comment on function public.register_recipe_production(uuid, uuid, numeric, text, text) is
  'Registreert een productie: genereert automatisch een uniek batchnummer, vereist een producentnaam, en legt de receptversie én de evenredig geschaalde totale kostprijs vast op het moment van registreren. Boekt bewust geen voorraad af.';

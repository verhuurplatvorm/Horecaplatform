-- 0086: "1 stuk = X gram/ml" ook voor halfproducten.
-- Een halfproduct dat in gram/ml is gemaakt (bv. Bakje salade, 125 g) kon niet in
-- stuks in een ander recept gebruikt worden, en een halfproduct in porties (ijs,
-- 45 bollen) niet in ml. Met dit veld legt de kok de brug vast. Netto bruikbaar,
-- dus op dezelfde basis als de opbrengst. Leeg = niets verandert.
alter table public.recipes
  add column if not exists piece_quantity numeric,
  add column if not exists piece_unit_id uuid references public.units(id);

-- Omrekenen voor een receptregel naar een halfproduct. Eerst de gewone
-- omrekening (dezelfde dimensie, ml telt als g); alleen als die niet lukt en
-- het halfproduct een stuk-brug heeft, rekenen via die brug.
create or replace function public.convert_recipe_quantity(
  p_recipe_id uuid, p_quantity numeric, p_from_unit_id uuid, p_to_unit_id uuid
) returns numeric
language plpgsql
stable
as $function$
declare
  v_direct numeric;
  v_from record;
  v_to record;
  v_pu record;
  v_pq numeric;
  v_pu_id uuid;
begin
  v_direct := public.convert_quantity(null, p_quantity, p_from_unit_id, p_to_unit_id);
  if v_direct is not null or p_recipe_id is null then
    return v_direct;
  end if;
  select piece_quantity, piece_unit_id into v_pq, v_pu_id from public.recipes where id = p_recipe_id;
  if v_pq is null or v_pq <= 0 or v_pu_id is null then
    return null;
  end if;
  select dimension, factor_to_base into v_from from public.units where id = p_from_unit_id;
  select dimension, factor_to_base into v_to   from public.units where id = p_to_unit_id;
  select dimension, factor_to_base into v_pu   from public.units where id = v_pu_id;
  if v_from is null or v_to is null or v_pu is null or v_pu.dimension = 'aantal' then
    return null;
  end if;
  if v_from.dimension = 'aantal' and v_to.dimension <> 'aantal' then
    if coalesce(v_to.factor_to_base, 0) = 0 then return null; end if;
    return p_quantity * v_pq * v_pu.factor_to_base / v_to.factor_to_base;
  elsif v_from.dimension <> 'aantal' and v_to.dimension = 'aantal' then
    if coalesce(v_pu.factor_to_base, 0) = 0 then return null; end if;
    return (p_quantity * v_from.factor_to_base / v_pu.factor_to_base) / v_pq;
  end if;
  return null;
end;
$function$;

-- De kostprijsfuncties gebruiken de nieuwe omrekening voor halfproduct-regels.
do $$
declare
  fn text;
  v_def text;
  v_new text;
begin
  foreach fn in array array['calculate_recipe_cost','calculate_recipe_cost_asof','calculate_recipe_cost_override','get_recipe_cost_breakdown'] loop
    for v_def in
      select pg_get_functiondef(p.oid) from pg_proc p
      where p.proname = fn and p.pronamespace = 'public'::regnamespace
    loop
      v_new := replace(
        v_def,
        'public.convert_quantity(null, v_line.quantity, v_line.unit_id, v_sub_base_unit_id)',
        'public.convert_recipe_quantity(v_line.sub_recipe_id, v_line.quantity, v_line.unit_id, v_sub_base_unit_id)'
      );
      if fn = 'get_recipe_cost_breakdown' then
        v_new := replace(
          v_new,
          'if v_qty_in_recipe_unit is null and v_recipe_base_unit_id is not null',
          'if v_qty_in_recipe_unit is null and v_line.sub_recipe_id is not null then
      v_qty_in_recipe_unit := public.convert_recipe_quantity(v_line.sub_recipe_id, v_line.quantity, v_line.unit_id, v_recipe_base_unit_id);
    end if;
    if v_qty_in_recipe_unit is null and v_recipe_base_unit_id is not null'
        );
      end if;
      if v_new = v_def then
        raise exception 'functie % niet aangepast', fn;
      end if;
      execute v_new;
    end loop;
  end loop;
end $$;

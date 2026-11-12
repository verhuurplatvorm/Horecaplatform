-- Menu's: recepten in stuks (bv. 45 bollen ijs) ook in gram/ml kunnen
-- gebruiken via "1 stuk ≈ … gram/ml" van het recept (convert_recipe_quantity).
do $$
declare
  f text;
  d text;
  n text;
begin
  foreach f in array array[
    'public.event_line_plan(uuid)',
    'public.get_event_menu_breakdown(uuid, uuid)',
    'public.calculate_event_menu_cost(uuid, uuid)',
    'public.explode_menu_to_products(uuid)'
  ] loop
    d := pg_get_functiondef(f::regprocedure);
    n := regexp_replace(
      d,
      'public\.convert_quantity\(\s*null,\s*([^,]+),\s*([^,]+),\s*([^,()]+),\s*false\s*\)',
      'public.convert_recipe_quantity(v_line.recipe_id, \1, \2, \3)',
      'g'
    );
    if n = d then
      raise exception '%: niets vervangen', f;
    end if;
    execute n;
  end loop;
end;
$$;

do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.event_item_unit_cost(uuid, uuid, uuid, uuid)'::regprocedure);
  n := replace(d, 'v_one := public.convert_quantity(null, 1, p_unit_id, v_base, false);',
                  'v_one := public.convert_recipe_quantity(p_recipe_id, 1, p_unit_id, v_base);');
  if n = d then
    raise exception 'event_item_unit_cost: niets vervangen';
  end if;
  execute n;
end;
$$;

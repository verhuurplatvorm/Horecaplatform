-- 0085: Een halfproduct met opbrengst in stuks/porties (bv. 45 bollen uit 5 liter ijs)
-- kreeg per regel de melding "geen gemiddeld gewicht per stuk ingesteld", omdat
-- de hoeveelheid niet naar "stuk" omgerekend kon worden. De kostprijs rekent
-- gewoon per regel; die melding is dan onterecht. Alleen melden als de
-- receptuur zelf in gewicht/inhoud is.
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.proname = 'get_recipe_cost_breakdown' and p.pronamespace = 'public'::regnamespace;

  v_new := replace(
    v_def,
    'if v_qty_in_recipe_unit is null and v_recipe_base_unit_id is not null then',
    'if v_qty_in_recipe_unit is null and v_recipe_base_unit_id is not null
       and coalesce((select u2.dimension::text from public.units u2 where u2.id = v_recipe_base_unit_id), '''') <> ''aantal'' then'
  );
  if v_new = v_def then
    raise exception 'patch niet toegepast';
  end if;
  execute v_new;
end $$;

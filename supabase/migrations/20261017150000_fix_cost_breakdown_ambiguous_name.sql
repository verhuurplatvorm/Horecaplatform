-- get_recipe_cost_breakdown gaf de fout "column reference "name" is ambiguous"
-- zodra een regel in een andere dimensie stond dan de basiseenheid van het
-- product (bv. gram bij een product in stuks met een stuk↔gram-koppeling).
-- Het productiescherm van een halfproduct toonde daardoor "geen ingrediënten".
-- Idempotent: past alleen de ene regel aan als die nog in de oude vorm staat.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.get_recipe_cost_breakdown(uuid,uuid)'::regprocedure);
  if position('select name into v_avg_unit_name' in d) > 0 then
    execute replace(d, 'select name into v_avg_unit_name', 'select u.name into v_avg_unit_name');
  end if;
end $$;

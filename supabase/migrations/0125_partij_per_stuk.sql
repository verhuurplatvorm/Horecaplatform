-- Partijgerechten per stuk (bv. een halve brownie p.p.):
-- capaciteit in stuks → recept per vorm = capaciteit / stuks per recept
-- (recept in stuks: opbrengst; anders is het recept 1 stuk).
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.event_line_plan(uuid)'::regprocedure);
  n := regexp_replace(
    d,
    'per_container := greatest\(1, v_cap_base / v_yield_base\);(\s*)end if;',
    'per_container := greatest(1, v_cap_base / v_yield_base);\1elsif v_line.cap_dim = ''aantal'' then\1  per_container := v_line.party_capacity / (case when v_line.base_dim = ''aantal'' and coalesce(v_line.yield_quantity, 0) > 0 then v_line.yield_quantity * v_line.base_factor else 1 end);\1end if;'
  );
  if n = d then
    raise exception 'event_line_plan: tekst niet gevonden';
  end if;
  execute n;
end;
$$;

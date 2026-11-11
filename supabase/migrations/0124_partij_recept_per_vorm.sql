-- Partijgerechten: recept automatisch schalen naar de vorm.
--
-- Rekenregel (aanvulling op 0122):
--   recept per vorm = max(1, hoofdproduct per vorm / totaalgewicht recept)
--   (gram en ml tellen 1 op 1; stuks of onbekend gewicht = 1)
-- Voorbeeld: recept 1.000 g, schaal 3.000 g → recept × 3 per schaal.
-- Is de vorm kleiner dan of gelijk aan het recept (garnering telt niet mee
-- in het hoofdproduct), dan is het recept precies één vorm.
--   kosten per vorm = receptkosten × recept per vorm
--   receptfactor    = vormen (A) of vormen_exact (B) × recept per vorm
--
-- Plus gegevensherstel: hoofdproduct en portie altijd in gram/ml/stuk.

drop function if exists public.get_event_menu_party_plan(uuid, uuid);
drop function if exists public.event_line_plan(uuid);

create function public.event_line_plan(p_line_id uuid)
returns table(needed numeric, is_party boolean, needed_cap numeric, capacity numeric, containers_exact numeric,
  containers integer, full_containers boolean, produced numeric, last_container numeric, recipe_factor numeric,
  per_container numeric)
language plpgsql stable as $$
declare
  v_line record;
  v_persons integer;
  v_cap_base numeric;
  v_yield_base numeric;
begin
  select l.quantity_per_person, l.unit_id, l.is_fixed, l.participation_pct, l.full_containers as line_full,
         l.recipe_id, m.person_count,
         r.party_capacity, r.party_capacity_unit_id, r.party_full_containers, r.yield_quantity,
         cu.dimension as cap_dim, cu.factor_to_base as cap_factor,
         bu.dimension as base_dim, bu.factor_to_base as base_factor
  into v_line
  from public.event_menu_lines l
  join public.event_menus m on m.id = l.menu_id
  left join public.recipes r on r.id = l.recipe_id
  left join public.units cu on cu.id = r.party_capacity_unit_id
  left join public.units bu on bu.id = r.base_unit_id
  where l.id = p_line_id;
  if not found then
    return;
  end if;

  v_persons := coalesce(v_line.person_count, 0);
  needed := v_line.quantity_per_person *
    (case when v_line.is_fixed then 1
          else v_persons * coalesce(v_line.participation_pct, 100) / 100.0 end);

  is_party := false;
  if v_line.recipe_id is not null and v_line.party_capacity is not null
     and v_line.party_capacity > 0 and v_line.party_capacity_unit_id is not null then
    needed_cap := public.convert_quantity(null, needed, v_line.unit_id, v_line.party_capacity_unit_id, false);
    if needed_cap is not null then
      is_party := true;
      capacity := v_line.party_capacity;

      per_container := 1;
      if v_line.cap_dim in ('gewicht', 'inhoud') and v_line.base_dim in ('gewicht', 'inhoud')
         and coalesce(v_line.yield_quantity, 0) > 0 then
        v_cap_base := v_line.party_capacity * v_line.cap_factor;
        v_yield_base := v_line.yield_quantity * v_line.base_factor;
        per_container := greatest(1, v_cap_base / v_yield_base);
      end if;

      containers_exact := needed_cap / capacity;
      containers := ceil(round(containers_exact, 6))::integer;
      full_containers := coalesce(v_line.line_full, v_line.party_full_containers, true);
      if containers = 0 then
        produced := 0; last_container := 0; recipe_factor := 0;
      elsif full_containers then
        produced := containers * capacity;
        last_container := capacity;
        recipe_factor := containers * per_container;
      else
        produced := needed_cap;
        last_container := needed_cap - (containers - 1) * capacity;
        recipe_factor := containers_exact * per_container;
      end if;
    end if;
  end if;
  return next;
end;
$$;

create function public.get_event_menu_party_plan(p_menu_id uuid, p_company_id uuid)
returns table(line_id uuid, recipe_id uuid, recipe_name text, section_name text, container text, capacity numeric,
  capacity_unit text, portion numeric, quantity_per_person numeric, participation_pct numeric, needed numeric,
  containers_exact numeric, containers integer, full_containers boolean, produced numeric, last_container numeric,
  difference numeric, cost_per_container numeric, total_cost numeric, overproduction_cost numeric,
  per_container numeric, recipe_factor numeric)
language plpgsql stable as $$
declare
  v_line record;
  v_plan record;
  v_cost numeric;
begin
  for v_line in
    select l.id, l.recipe_id, l.quantity_per_person, l.participation_pct,
           r.name, r.party_container, r.party_portion, u.key as cap_unit,
           coalesce(s.name, 'Overig') as section_name
    from public.event_menu_lines l
    join public.recipes r on r.id = l.recipe_id
    left join public.units u on u.id = r.party_capacity_unit_id
    left join public.event_menu_sections s on s.id = l.section_id
    where l.menu_id = p_menu_id and r.party_capacity is not null
    order by coalesce(s.sort_order, 999), l.sort_order
  loop
    select * into v_plan from public.event_line_plan(v_line.id);
    if v_plan.is_party is not true then
      continue;
    end if;
    v_cost := public.calculate_recipe_cost(v_line.recipe_id, p_company_id);
    line_id := v_line.id;
    recipe_id := v_line.recipe_id;
    recipe_name := v_line.name;
    section_name := v_line.section_name;
    container := coalesce(v_line.party_container, 'schaal');
    capacity := v_plan.capacity;
    capacity_unit := v_line.cap_unit;
    portion := v_line.party_portion;
    quantity_per_person := v_line.quantity_per_person;
    participation_pct := v_line.participation_pct;
    needed := round(v_plan.needed_cap, 2);
    containers_exact := round(v_plan.containers_exact, 4);
    containers := v_plan.containers;
    full_containers := v_plan.full_containers;
    produced := round(v_plan.produced, 2);
    last_container := round(v_plan.last_container, 2);
    difference := round(v_plan.produced - v_plan.needed_cap, 2);
    per_container := round(v_plan.per_container, 4);
    recipe_factor := round(v_plan.recipe_factor, 4);
    cost_per_container := case when v_cost is null then null else round(v_cost * v_plan.per_container, 4) end;
    total_cost := case when v_cost is null then null else round(v_cost * v_plan.recipe_factor, 4) end;
    overproduction_cost := case when v_cost is null then null
      else round(v_cost * v_plan.per_container * (v_plan.produced - v_plan.needed_cap) / v_plan.capacity, 4) end;
    return next;
  end loop;
end;
$$;

grant execute on function public.event_line_plan(uuid) to authenticated;
grant execute on function public.get_event_menu_party_plan(uuid, uuid) to authenticated;

-- Eenheidsprijs per vorm in de uitsplitsing: × recept per vorm.
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.get_event_menu_breakdown(uuid, uuid)'::regprocedure);
  n := regexp_replace(
    d,
    'unit_price := round\(v_recipe_cost, 4\);(\s*)unit_price_label := v_container;',
    'unit_price := round(v_recipe_cost * v_plan.per_container, 4);\1unit_price_label := v_container;'
  );
  if n = d then
    raise exception 'get_event_menu_breakdown: tekst niet gevonden';
  end if;
  execute n;
end;
$$;

-- Gegevensherstel: hoofdproduct in kg/l → g/ml (portie was al in g/ml bedoeld).
update public.recipes r
set party_capacity = r.party_capacity * u.factor_to_base,
    party_capacity_unit_id = (select id from public.units where key = case when u.dimension = 'inhoud' then 'ml' else 'g' end)
from public.units u
where u.id = r.party_capacity_unit_id and u.key in ('kg', 'l');

-- Menuregels van partijgerechten die (via de oude standaard) in kg/l stonden
-- terwijl de portie in gram bedoeld was: eenheid naar g/ml, getal blijft.
update public.event_menu_lines l
set unit_id = (select id from public.units where key = case when u.dimension = 'inhoud' then 'ml' else 'g' end)
from public.units u, public.recipes r
where u.id = l.unit_id and r.id = l.recipe_id
  and r.party_capacity is not null and u.key in ('kg', 'l')
  and l.quantity_per_person >= 10;

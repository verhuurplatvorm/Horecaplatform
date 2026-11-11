-- Gerechten voor Partijen: productievorm, capaciteit per vorm, standaardportie,
-- deelnamefactor per menuregel en één centrale rekenregel voor menuregels.
--
-- Rekenregels (eenduidig):
--   benodigd      = hoeveelheid p.p. × personen × deelname% / 100   (vaste regel: hoeveelheid × 1)
--   vormen_exact  = benodigd (omgerekend naar capaciteitseenheid) / capaciteit
--   vormen        = afronden naar boven(vormen_exact)
--   A volle vormen         : geproduceerd = vormen × capaciteit, receptfactor = vormen
--   B laatste vorm aanpassen: geproduceerd = benodigd,            receptfactor = vormen_exact
--   kosten        = receptkosten (één standaardvorm incl. garnering) × receptfactor
--   overproductie = geproduceerd − benodigd (alleen bij A)
-- Regels zonder partij-instellingen rekenen exact zoals voorheen (deelname 100% = ongewijzigd).

alter table public.recipes
  add column if not exists party_container text,
  add column if not exists party_capacity numeric,
  add column if not exists party_capacity_unit_id uuid references public.units(id),
  add column if not exists party_portion numeric,
  add column if not exists party_full_containers boolean not null default true;

alter table public.recipes
  drop constraint if exists recipes_party_container_check;
alter table public.recipes
  add constraint recipes_party_container_check check (
    party_container is null or party_container in
      ('schaal','bak','gastronormbak','plaat','stuks','porties','kilogram','liter')
  );
alter table public.recipes
  drop constraint if exists recipes_party_capacity_check;
alter table public.recipes
  add constraint recipes_party_capacity_check check (party_capacity is null or party_capacity > 0);
alter table public.recipes
  drop constraint if exists recipes_party_portion_check;
alter table public.recipes
  add constraint recipes_party_portion_check check (party_portion is null or party_portion > 0);

alter table public.event_menu_lines
  add column if not exists participation_pct numeric not null default 100,
  add column if not exists full_containers boolean;

alter table public.event_menu_lines
  drop constraint if exists event_menu_lines_participation_check;
alter table public.event_menu_lines
  add constraint event_menu_lines_participation_check
    check (participation_pct >= 0 and participation_pct <= 100);

-- Centrale rekenregel voor één menuregel.
create or replace function public.event_line_plan(p_line_id uuid)
returns table(
  needed numeric,            -- in de eenheid van de menuregel
  is_party boolean,
  needed_cap numeric,        -- in de capaciteitseenheid
  capacity numeric,
  containers_exact numeric,
  containers integer,
  full_containers boolean,
  produced numeric,          -- in de capaciteitseenheid
  last_container numeric,    -- inhoud laatste vorm
  recipe_factor numeric      -- aantal keer het recept (= vormen)
)
language plpgsql
stable
as $$
declare
  v_line record;
  v_persons integer;
begin
  select l.quantity_per_person, l.unit_id, l.is_fixed, l.participation_pct, l.full_containers as line_full,
         l.recipe_id, m.person_count,
         r.party_capacity, r.party_capacity_unit_id, r.party_full_containers
  into v_line
  from public.event_menu_lines l
  join public.event_menus m on m.id = l.menu_id
  left join public.recipes r on r.id = l.recipe_id
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
      containers_exact := needed_cap / capacity;
      containers := ceil(round(containers_exact, 6))::integer;
      full_containers := coalesce(v_line.line_full, v_line.party_full_containers, true);
      if containers = 0 then
        produced := 0;
        last_container := 0;
        recipe_factor := 0;
      elsif full_containers then
        produced := containers * capacity;
        last_container := capacity;
        recipe_factor := containers;
      else
        produced := needed_cap;
        last_container := needed_cap - (containers - 1) * capacity;
        recipe_factor := containers_exact;
      end if;
    end if;
  end if;
  return next;
end;
$$;

-- Productielijst per menu (alleen partijgerechten).
create or replace function public.get_event_menu_party_plan(p_menu_id uuid, p_company_id uuid)
returns table(
  line_id uuid,
  recipe_id uuid,
  recipe_name text,
  section_name text,
  container text,
  capacity numeric,
  capacity_unit text,
  portion numeric,
  quantity_per_person numeric,
  participation_pct numeric,
  needed numeric,
  containers_exact numeric,
  containers integer,
  full_containers boolean,
  produced numeric,
  last_container numeric,
  difference numeric,
  cost_per_container numeric,
  total_cost numeric,
  overproduction_cost numeric
)
language plpgsql
stable
as $$
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
    cost_per_container := round(v_cost, 4);
    total_cost := case when v_cost is null then null else round(v_cost * v_plan.recipe_factor, 4) end;
    overproduction_cost := case when v_cost is null then null
      else round(v_cost * (v_plan.produced - v_plan.needed_cap) / v_plan.capacity, 4) end;
    return next;
  end loop;
end;
$$;

-- Kostprijs per menu: gebruikt de centrale rekenregel.
create or replace function public.calculate_event_menu_cost(p_menu_id uuid, p_company_id uuid)
returns numeric
language plpgsql
stable
as $$
declare
  v_persons integer;
  v_fixed numeric;
  v_line record;
  v_plan record;
  v_total numeric := 0;
  v_qty numeric;
  v_recipe_yield numeric;
  v_recipe_base_unit_id uuid;
  v_recipe_cost numeric;
  v_qty_in_recipe_unit numeric;
  v_product_base_unit_id uuid;
  v_price numeric;
  v_recipe_kind text;
  v_line_unit_key text;
begin
  select person_count, coalesce(fixed_costs, 0)
  into v_persons, v_fixed
  from public.event_menus where id = p_menu_id;
  if v_persons is null then
    return null;
  end if;

  for v_line in
    select id, recipe_id, product_id, unit_id
    from public.event_menu_lines where menu_id = p_menu_id
  loop
    select * into v_plan from public.event_line_plan(v_line.id);
    v_qty := v_plan.needed;

    if v_line.product_id is not null then
      select p.base_unit_id into v_product_base_unit_id
      from public.products p where p.id = v_line.product_id;
      select cpc.price_per_base_unit into v_price
      from public.current_product_cost cpc
      where cpc.product_id = v_line.product_id and cpc.company_id = p_company_id;
      v_qty := public.convert_quantity(
        v_line.product_id, v_qty, v_line.unit_id, v_product_base_unit_id, true
      );
      if v_price is not null and v_qty is not null then
        v_total := v_total + v_qty * v_price;
      end if;

    elsif v_line.recipe_id is not null then
      if v_plan.is_party then
        v_recipe_cost := public.calculate_recipe_cost(v_line.recipe_id, p_company_id);
        if v_recipe_cost is not null then
          v_total := v_total + v_recipe_cost * v_plan.recipe_factor;
        end if;
        continue;
      end if;
      select r.yield_quantity, r.base_unit_id, r.recipe_kind
      into v_recipe_yield, v_recipe_base_unit_id, v_recipe_kind
      from public.recipes r where r.id = v_line.recipe_id;
      if v_recipe_yield is null or v_recipe_yield <= 0 then
        select u.key into v_line_unit_key from public.units u where u.id = v_line.unit_id;
        if v_recipe_kind = 'gerecht' and v_line_unit_key = 'stuk' then
          v_recipe_cost := public.calculate_recipe_cost(v_line.recipe_id, p_company_id);
          if v_recipe_cost is not null then
            v_total := v_total + v_recipe_cost * v_qty;
          end if;
        end if;
        continue;
      end if;
      v_qty_in_recipe_unit := public.convert_quantity(
        null, v_qty, v_line.unit_id, v_recipe_base_unit_id, false
      );
      if v_qty_in_recipe_unit is null then
        continue;
      end if;
      v_recipe_cost := public.calculate_recipe_cost(v_line.recipe_id, p_company_id);
      if v_recipe_cost is not null then
        v_total := v_total + v_recipe_cost * (v_qty_in_recipe_unit / v_recipe_yield);
      end if;
    end if;
  end loop;

  return round(v_total + v_fixed, 4);
end;
$$;

-- Uitsplitsing per regel: gebruikt de centrale rekenregel.
create or replace function public.get_event_menu_breakdown(p_menu_id uuid, p_company_id uuid)
returns table(line_id uuid, section_name text, section_sort integer, display_name text, line_type text,
  quantity_per_person numeric, unit_name text, is_fixed boolean, total_quantity numeric, unit_price numeric,
  unit_price_label text, cost_per_person numeric, total_cost numeric, note text, sort_order integer)
language plpgsql
stable
as $$
declare
  v_persons integer;
  v_line record;
  v_plan record;
  v_qty numeric;
  v_product_base_unit_id uuid;
  v_price_per_base numeric;
  v_qty_in_base numeric;
  v_recipe_yield numeric;
  v_recipe_base_unit_id uuid;
  v_recipe_cost numeric;
  v_qty_in_recipe_unit numeric;
  v_one_unit_in_base numeric;
  v_recipe_kind text;
  v_line_unit_key text;
  v_container text;
begin
  select person_count into v_persons from public.event_menus where id = p_menu_id;
  if v_persons is null then
    return;
  end if;

  for v_line in
    select
      l.id, l.section_id, l.recipe_id, l.product_id, l.quantity_per_person,
      l.unit_id, l.is_fixed, l.note, l.sort_order,
      s.name as section_name, s.sort_order as section_sort,
      u.name as unit_name
    from public.event_menu_lines l
    left join public.event_menu_sections s on s.id = l.section_id
    left join public.units u on u.id = l.unit_id
    where l.menu_id = p_menu_id
    order by coalesce(s.sort_order, 999), l.sort_order
  loop
    line_id := v_line.id;
    section_name := coalesce(v_line.section_name, 'Overig');
    section_sort := coalesce(v_line.section_sort, 999);
    quantity_per_person := v_line.quantity_per_person;
    unit_name := v_line.unit_name;
    is_fixed := v_line.is_fixed;
    note := v_line.note;
    sort_order := v_line.sort_order;

    select * into v_plan from public.event_line_plan(v_line.id);
    v_qty := v_plan.needed;
    total_quantity := v_qty;

    unit_price := null;
    unit_price_label := null;
    cost_per_person := null;
    total_cost := null;

    if v_line.product_id is not null then
      line_type := 'ingrediënt';
      select coalesce(nullif(p.custom_name, ''), p.name), p.base_unit_id
      into display_name, v_product_base_unit_id
      from public.products p where p.id = v_line.product_id;

      select cpc.price_per_base_unit into v_price_per_base
      from public.current_product_cost cpc
      where cpc.product_id = v_line.product_id and cpc.company_id = p_company_id;

      if v_price_per_base is not null then
        v_one_unit_in_base := public.convert_quantity(
          v_line.product_id, 1, v_line.unit_id, v_product_base_unit_id, true
        );
        if v_one_unit_in_base is not null then
          unit_price := round(v_one_unit_in_base * v_price_per_base, 4);
          unit_price_label := v_line.unit_name;
        end if;

        v_qty_in_base := public.convert_quantity(
          v_line.product_id, v_qty, v_line.unit_id, v_product_base_unit_id, true
        );
        if v_qty_in_base is not null then
          total_cost := round(v_qty_in_base * v_price_per_base, 4);
        end if;
      end if;

    elsif v_line.recipe_id is not null then
      select
        r.name,
        case when r.recipe_kind = 'halfproduct' then 'halfproduct' else 'gerecht' end,
        r.yield_quantity, r.base_unit_id, r.recipe_kind, coalesce(r.party_container, 'schaal')
      into display_name, line_type, v_recipe_yield, v_recipe_base_unit_id, v_recipe_kind, v_container
      from public.recipes r where r.id = v_line.recipe_id;

      v_recipe_cost := public.calculate_recipe_cost(v_line.recipe_id, p_company_id);

      select u.key into v_line_unit_key from public.units u where u.id = v_line.unit_id;

      if v_plan.is_party then
        if v_recipe_cost is not null then
          unit_price := round(v_recipe_cost, 4);
          unit_price_label := v_container;
          total_cost := round(v_recipe_cost * v_plan.recipe_factor, 4);
        end if;
      elsif v_recipe_cost is not null
         and (v_recipe_yield is null or v_recipe_yield <= 0)
         and v_recipe_kind = 'gerecht'
         and v_line_unit_key = 'stuk' then
        unit_price := round(v_recipe_cost, 4);
        unit_price_label := v_line.unit_name;
        total_cost := round(v_qty * v_recipe_cost, 4);
      elsif v_recipe_cost is not null and v_recipe_yield is not null and v_recipe_yield > 0 then
        v_one_unit_in_base := public.convert_quantity(
          null, 1, v_line.unit_id, v_recipe_base_unit_id, false
        );
        if v_one_unit_in_base is not null then
          unit_price := round((v_one_unit_in_base / v_recipe_yield) * v_recipe_cost, 4);
          unit_price_label := v_line.unit_name;
        end if;

        v_qty_in_recipe_unit := public.convert_quantity(
          null, v_qty, v_line.unit_id, v_recipe_base_unit_id, false
        );
        if v_qty_in_recipe_unit is not null then
          total_cost := round((v_qty_in_recipe_unit / v_recipe_yield) * v_recipe_cost, 4);
        end if;
      end if;
    end if;

    if total_cost is not null and v_persons > 0 then
      cost_per_person := round(total_cost / v_persons, 4);
    end if;

    return next;
  end loop;
end;
$$;

-- Bestellijst: gebruikt de centrale rekenregel.
create or replace function public.explode_menu_to_products(p_menu_id uuid)
returns table(product_id uuid, quantity_in_base numeric)
language plpgsql
stable
as $$
declare
  v_persons integer;
  v_line record;
  v_plan record;
  v_total_qty numeric;
  v_recipe_yield numeric;
  v_recipe_base_unit_id uuid;
  v_qty_in_recipe_unit numeric;
  v_product_base_unit_id uuid;
  v_qty numeric;
  v_ids uuid[] := '{}';
  v_qtys numeric[] := '{}';
  v_row record;
begin
  -- Geen temp table meer: die is niet toegestaan in een STABLE functie
  -- (de vorige versie gaf daardoor een fout bij de bestellijst).
  select person_count into v_persons from public.event_menus where id = p_menu_id;
  if v_persons is null then
    return;
  end if;

  for v_line in
    select l.id, l.recipe_id, l.product_id, l.unit_id
    from public.event_menu_lines l
    where l.menu_id = p_menu_id
  loop
    select * into v_plan from public.event_line_plan(v_line.id);
    v_total_qty := v_plan.needed;

    if v_line.product_id is not null then
      select p.base_unit_id into v_product_base_unit_id
      from public.products p where p.id = v_line.product_id;
      v_qty := public.convert_quantity(
        v_line.product_id, v_total_qty, v_line.unit_id, v_product_base_unit_id, false
      );
      if v_qty is not null then
        v_ids := v_ids || v_line.product_id;
        v_qtys := v_qtys || v_qty;
      end if;

    elsif v_line.recipe_id is not null then
      if v_plan.is_party then
        if v_plan.recipe_factor > 0 then
          for v_row in
            select * from public.explode_recipe_to_products(v_line.recipe_id, v_plan.recipe_factor, 0)
          loop
            v_ids := v_ids || v_row.product_id;
            v_qtys := v_qtys || v_row.quantity_in_base;
          end loop;
        end if;
        continue;
      end if;
      select r.yield_quantity, r.base_unit_id
      into v_recipe_yield, v_recipe_base_unit_id
      from public.recipes r where r.id = v_line.recipe_id;
      if v_recipe_yield is null or v_recipe_yield <= 0 then
        continue;
      end if;
      v_qty_in_recipe_unit := public.convert_quantity(
        null, v_total_qty, v_line.unit_id, v_recipe_base_unit_id, false
      );
      if v_qty_in_recipe_unit is null then
        continue;
      end if;

      for v_row in
        select * from public.explode_recipe_to_products(
          v_line.recipe_id, v_qty_in_recipe_unit / v_recipe_yield, 0
        )
      loop
        v_ids := v_ids || v_row.product_id;
        v_qtys := v_qtys || v_row.quantity_in_base;
      end loop;
    end if;
  end loop;

  return query
    select t.pid, sum(t.q)
    from unnest(v_ids, v_qtys) as t(pid, q)
    group by t.pid;
end;
$$;

grant execute on function public.event_line_plan(uuid) to authenticated;
grant execute on function public.get_event_menu_party_plan(uuid, uuid) to authenticated;

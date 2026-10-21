-- 0088_menu_gerecht_kostprijs.sql
--
-- Een gerecht in een menu/buffet (bv. "Carpaccio", 0,3 stuk per persoon)
-- kreeg geen kostprijs en telde niet mee in het totaal, omdat een gerecht
-- geen opbrengst in gram/stuks heeft. Een gerecht zonder opbrengst is nu
-- één portie (eenheid "stuk"): kostprijs per portie x aantal porties.
-- Gerechten en halfproducten mét opbrengst rekenen ongewijzigd.
-- Idempotent (create or replace).

create or replace function public.get_event_menu_breakdown(
  p_menu_id uuid,
  p_company_id uuid
)
returns table (
  line_id uuid,
  section_name text,
  section_sort integer,
  display_name text,
  line_type text,          -- 'ingrediënt' | 'halfproduct' | 'gerecht'
  quantity_per_person numeric,
  unit_name text,
  is_fixed boolean,
  total_quantity numeric,  -- bij het ingestelde aantal personen
  unit_price numeric,      -- prijs per eenheid van de regel
  unit_price_label text,   -- waar die prijs per geldt, bv. 'kilogram'
  cost_per_person numeric,
  total_cost numeric,
  note text,
  sort_order integer
)
language plpgsql
stable
as $$
declare
  v_persons integer;
  v_line record;
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

    -- Vaste regels tellen één keer, de rest schaalt met het aantal personen.
    v_qty := v_line.quantity_per_person * (case when v_line.is_fixed then 1 else v_persons end);
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
        -- Prijs per eenheid van de REGEL: wat kost één eenheid zoals hier
        -- ingevuld (bv. per kilo als de regel in kilo's staat).
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
        r.yield_quantity, r.base_unit_id, r.recipe_kind
      into display_name, line_type, v_recipe_yield, v_recipe_base_unit_id, v_recipe_kind
      from public.recipes r where r.id = v_line.recipe_id;

      v_recipe_cost := public.calculate_recipe_cost(v_line.recipe_id, p_company_id);

      select u.key into v_line_unit_key from public.units u where u.id = v_line.unit_id;

      if v_recipe_cost is not null
         and (v_recipe_yield is null or v_recipe_yield <= 0)
         and v_recipe_kind = 'gerecht'
         and v_line_unit_key = 'stuk' then
        -- Een gerecht zonder opgegeven opbrengst is één portie; de
        -- kostprijs van het gerecht is dan de prijs per portie (stuk).
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

    -- Kostprijs per persoon: een vaste regel wordt over alle gasten
    -- omgeslagen, een regel per persoon niet.
    if total_cost is not null and v_persons > 0 then
      cost_per_person := round(total_cost / v_persons, 4);
    end if;

    return next;
  end loop;
end;
$$;

create or replace function public.calculate_event_menu_cost(
  p_menu_id uuid,
  p_company_id uuid
)
returns numeric
language plpgsql
stable
as $$
declare
  v_persons integer;
  v_fixed numeric;
  v_line record;
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
    select recipe_id, product_id, quantity_per_person, unit_id, is_fixed
    from public.event_menu_lines where menu_id = p_menu_id
  loop
    v_qty := v_line.quantity_per_person * (case when v_line.is_fixed then 1 else v_persons end);

    if v_line.product_id is not null then
      select p.base_unit_id into v_product_base_unit_id
      from public.products p where p.id = v_line.product_id;
      select cpc.price_per_base_unit into v_price
      from public.current_product_cost cpc
      where cpc.product_id = v_line.product_id and cpc.company_id = p_company_id;
      -- Kostprijs rekent met netto bruikbaar (p_for_cost = true).
      v_qty := public.convert_quantity(
        v_line.product_id, v_qty, v_line.unit_id, v_product_base_unit_id, true
      );
      if v_price is not null and v_qty is not null then
        v_total := v_total + v_qty * v_price;
      end if;

    elsif v_line.recipe_id is not null then
      select r.yield_quantity, r.base_unit_id, r.recipe_kind
      into v_recipe_yield, v_recipe_base_unit_id, v_recipe_kind
      from public.recipes r where r.id = v_line.recipe_id;
      if v_recipe_yield is null or v_recipe_yield <= 0 then
        -- Gerecht zonder opgegeven opbrengst = één portie (stuk).
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

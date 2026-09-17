-- 0065_menu_regelkostprijzen.sql
--
-- Kostprijs per regel van een menu/buffet, zodat in de samenstelling
-- direct te zien is wat elk ingrediënt, halfproduct of gerecht kost en
-- hoe de totale kostprijs is opgebouwd.
--
-- Rekent uitsluitend met bestaande bronnen — er worden nergens prijzen
-- opnieuw ingevoerd of opgeslagen:
--   ingrediënt   -> public.current_product_cost (actuele inkoopprijs)
--   halfproduct  -> public.calculate_recipe_cost / opbrengst
--   gerecht      -> public.calculate_recipe_cost / opbrengst
--   conversies   -> public.convert_quantity (incl. netto bruikbaar)

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
        r.yield_quantity, r.base_unit_id
      into display_name, line_type, v_recipe_yield, v_recipe_base_unit_id
      from public.recipes r where r.id = v_line.recipe_id;

      v_recipe_cost := public.calculate_recipe_cost(v_line.recipe_id, p_company_id);

      if v_recipe_cost is not null and v_recipe_yield is not null and v_recipe_yield > 0 then
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

comment on function public.get_event_menu_breakdown(uuid, uuid) is
  'Samenstelling van een menu/buffet met per regel de eenheidsprijs, kostprijs per persoon en totale kostprijs bij het ingestelde aantal personen. Gebruikt uitsluitend bestaande prijsbronnen en conversies.';

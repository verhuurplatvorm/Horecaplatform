-- 0135: Productiewerklijst rekent eenheden om (functie get_event_menu_production).
--
-- De werklijst telde de hoeveelheid van een menuregel op in de eenheid van
-- die regel (bv. 40 ml p.p. → 6.800 ml) en toonde dat getal in de eenheid
-- van het recept (Bol vanille ijs telt in stuks → "6.800 stuk"). Ook de
-- hoeveelheden van halfproducten in een recept werden niet omgerekend.
--
-- Deze functie doet het centraal: elke hoeveelheid gaat naar de basiseenheid
-- van het recept via convert_recipe_quantity (dezelfde omrekening als de
-- kostprijs, incl. stuk ↔ ml/g via piece_quantity). Halfproducten worden
-- doorgeklapt tot in alle lagen. Partijgerechten gebruiken recipe_factor uit
-- event_line_plan. Lukt omrekenen niet (bv. 0,5 stuk taart bij een recept
-- in gram), dan blijft de hoeveelheid in de eenheid van de menuregel of
-- receptregel staan. Er komt dus nooit een getal in de verkeerde eenheid.

create or replace function public.get_event_menu_production(p_menu_id uuid)
returns table(recipe_id uuid, quantity numeric, unit_id uuid)
language sql
stable
as $$
  with recursive base as (
    select l.recipe_id, p.is_party, p.recipe_factor, p.needed,
           l.unit_id, r.base_unit_id, r.yield_quantity
    from public.event_menu_lines l
    join public.recipes r on r.id = l.recipe_id
    cross join lateral public.event_line_plan(l.id) p
    where l.menu_id = p_menu_id and l.recipe_id is not null
  ),
  direct as (
    select b.recipe_id, b.needed as raw, b.yield_quantity, b.unit_id as line_unit, b.base_unit_id,
      case
        when b.unit_id is null or b.base_unit_id is null or b.unit_id = b.base_unit_id then b.needed
        else public.convert_recipe_quantity(b.recipe_id, b.needed, b.unit_id, b.base_unit_id)
      end as qty
    from base b
    where not coalesce(b.is_party, false)
  ),
  tree(recipe_id, factor, qty, raw, unit_id, raw_unit_id, depth) as (
    -- Startpunt: hoe vaak elk recept uit het menu gemaakt wordt.
    select d.recipe_id, d.qty / d.yield_quantity, null::numeric, null::numeric, null::uuid, null::uuid, 0
    from direct d
    where d.qty is not null and d.yield_quantity > 0
    union all
    select b.recipe_id, b.recipe_factor, null::numeric, null::numeric, null::uuid, null::uuid, 0
    from base b
    where coalesce(b.is_party, false) and b.recipe_factor > 0
    union all
    -- Halfproducten in die recepten, laag voor laag.
    select c.sub_recipe_id,
           case when c.conv is not null and c.yield_quantity > 0
                then c.conv * c.parent_factor / c.yield_quantity end,
           c.conv * c.parent_factor,
           c.quantity * c.parent_factor,
           c.base_unit_id,
           c.ri_unit,
           c.depth + 1
    from (
      select ri.sub_recipe_id, ri.quantity, sr.yield_quantity, sr.base_unit_id, ri.unit_id as ri_unit,
             t.factor as parent_factor, t.depth,
        case
          when ri.unit_id is null or sr.base_unit_id is null or ri.unit_id = sr.base_unit_id then ri.quantity
          else public.convert_recipe_quantity(sr.id, ri.quantity, ri.unit_id, sr.base_unit_id)
        end as conv
      from tree t
      join public.recipe_ingredients ri on ri.recipe_id = t.recipe_id and ri.sub_recipe_id is not null
      join public.recipes sr on sr.id = ri.sub_recipe_id
      where t.factor is not null and t.depth < 10
    ) c
  ),
  rows as (
    select d.recipe_id,
           coalesce(d.qty, d.raw) as quantity,
           case when d.qty is not null then coalesce(d.base_unit_id, d.line_unit) else d.line_unit end as unit_id
    from direct d
    union all
    select t.recipe_id,
           coalesce(t.qty, t.raw),
           case when t.qty is not null then coalesce(t.unit_id, t.raw_unit_id) else t.raw_unit_id end
    from tree t where t.depth > 0
  )
  select r.recipe_id, sum(r.quantity), r.unit_id
  from rows r
  group by r.recipe_id, r.unit_id;
$$;

grant execute on function public.get_event_menu_production(uuid) to authenticated;

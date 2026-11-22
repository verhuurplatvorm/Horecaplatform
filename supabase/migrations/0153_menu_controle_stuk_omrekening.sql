-- 0153: "Kostprijs onvolledig" bij menu's & buffetten — geen valse melding
-- meer bij halfproducten in stuks met een vaste inhoud per stuk.
--
-- Voorbeeld: halfproduct "Bol vanille ijs" levert 45 stuks op en heeft
-- "1 stuk = 111 ml". Een buffetregel van 111 ml per persoon werd goed
-- doorgerekend (kostprijs en totaal gebruiken convert_recipe_quantity, met
-- die brug), maar de controle gebruikte convert_quantity zonder brug en
-- meldde "eenheid niet om te rekenen". De controle gebruikt nu dezelfde
-- omrekening als de kostprijs. Verder is de functie ongewijzigd.

create or replace function public.event_menu_cost_status(p_menu_id uuid, p_company_id uuid)
returns table(is_complete boolean, issues jsonb)
language sql
stable
set search_path to 'public'
as $function$
  with lines as (
    select l.id, l.recipe_id, l.product_id, l.unit_id, uf.name as unit_name,
           uf.key as unit_key
    from public.event_menu_lines l
    left join public.units uf on uf.id = l.unit_id
    where l.menu_id = p_menu_id
  ),
  product_issues as (
    select l.id as line_id, p.name,
           case when cpc.price_per_base_unit is null then 'prijs' else 'omrekening' end as kind,
           l.product_id, l.unit_name
    from lines l
    join public.products p on p.id = l.product_id
    left join public.current_product_cost cpc
           on cpc.product_id = l.product_id and cpc.company_id = p_company_id
    where cpc.price_per_base_unit is null
       or public.convert_quantity(l.product_id, 1, l.unit_id, p.base_unit_id, true) is null
  ),
  recipe_lines as (
    select l.*, r.name, r.recipe_kind, r.yield_quantity, r.base_unit_id,
           coalesce((select pl.is_party from public.event_line_plan(l.id) pl), false) as is_party
    from lines l
    join public.recipes r on r.id = l.recipe_id
  ),
  recipe_line_issues as (
    select rl.id as line_id, rl.name, rl.recipe_id, rl.unit_name,
           case when rl.yield_quantity is null or rl.yield_quantity <= 0 then 'opbrengst'
                else 'omrekening' end as kind
    from recipe_lines rl
    where not rl.is_party
      and (
        ((rl.yield_quantity is null or rl.yield_quantity <= 0)
          and not (rl.recipe_kind = 'gerecht' and rl.unit_key = 'stuk'))
        or (rl.yield_quantity > 0
          -- zelfde omrekening als calculate_event_menu_cost (incl. "1 stuk = …")
          and public.convert_recipe_quantity(rl.recipe_id, 1, rl.unit_id, rl.base_unit_id) is null)
      )
  ),
  sub as (
    select rl.id as menu_line_id, rl.name as top_name, s.issues
    from recipe_lines rl
    join public.recipe_cost_status(
           p_company_id,
           (select array_agg(distinct recipe_id) from recipe_lines)) s
      on s.recipe_id = rl.recipe_id
    where not s.is_complete
  ),
  all_issues as (
    select 0 as ord, jsonb_build_object(
             'line_id', line_id, 'recipe_id', null, 'recipe_name', null, 'kind', kind,
             'name', name, 'product_id', product_id, 'sub_recipe_id', null,
             'unit_name', unit_name, 'path', '[]'::jsonb) as issue
    from product_issues
    union all
    select 0, jsonb_build_object(
             'line_id', line_id, 'recipe_id', null, 'recipe_name', null, 'kind', kind,
             'name', name, 'product_id', null, 'sub_recipe_id', recipe_id,
             'unit_name', unit_name, 'path', '[]'::jsonb)
    from recipe_line_issues
    union all
    select 1, e || jsonb_build_object(
             'path', jsonb_build_array(sub.top_name) || coalesce(e->'path', '[]'::jsonb))
    from sub, jsonb_array_elements(sub.issues) e
  )
  select not exists (select 1 from all_issues),
         coalesce((select jsonb_agg(issue order by ord, issue->>'name') from all_issues), '[]'::jsonb);
$function$;

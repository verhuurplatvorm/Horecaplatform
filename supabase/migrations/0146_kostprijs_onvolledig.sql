-- 0146_kostprijs_onvolledig.sql
--
-- "Kostprijs onvolledig": een kostprijs is pas definitief als elke regel
-- (ook in onderliggende halfproducten, op elke diepte) gekoppeld is, een
-- inkoopprijs heeft en naar de basiseenheid kan worden omgerekend.
--
-- De bedragen zelf blijven komen uit calculate_recipe_costs /
-- calculate_event_menu_cost (ongewijzigd). Deze migratie voegt alleen de
-- STATUS toe: welke regels aandacht vragen. De controles volgen exact de
-- omrekenregels van calculate_recipe_costs (0130): een regel die daar
-- stilzwijgend wegvalt, staat hier als aandachtspunt.
--
-- Soorten aandachtspunten (kind):
--   koppeling   regel is niet gekoppeld (unmatched_name uit een import)
--   prijs       ingrediënt heeft geen geldige inkoopprijs voor dit bedrijf
--   omrekening  hoeveelheid/eenheid is niet om te rekenen naar de basiseenheid
--   opbrengst   halfproduct heeft geen opbrengst, dus geen prijs per eenheid

-- ---------------------------------------------------------------------
-- 1. Eigen aandachtspunten per recept (alleen de regels van dat recept)
-- ---------------------------------------------------------------------
create or replace function public.recipe_own_cost_issues(p_company_id uuid, p_recipe_ids uuid[])
returns table(recipe_id uuid, line_id uuid, kind text, name text,
              product_id uuid, sub_recipe_id uuid, unit_name text)
language sql
stable
security invoker
set search_path to 'public'
as $$
  -- Ongekoppelde regels.
  select ri.recipe_id, ri.id, 'koppeling'::text, ri.unmatched_name,
         null::uuid, null::uuid, uf.name
  from public.recipe_ingredients ri
  left join public.units uf on uf.id = ri.unit_id
  where ri.recipe_id = any(p_recipe_ids)
    and ri.product_id is null and ri.sub_recipe_id is null

  union all

  -- Ingrediëntregels: prijs en omrekening (zelfde regels als 0130).
  select x.recipe_id, x.id,
         case when x.price is null then 'prijs' else 'omrekening' end,
         x.pname, x.product_id, null::uuid, x.uname
  from (
    select ri.recipe_id, ri.id, ri.product_id, p.name as pname, uf.name as uname,
           cpc.price_per_base_unit as price,
           case
             when ri.quantity is null then null
             when ri.unit_id = p.base_unit_id then ri.quantity
             when uf.dimension is null or ut.dimension is null then null
             when uf.dimension = ut.dimension or (uf.dimension <> 'aantal' and ut.dimension <> 'aantal') then
               case when coalesce(ut.factor_to_base, 0) = 0 then null else ri.quantity end
             when coalesce(p.net_unit_quantity, p.avg_unit_quantity) is null
                  or coalesce(p.net_unit_quantity, p.avg_unit_quantity) <= 0
                  or ua.dimension is null or ua.dimension = 'aantal' then null
             when uf.dimension = 'aantal' then
               case when coalesce(ut.factor_to_base, 0) = 0 then null else ri.quantity end
             else
               case when coalesce(ua.factor_to_base, 0) = 0 then null else ri.quantity end
           end as qty
    from public.recipe_ingredients ri
    join public.products p on p.id = ri.product_id
    left join public.current_product_cost cpc
           on cpc.product_id = ri.product_id and cpc.company_id = p_company_id
    left join public.units uf on uf.id = ri.unit_id
    left join public.units ut on ut.id = p.base_unit_id
    left join public.units ua on ua.id = p.avg_unit_id
    where ri.recipe_id = any(p_recipe_ids)
  ) x
  where x.price is null or x.qty is null

  union all

  -- Halfproductregels: opbrengst en omrekening (zelfde regels als 0130).
  select y.recipe_id, y.id,
         case when y.yield is null or y.yield <= 0 then 'opbrengst' else 'omrekening' end,
         y.sname, null::uuid, y.sub_recipe_id, y.uname
  from (
    select ri.recipe_id, ri.id, ri.sub_recipe_id, s.name as sname, uf.name as uname,
           s.yield_quantity as yield,
           case
             when ri.quantity is null then null
             when ri.unit_id = s.base_unit_id then ri.quantity
             when uf.dimension is null or ut.dimension is null then null
             when uf.dimension = ut.dimension or (uf.dimension <> 'aantal' and ut.dimension <> 'aantal') then
               case when coalesce(ut.factor_to_base, 0) = 0 then null else ri.quantity end
             when s.piece_quantity is null or s.piece_quantity <= 0
                  or up.dimension is null or up.dimension = 'aantal' then null
             when uf.dimension = 'aantal' then
               case when coalesce(ut.factor_to_base, 0) = 0 then null else ri.quantity end
             else
               case when coalesce(up.factor_to_base, 0) = 0 then null else ri.quantity end
           end as qty
    from public.recipe_ingredients ri
    join public.recipes s on s.id = ri.sub_recipe_id
    left join public.units uf on uf.id = ri.unit_id
    left join public.units ut on ut.id = s.base_unit_id
    left join public.units up on up.id = s.piece_unit_id
    where ri.recipe_id = any(p_recipe_ids)
  ) y
  where y.yield is null or y.yield <= 0 or y.qty is null;
$$;

grant execute on function public.recipe_own_cost_issues(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Status per recept, inclusief alle onderliggende halfproducten
-- ---------------------------------------------------------------------
-- issues: [{line_id, recipe_id, recipe_name, kind, name, product_id,
--           sub_recipe_id, unit_name, path: [halfproductnamen vanaf de top]}]
-- path is leeg voor regels van het recept zelf.
create or replace function public.recipe_cost_status(p_company_id uuid, p_recipe_ids uuid[])
returns table(recipe_id uuid, is_complete boolean, issues jsonb)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with recursive tree(root, id, path, ids, depth) as (
    select r, r, array[]::text[], array[r], 0
    from unnest(p_recipe_ids) r
    union all
    select t.root, ri.sub_recipe_id, t.path || s.name, t.ids || ri.sub_recipe_id, t.depth + 1
    from tree t
    join public.recipe_ingredients ri on ri.recipe_id = t.id
    join public.recipes s on s.id = ri.sub_recipe_id
    where ri.sub_recipe_id is not null
      and t.depth < 15
      and not (ri.sub_recipe_id = any(t.ids))
  ),
  nodes as (
    -- Eén pad per (top, recept): het kortste.
    select distinct on (root, id) root, id, path, depth
    from tree
    order by root, id, depth
  ),
  own as (
    select * from public.recipe_own_cost_issues(
      p_company_id, (select array_agg(distinct id) from nodes))
  ),
  joined as (
    select n.root, n.depth, o.*, rc.name as recipe_name, n.path
    from nodes n
    join own o on o.recipe_id = n.id
    join public.recipes rc on rc.id = n.id
  )
  select r,
         not exists (select 1 from joined j where j.root = r),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'line_id', j.line_id,
                    'recipe_id', j.recipe_id,
                    'recipe_name', j.recipe_name,
                    'kind', j.kind,
                    'name', j.name,
                    'product_id', j.product_id,
                    'sub_recipe_id', j.sub_recipe_id,
                    'unit_name', j.unit_name,
                    'path', to_jsonb(j.path))
                  order by j.depth, j.recipe_name, j.name)
           from joined j where j.root = r), '[]'::jsonb)
  from unnest(p_recipe_ids) r;
$$;

grant execute on function public.recipe_cost_status(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Status van een menu/buffet (zelfde regels als calculate_event_menu_cost)
-- ---------------------------------------------------------------------
create or replace function public.event_menu_cost_status(p_menu_id uuid, p_company_id uuid)
returns table(is_complete boolean, issues jsonb)
language sql
stable
security invoker
set search_path to 'public'
as $$
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
       or public.convert_quantity(l.product_id, 1, l.unit_id, p.base_unit_id) is null
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
          and public.convert_quantity(null, 1, rl.unit_id, rl.base_unit_id) is null)
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
$$;

grant execute on function public.event_menu_cost_status(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Opschonen: alle aandachtspunten, met gebruik op actieve kaarten/buffetten
-- ---------------------------------------------------------------------
-- Actief = op een menukaart met status 'actief', of in een menu/buffet dat
-- nog niet is uitgevoerd of vervallen (concept/definitief, geen sjabloon,
-- zonder datum of met een datum vanaf vandaag). Doorgerekend naar alle
-- onderliggende halfproducten.
create or replace function public.cost_attention_items(p_company_id uuid)
returns table(line_id uuid, recipe_id uuid, recipe_name text, recipe_kind text,
              kind text, name text, product_id uuid, sub_recipe_id uuid, unit_name text,
              active_sources text[])
language sql
stable
security invoker
set search_path to 'public'
as $$
  with recursive roots(recipe_id, source) as (
    select mi.recipe_id, 'Menukaart ' || c.name
    from public.menu_items mi
    join public.menu_folders f on f.id = mi.folder_id
    join public.menu_cards c on c.id = f.menu_card_id
    where c.status = 'actief'
    union
    select l.recipe_id, 'Buffet ' || m.name
    from public.event_menu_lines l
    join public.event_menus m on m.id = l.menu_id
    where l.recipe_id is not null
      and m.status in ('concept', 'definitief')
      and not m.is_template
      and (m.service_date is null or m.service_date >= current_date)
  ),
  active(recipe_id, source, depth) as (
    select recipe_id, source, 0 from roots
    union
    select ri.sub_recipe_id, a.source, a.depth + 1
    from active a
    join public.recipe_ingredients ri on ri.recipe_id = a.recipe_id
    where ri.sub_recipe_id is not null and a.depth < 15
  ),
  active_by_recipe as (
    select a.recipe_id, array_agg(distinct a.source order by a.source) as sources
    from active a group by a.recipe_id
  ),
  issues as (
    select * from public.recipe_own_cost_issues(
      p_company_id,
      (select array_agg(r.id) from public.recipes r where r.status <> 'vervallen'))
  )
  select i.line_id, i.recipe_id, r.name, r.recipe_kind::text, i.kind, i.name,
         i.product_id, i.sub_recipe_id, i.unit_name,
         coalesce(a.sources, array[]::text[])
  from issues i
  join public.recipes r on r.id = i.recipe_id
  left join active_by_recipe a on a.recipe_id = i.recipe_id

  union all

  -- Ingrediënten die direct op een actief buffet staan.
  select l.id, null::uuid, m.name, 'buffet',
         case when cpc.price_per_base_unit is null then 'prijs' else 'omrekening' end,
         p.name, l.product_id, null::uuid, uf.name,
         array['Buffet ' || m.name]
  from public.event_menu_lines l
  join public.event_menus m on m.id = l.menu_id
  join public.products p on p.id = l.product_id
  left join public.units uf on uf.id = l.unit_id
  left join public.current_product_cost cpc
         on cpc.product_id = l.product_id and cpc.company_id = p_company_id
  where m.status in ('concept', 'definitief')
    and not m.is_template
    and (m.service_date is null or m.service_date >= current_date)
    and (cpc.price_per_base_unit is null
         or public.convert_quantity(l.product_id, 1, l.unit_id, p.base_unit_id) is null);
$$;

grant execute on function public.cost_attention_items(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Eén naam in één keer koppelen, alleen op de gekozen regels
-- ---------------------------------------------------------------------
-- Koppelt ongekoppelde regels (unmatched_name) aan óf een ingrediënt óf
-- een halfproduct. Regels die inmiddels al gekoppeld zijn worden
-- overgeslagen. Geeft het aantal bijgewerkte regels terug.
create or replace function public.link_unmatched_lines(
  p_line_ids uuid[],
  p_product_id uuid,
  p_sub_recipe_id uuid
)
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  if (p_product_id is null) = (p_sub_recipe_id is null) then
    raise exception 'Kies precies één ingrediënt of halfproduct';
  end if;

  update public.recipe_ingredients ri
     set product_id = p_product_id,
         sub_recipe_id = p_sub_recipe_id,
         unmatched_name = null,
         unmatched_article_number = null
   where ri.id = any(p_line_ids)
     and ri.product_id is null
     and ri.sub_recipe_id is null
     -- Een halfproduct niet in zichzelf koppelen.
     and (p_sub_recipe_id is null or ri.recipe_id <> p_sub_recipe_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.link_unmatched_lines(uuid[], uuid, uuid) to authenticated;

-- 0121_match_menu_items_sneller.sql
--
-- match_menu_items (0120) liep in een time-out: de lijst met bestaande
-- recepten/ingrediënten werd per zoeknaam opnieuw genormaliseerd. Nu wordt
-- alles één keer berekend (MATERIALIZED) en gezocht met de trigram-operator.
-- 5 namen ≈ 0,3 s, 60 namen ≈ 1,5 s.

create or replace function public.match_menu_items(p_names text[])
returns table (
  name_index integer,
  item_kind text,
  item_id uuid,
  item_name text,
  company_id uuid,
  status text,
  category text,
  similarity_score real,
  is_exact boolean
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with input as materialized (
    select n.ord::integer as name_index, public.normalize_dish_name(n.name) as norm
    from unnest(p_names) with ordinality as n(name, ord)
  ),
  grp as materialized (
    select public.current_user_group_id() as group_id
  ),
  existing as materialized (
    select case when r.recipe_kind = 'halfproduct' then 'halfproduct' else 'gerecht' end as kind,
           r.id, r.name, r.company_id, r.status::text as status, r.category,
           public.normalize_dish_name(r.name) as norm
    from public.recipes r, grp
    where r.group_id = grp.group_id
      and r.status::text <> 'vervallen'
      and ((r.company_id is null) or public.has_company_access(r.company_id))
    union all
    select 'ingrediënt', p.id, coalesce(nullif(p.custom_name, ''), p.name), null::uuid,
           null::text, p.product_group,
           public.normalize_dish_name(coalesce(nullif(p.custom_name, ''), p.name))
    from public.products p, grp
    where p.group_id = grp.group_id
      and coalesce(p.is_active, true)
  ),
  scored as materialized (
    select i.name_index, e.kind, e.id, e.name, e.company_id, e.status, e.category,
           case when e.norm = i.norm then 1.0::real else similarity(e.norm, i.norm) end as score,
           (e.norm = i.norm) as exact
    from input i
    join existing e on e.norm = i.norm or e.norm % i.norm
    where i.norm <> ''
  ),
  ranked as (
    select s.*, row_number() over (
      partition by s.name_index
      order by s.exact desc, s.score desc,
               case s.kind when 'gerecht' then 0 when 'halfproduct' then 1 else 2 end,
               (s.status = 'goedgekeurd') desc, s.name
    ) as rn
    from scored s
    where s.exact or s.score > 0.4
  )
  select name_index - 1, kind, id, name, company_id, status, category, score, exact
  from ranked
  where rn <= 6
  order by name_index, rn;
$$;

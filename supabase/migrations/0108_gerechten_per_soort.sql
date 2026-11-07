-- Gerechten per soort i.p.v. per seizoen/kaart (7 nov 2026).
--
-- Structuur: Gerechten = bibliotheek met mappen per soort (Burgers,
-- Pizza's, Lunch, …). Het seizoen hoort bij de menukaart; in Gerechten zie
-- je via labels/filter op welke kaart(en) een gerecht staat.
--
-- 1) match_menu_dishes_v2 (opvolger van match_menu_dishes, die ongebruikt
--    blijft staan) geeft ook de map (category) van het gevonden
--    gerecht terug, zodat de PDF-import een passende soortmap kan
--    voorstellen voor nieuwe gerechten.
-- 2) De eenmalige ombouw van de mappen is op 7 nov met akkoord van Henny
--    via de Supabase-connector uitgevoerd (Zomers-mappen hernoemd naar
--    soort, gerechten Winterskaart verdeeld, Zomers 2026 gearchiveerd,
--    26 lege drankgerechten + lege losse mappen verwijderd). Die
--    data-wijziging staat hier niet opnieuw in.

create or replace function public.match_menu_dishes_v2(
  p_group_id uuid,
  p_names text[],
  p_created_before timestamptz default null
)
returns table (
  name_index integer,
  recipe_id uuid,
  recipe_name text,
  company_id uuid,
  status text,
  sales_price numeric,
  category text,
  similarity_score real,
  is_exact boolean
)
language sql
stable
as $$
  with input as (
    select n.ord::integer as name_index, public.normalize_dish_name(n.name) as norm
    from unnest(p_names) with ordinality as n(name, ord)
  ),
  existing as (
    select r.id, r.name, r.company_id, r.status::text as status, r.sales_price, r.category,
           public.normalize_dish_name(r.name) as norm
    from public.recipes r
    where r.group_id = p_group_id
      and r.recipe_kind = 'gerecht'
      and (p_created_before is null or r.created_at < p_created_before)
  ),
  scored as (
    select i.name_index, e.id, e.name, e.company_id, e.status, e.sales_price, e.category,
           case when e.norm = i.norm then 1.0::real else similarity(e.norm, i.norm) end as score,
           (e.norm = i.norm) as exact
    from input i
    join existing e on e.norm = i.norm or similarity(e.norm, i.norm) > 0.4
    where i.norm <> ''
  ),
  ranked as (
    select s.*, row_number() over (
      partition by s.name_index
      order by s.exact desc, s.score desc, (s.status = 'goedgekeurd') desc, s.name
    ) as rn
    from scored s
  )
  select name_index - 1, id, name, company_id, status, sales_price, category, score, exact
  from ranked
  where rn <= 5
  order by name_index, rn;
$$;

comment on function public.match_menu_dishes_v2(uuid, text[], timestamptz) is
  'Zoekt per menukaartregel (index 0-based) maximaal 5 bestaande gerechten met een gelijkende genormaliseerde naam, incl. hun map (category). Alleen voorstellen; koppelen gebeurt pas na bevestiging.';

-- Slim koppelen van menukaart-gerechten aan bestaande gerechten.
--
-- Bij het inlezen van een nieuwe menukaart (PDF) staan er vaak gerechten
-- op die al bestaan (bv. van de zomerkaart). Deze functies vergelijken de
-- namen "genormaliseerd": hoofdletters, leestekens, "&"/"en", "(3 stuks)"
-- vs "3 st." en woordvolgorde ("Vulcano Nachos" = "Nachos Vulcano") maken
-- dan niet meer uit. Er wordt niets automatisch gewijzigd; de functies
-- doen alleen voorstellen.

create or replace function public.normalize_dish_name(p_name text)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(tok, ' ' order by tok), '')
  from (
    select distinct tok
    from regexp_split_to_table(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(coalesce(p_name, '')), '[^[:alnum:]]+', ' ', 'g'),
          '\m(stuks|stuk|stk)\M', 'st', 'g'
        ),
        '\m(en|and)\M', ' ', 'g'
      ),
      '\s+'
    ) as tok
    where tok <> ''
  ) t;
$$;

comment on function public.normalize_dish_name(text) is
  'Genormaliseerde gerechtnaam voor vergelijken: kleine letters, zonder leestekens/"&"/"en", "stuks"→"st", woorden gesorteerd.';

create or replace function public.match_menu_dishes(
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
    select r.id, r.name, r.company_id, r.status::text as status, r.sales_price,
           public.normalize_dish_name(r.name) as norm
    from public.recipes r
    where r.group_id = p_group_id
      and r.recipe_kind = 'gerecht'
      and (p_created_before is null or r.created_at < p_created_before)
  ),
  scored as (
    select i.name_index, e.id, e.name, e.company_id, e.status, e.sales_price,
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
  select name_index - 1, id, name, company_id, status, sales_price, score, exact
  from ranked
  where rn <= 5
  order by name_index, rn;
$$;

comment on function public.match_menu_dishes(uuid, text[], timestamptz) is
  'Zoekt per menukaartregel (index 0-based) maximaal 5 bestaande gerechten met een gelijkende genormaliseerde naam. Alleen voorstellen; koppelen gebeurt pas na bevestiging.';

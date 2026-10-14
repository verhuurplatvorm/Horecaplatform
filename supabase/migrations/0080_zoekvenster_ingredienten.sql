-- 0080_zoekvenster_ingredienten.sql
--
-- Zoekfunctie voor het ingrediëntenvenster in recepten en halfproducten
-- (zoals Horeko). Eén snelle aanroep geeft ingrediënten én halfproducten
-- terug, gerangschikt:
--   0 exacte treffer (naam, eigen naam, artikelnummer, EAN, synoniem,
--     artikelnummer van de leverancier)
--   1 naam begint met de zoekterm
--   2 een woord in de naam begint met de zoekterm
--   3 naam bevat de zoekterm
--   4 overige treffers (merk, leverancier, synoniem, losse woorden)
-- Meerdere woorden ("kookwijn wit") moeten allemaal ergens voorkomen:
-- in naam, eigen naam, merk, artikelnummer, EAN, synoniemen, of de naam /
-- artikelcode van een actieve leverancier.
--
-- Prijs: precies dezelfde actuele prijs als waarmee de receptkostprijs
-- wordt berekend (view current_product_cost: bedrijfsspecifiek > centraal,
-- contract > spot, meest recent; anders de eigen kostprijs). Zo ziet de
-- kok in het venster hetzelfde bedrag dat daarna in het recept telt.
-- Halfproducten: kostprijs per basiseenheid = recepturkosten / opbrengst.
-- Alleen lezen; wijzigt niets. Idempotent (create or replace).

create or replace function public.search_ingredients_picker(
  p_search text,
  p_company_id uuid default null,
  p_limit integer default 60
)
returns table (
  kind text,
  id uuid,
  name text,
  custom_name text,
  brand text,
  article_number text,
  base_unit text,
  base_unit_id uuid,
  supplier_name text,
  supplier_article_code text,
  purchase_price numeric,
  packaging_description text,
  packaging_unit_count numeric,
  price_per_base_unit numeric,
  yield_quantity numeric,
  yield_unit text,
  match_rank integer
)
language sql
stable
as $$
  with q as (
    select
      lower(trim(coalesce(p_search, ''))) as q,
      array(
        select '%' || t || '%'
        from unnest(regexp_split_to_array(lower(trim(coalesce(p_search, ''))), '\s+')) t
        where t <> ''
      ) as pats
  ),
  prod as (
    select
      p.id, p.name, p.custom_name, p.brand, p.article_number, p.base_unit,
      p.base_unit_id, p.manual_price_per_base_unit,
      lower(concat_ws(' ', p.name, p.custom_name, p.brand, p.article_number,
        p.ean_code, array_to_string(p.synonyms, ' '), sup.names,
        array_to_string(sup.codes, ' '))) as haystack,
      (
        lower(p.name) = q.q
        or lower(coalesce(p.custom_name, '')) = q.q
        or lower(coalesce(p.article_number, '')) = q.q
        or coalesce(p.ean_code, '') = q.q
        or exists (select 1 from unnest(p.synonyms) sy where lower(sy) = q.q)
        or exists (select 1 from unnest(sup.codes) c where lower(c) = q.q)
      ) as is_exact,
      lower(p.name) as lname,
      lower(coalesce(p.custom_name, '')) as lcustom,
      q.q as qq
    from public.products p
    cross join q
    left join lateral (
      select
        string_agg(s.name, ' ') as names,
        array_agg(spx.supplier_article_code) filter (where spx.supplier_article_code is not null) as codes
      from public.supplier_products spx
      join public.suppliers s on s.id = spx.supplier_id
      where spx.product_id = p.id
        and spx.valid_to is null
        and (spx.company_id is null or spx.company_id = p_company_id)
    ) sup on true
    where p.is_active
  ),
  prod_ranked as (
    select
      'ingrediënt'::text as kind, id, name, custom_name, brand, article_number,
      base_unit, base_unit_id, manual_price_per_base_unit,
      null::numeric as yield_quantity, null::text as yield_unit,
      case
        when qq = '' then 4
        when is_exact then 0
        when lname like qq || '%' or lcustom like qq || '%' then 1
        when lname like '% ' || qq || '%' or lcustom like '% ' || qq || '%' then 2
        when lname like '%' || qq || '%' or lcustom like '%' || qq || '%' then 3
        else 4
      end as match_rank
    from prod, q
    where q.q = '' or prod.haystack ilike all (q.pats)
  ),
  hp_ranked as (
    select
      'halfproduct'::text as kind, r.id, r.name, null::text as custom_name,
      null::text as brand, null::text as article_number,
      r.yield_unit as base_unit, r.base_unit_id,
      null::numeric as manual_price_per_base_unit,
      r.yield_quantity, r.yield_unit,
      case
        when q.q = '' then 4
        when lower(r.name) = q.q then 0
        when lower(r.name) like q.q || '%' then 1
        when lower(r.name) like '% ' || q.q || '%' then 2
        when lower(r.name) like '%' || q.q || '%' then 3
        else 4
      end as match_rank
    from public.recipes r, q
    where r.recipe_kind = 'halfproduct'
      and (q.q = '' or lower(r.name) ilike all (q.pats))
  ),
  top as (
    select * from (
      select * from prod_ranked
      union all
      select * from hp_ranked
    ) u
    order by match_rank, name
    limit greatest(p_limit, 1)
  )
  select
    t.kind,
    t.id,
    t.name,
    t.custom_name,
    t.brand,
    t.article_number,
    t.base_unit,
    t.base_unit_id,
    s.name,
    sp.supplier_article_code,
    sp.purchase_price,
    sp.packaging_description,
    sp.packaging_unit_count,
    case
      when t.kind = 'ingrediënt' then coalesce(cpc.price_per_base_unit, t.manual_price_per_base_unit)
      when p_company_id is not null and coalesce(t.yield_quantity, 0) > 0
        then public.calculate_recipe_cost(t.id, p_company_id) / t.yield_quantity
      else null
    end,
    t.yield_quantity,
    t.yield_unit,
    t.match_rank
  from top t
  left join lateral (
    select c.supplier_id, c.price_per_base_unit
    from public.current_product_cost c
    where t.kind = 'ingrediënt'
      and c.product_id = t.id
      and (p_company_id is null or c.company_id = p_company_id)
    order by c.price_per_base_unit
    limit 1
  ) cpc on true
  left join lateral (
    select sp2.supplier_article_code, sp2.purchase_price, sp2.packaging_description, sp2.packaging_unit_count
    from public.supplier_products sp2
    where cpc.supplier_id is not null
      and sp2.product_id = t.id
      and sp2.supplier_id = cpc.supplier_id
      and sp2.valid_from <= current_date
      and (sp2.valid_to is null or sp2.valid_to >= current_date)
    order by sp2.valid_from desc
    limit 1
  ) sp on true
  left join public.suppliers s on s.id = cpc.supplier_id
  order by t.match_rank, t.name;
$$;

comment on function public.search_ingredients_picker(text, uuid, integer) is
  'Zoekvenster voor ingrediënten en halfproducten in recepten: gerangschikt (exact > begint met > woordbegin > bevat > overig), zoekt in naam, eigen naam, merk, artikelnummer, EAN, synoniemen en leverancier, en toont de actuele prijs die de receptkostprijs gebruikt.';

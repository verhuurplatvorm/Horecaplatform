-- Favoriete ingrediënten: een ster op het ingrediënt (voor de hele groep,
-- niet per gebruiker). Favorieten staan bovenaan in het zoekvenster bij
-- recepten (search_ingredients_picker) en in de ingrediëntenlijst
-- (search_products_overview). Alleen ingrediënten die bij de zoekterm
-- passen komen mee; binnen die treffers gaan favorieten voor.

alter table public.products
  add column if not exists is_favorite boolean not null default false;

create index if not exists idx_products_favorite on public.products(is_favorite) where is_favorite;

-- ---------------------------------------------------------------------
-- Zoekvenster ingrediënten (recepten): + is_favorite, favorieten eerst.
-- ---------------------------------------------------------------------
drop function if exists public.search_ingredients_picker(text, uuid, integer);

create function public.search_ingredients_picker(p_search text, p_company_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 60)
 RETURNS TABLE(kind text, id uuid, name text, custom_name text, brand text, article_number text, base_unit text, base_unit_id uuid, supplier_name text, supplier_article_code text, purchase_price numeric, packaging_description text, packaging_unit_count numeric, price_per_base_unit numeric, yield_quantity numeric, yield_unit text, match_rank integer, is_favorite boolean)
 LANGUAGE sql
 STABLE
AS $function$
  with q as (
    select
      lower(trim(coalesce(p_search, ''))) as q,
      array(
        select '%' || t || '%'
        from unnest(regexp_split_to_array(lower(trim(coalesce(p_search, ''))), '\s+')) t
        where t <> ''
      ) as pats
  ),
  sup as (
    select
      spx.product_id,
      string_agg(s.name, ' ') as names,
      array_agg(spx.supplier_article_code) filter (where spx.supplier_article_code is not null) as codes
    from public.supplier_products spx
    join public.suppliers s on s.id = spx.supplier_id
    where spx.valid_to is null
      and (spx.company_id is null or spx.company_id = p_company_id)
    group by spx.product_id
  ),
  prod as (
    select
      p.id, p.name, p.custom_name, p.brand, p.article_number, p.base_unit,
      p.base_unit_id, p.manual_price_per_base_unit, p.is_favorite,
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
    left join sup on sup.product_id = p.id
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
      end as match_rank,
      is_favorite
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
      end as match_rank,
      false as is_favorite
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
    order by is_favorite desc, match_rank, name
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
    t.match_rank,
    t.is_favorite
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
  order by t.is_favorite desc, t.match_rank, t.name;
$function$;
grant execute on function public.search_ingredients_picker(text, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Ingrediëntenlijst: + is_favorite, favorieten eerst.
-- ---------------------------------------------------------------------
drop function if exists public.search_products_overview(uuid, text, integer, integer, boolean);

create function public.search_products_overview(p_company_id uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_only_active boolean DEFAULT false)
 RETURNS TABLE(id uuid, product_number integer, name text, custom_name text, brand text, product_group text, base_unit text, base_unit_id uuid, avg_unit_quantity numeric, net_unit_quantity numeric, article_number text, ean_code text, description text, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone, manual_price_per_base_unit numeric, price_row_id uuid, purchase_price numeric, price_per_base_unit numeric, packaging_unit_count numeric, packaging_description text, supplier_article_code text, supplier_name text, valid_from date, flagged_for_review boolean, previous_purchase_price numeric, total_count bigint, is_favorite boolean)
 LANGUAGE sql
 STABLE
AS $function$
  with filtered as (
    select p.*
    from public.products p
    where (not p_only_active or p.is_active)
      and (
        p_search is null or p_search = '' or
        p.name ilike '%' || p_search || '%' or
        p.custom_name ilike '%' || p_search || '%' or
        p.brand ilike '%' || p_search || '%' or
        p.article_number ilike '%' || p_search || '%' or
        p.ean_code ilike '%' || p_search || '%' or
        p_search = any(p.synonyms) or
        exists (
          select 1
          from public.supplier_products spx
          join public.suppliers sx on sx.id = spx.supplier_id
          where spx.product_id = p.id
            and spx.valid_to is null
            and (spx.company_id is null or spx.company_id = p_company_id)
            and (
              sx.name ilike '%' || p_search || '%' or
              spx.supplier_article_code ilike '%' || p_search || '%'
            )
        )
      )
  ),
  counted as (select count(*) as n from filtered),
  page as (
    select * from filtered
    order by is_favorite desc, name
    limit greatest(p_limit, 1) offset greatest(p_offset, 0)
  )
  select
    pg.id,
    pg.product_number,
    pg.name,
    pg.custom_name,
    pg.brand,
    pg.product_group,
    pg.base_unit,
    pg.base_unit_id,
    pg.avg_unit_quantity,
    pg.net_unit_quantity,
    pg.article_number,
    pg.ean_code,
    pg.description,
    pg.is_active,
    pg.created_at,
    pg.updated_at,
    pg.manual_price_per_base_unit,
    sp.id,
    sp.purchase_price,
    sp.price_per_base_unit,
    sp.packaging_unit_count,
    sp.packaging_description,
    sp.supplier_article_code,
    s.name,
    sp.valid_from,
    coalesce(sp.flagged_for_review, false),
    prev.old_purchase_price,
    c.n,
    pg.is_favorite
  from page pg
  cross join counted c
  left join lateral (
    select sp2.*
    from public.supplier_products sp2
    where sp2.product_id = pg.id
      and sp2.valid_to is null
      and (sp2.company_id is null or sp2.company_id = p_company_id)
    order by sp2.company_id nulls last, sp2.valid_from desc
    limit 1
  ) sp on true
  left join public.suppliers s on s.id = sp.supplier_id
  left join lateral (
    select h.old_purchase_price
    from public.price_change_history h
    where h.product_id = pg.id and h.old_purchase_price is not null
    order by h.valid_from desc
    limit 1
  ) prev on true
  order by pg.is_favorite desc, pg.name;
$function$;
grant execute on function public.search_products_overview(uuid, text, integer, integer, boolean) to authenticated;

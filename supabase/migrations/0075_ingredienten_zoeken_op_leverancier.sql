-- 0075_ingredienten_zoeken_op_leverancier.sql
--
-- Het zoekveld van het ingrediëntenoverzicht beloofde te zoeken op
-- leverancier, maar search_products_overview (0066) zocht alleen op naam,
-- eigen naam, merk, artikelnummer, EAN en synoniemen. Zoeken op bv.
-- "fix-fisch" gaf daardoor niets. Deze versie zoekt ook op de naam van de
-- leverancier en de artikelcode van de leverancier (actieve prijsregels).
--
-- Alleen de zoekvoorwaarde is uitgebreid; handtekening en resultaat zijn
-- ongewijzigd, dus de app hoeft niet aangepast te worden voor deze functie.
-- Idempotent (create or replace).

create or replace function public.search_products_overview(
  p_company_id uuid,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0,
  p_only_active boolean default false
)
returns table (
  id uuid,
  product_number integer,
  name text,
  custom_name text,
  brand text,
  product_group text,
  base_unit text,
  base_unit_id uuid,
  avg_unit_quantity numeric,
  net_unit_quantity numeric,
  article_number text,
  ean_code text,
  description text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  manual_price_per_base_unit numeric,
  price_row_id uuid,
  purchase_price numeric,
  price_per_base_unit numeric,
  packaging_unit_count numeric,
  packaging_description text,
  supplier_article_code text,
  supplier_name text,
  valid_from date,
  flagged_for_review boolean,
  previous_purchase_price numeric,
  total_count bigint
)
language sql
stable
as $$
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
        -- Ook zoeken op de leverancier (naam) en de artikelcode van de
        -- leverancier van een actieve prijsregel; het zoekveld belooft dit
        -- ("Zoek op leverancier, ingrediënt of artikelnummer").
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
    order by name
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
    c.n
  from page pg
  cross join counted c
  -- Alleen de actieve prijs, één per ingrediënt.
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
  -- Alleen de laatste vorige prijs, niet de hele historie.
  left join lateral (
    select h.old_purchase_price
    from public.price_change_history h
    where h.product_id = pg.id and h.old_purchase_price is not null
    order by h.valid_from desc
    limit 1
  ) prev on true
  order by pg.name;
$$;

comment on function public.search_products_overview(uuid, text, integer, integer, boolean) is
  'Eén pagina van het ingrediëntenoverzicht: zoeken, sorteren en pagineren in de database, met de actieve prijs en de laatste vorige prijs erbij. Vervangt het ophalen van de volledige catalogus plus losse prijs- en historie-queries. total_count geeft het totaal aantal treffers voor de paginering.';

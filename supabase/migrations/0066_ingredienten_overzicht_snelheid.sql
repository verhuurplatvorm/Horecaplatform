-- 0066_ingredienten_overzicht_snelheid.sql
--
-- Het ingrediëntenoverzicht haalde ALLE ingrediënten op voordat er iets
-- zichtbaar werd. Bij ~4500 ingrediënten waren dat ruim vijftig
-- opeenvolgende queries: producten in pagina's van 1000, daarna per 200
-- de actieve prijzen, en daarna nog eens per 200 de prijshistorie (een
-- zware view met een LATERAL join). Pas als alles binnen was, verscheen
-- het scherm.
--
-- Deze migratie vervangt dat door één functie die per pagina precies de
-- benodigde kolommen teruggeeft, inclusief prijs en vorige prijs, plus
-- de indexen om daar snel op te zoeken en te sorteren.

-- ---------------------------------------------------------------------
-- 1. Indexen op de velden waarop gezocht, gefilterd en gesorteerd wordt
-- ---------------------------------------------------------------------
create extension if not exists pg_trgm;

-- Trigram-indexen maken "bevat"-zoeken (ilike '%term%') snel; een gewone
-- b-tree helpt daar niet bij.
create index if not exists idx_products_name_trgm
  on public.products using gin (name gin_trgm_ops);
create index if not exists idx_products_custom_name_trgm
  on public.products using gin (custom_name gin_trgm_ops);
create index if not exists idx_products_brand_trgm
  on public.products using gin (brand gin_trgm_ops);

create index if not exists idx_products_article_number
  on public.products(article_number);
create index if not exists idx_products_ean_code
  on public.products(ean_code);
create index if not exists idx_products_group_active
  on public.products(group_id, is_active);

-- Actieve prijs per ingrediënt opzoeken is de meest gebruikte join.
create index if not exists idx_supplier_products_active
  on public.supplier_products(product_id, company_id)
  where valid_to is null;

-- ---------------------------------------------------------------------
-- 2. Eén functie voor het overzicht: zoeken, sorteren, pagineren
-- ---------------------------------------------------------------------
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
        p_search = any(p.synonyms)
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

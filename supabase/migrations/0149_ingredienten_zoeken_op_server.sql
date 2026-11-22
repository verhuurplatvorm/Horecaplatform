-- 0149: Centrale ingrediëntendatabase — zoeken, kolomfilters, sorteren en
-- pagineren volledig in de database.
--
-- Voorheen: zoeken in de database, maar kolomfilters en sorteren in de
-- browser over de geladen regels (100 per keer). Een kolomfilter laadde
-- daarom eerst alle ~4.000 ingrediënten in blokken, en sorteren gold alleen
-- voor wat al geladen was. Nu levert deze functie precies één pagina van de
-- volledige, gefilterde en gesorteerde lijst, met het totale aantal.
--
-- Zelfde zoekvelden en prijsbron als search_products_overview: de actuele
-- leveranciersprijs van het bedrijf (bedrijfsprijs vóór groepsprijs,
-- daarna de nieuwste), anders de eigen prijs.
--
-- p_filters: { kolomsleutel: zoektekst } — zelfde sleutels als de tabel:
--   nr, naam, artnr, merk, lev, cat, prijsverp, verp, inhoud, eenheid,
--   prijsbasis, deltapct, deltaeur, laatste, actief, status, notitie, ean.
--   Een kolomfilter is "bevat" (hoofdletterongevoelig) op de getoonde waarde.
-- p_sort_key: één van dezelfde sleutels, of null (favorieten eerst, dan naam).
-- Lege waarden staan altijd onderaan, ook bij aflopend sorteren.

-- Zoekterm veilig in een LIKE-patroon: % _ en \ betekenen dan letterlijk dat teken.
create or replace function public.like_contains(p_term text)
returns text
language sql
immutable
as $$
  select '%' || replace(replace(replace(p_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

create or replace function public.search_products_page(
  p_company_id uuid,
  p_search text default null,
  p_filters jsonb default '{}'::jsonb,
  p_sort_key text default null,
  p_sort_desc boolean default false,
  p_limit integer default 100,
  p_offset integer default 0,
  p_only_favorites boolean default false,
  p_only_current boolean default false,
  p_supplier text default null
)
returns table(
  id uuid, product_number integer, name text, custom_name text, brand text, product_group text,
  base_unit text, base_unit_id uuid, avg_unit_quantity numeric, avg_unit_key text, net_unit_quantity numeric,
  article_number text, ean_code text, description text, is_active boolean,
  created_at timestamptz, updated_at timestamptz, manual_price_per_base_unit numeric,
  price_row_id uuid, purchase_price numeric, price_per_base_unit numeric, packaging_unit_count numeric,
  packaging_description text, supplier_article_code text, supplier_name text, valid_from date,
  flagged_for_review boolean, previous_purchase_price numeric, is_favorite boolean, total_count bigint
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with src as (
    select p.*
      from public.products p
     where (not p_only_favorites or p.is_favorite)
       and (not p_only_current or p.id in (select c.product_id from public.current_product_ids() c))
       and (
         nullif(trim(p_search), '') is null
         or p.name ilike public.like_contains(trim(p_search))
         or p.custom_name ilike public.like_contains(trim(p_search))
         or p.brand ilike public.like_contains(trim(p_search))
         or p.article_number ilike public.like_contains(trim(p_search))
         or p.ean_code ilike public.like_contains(trim(p_search))
         or trim(p_search) = any(p.synonyms)
         or exists (
           select 1
             from public.supplier_products spx
             join public.suppliers sx on sx.id = spx.supplier_id
            where spx.product_id = p.id
              and spx.valid_to is null
              and (spx.company_id is null or spx.company_id = p_company_id)
              and (sx.name ilike public.like_contains(trim(p_search))
                   or spx.supplier_article_code ilike public.like_contains(trim(p_search)))
         )
       )
  ),
  base as (
    select
      p.id, p.product_number, p.name, p.custom_name, p.brand, p.product_group,
      p.base_unit, p.base_unit_id, p.avg_unit_quantity, au.key as avg_unit_key, p.net_unit_quantity,
      p.article_number, p.ean_code, p.description, p.is_active, p.created_at, p.updated_at,
      p.manual_price_per_base_unit,
      sp.id as price_row_id, sp.purchase_price, sp.packaging_unit_count, sp.packaging_description,
      sp.supplier_article_code, sp.valid_from, coalesce(sp.flagged_for_review, false) as flagged,
      -- Eigen prijs geldt alleen als er geen leveranciersprijs is (zoals in de lijst).
      case when sp.price_per_base_unit is null and p.manual_price_per_base_unit is not null
           then p.manual_price_per_base_unit else sp.price_per_base_unit end as price_base,
      case when sp.price_per_base_unit is null and p.manual_price_per_base_unit is not null
           then 'Eigen prijs' else s.name end as supplier_label,
      prev.old_purchase_price as prev_price,
      p.is_favorite
    from src p
    left join public.units au on au.id = p.avg_unit_id
    left join lateral (
      select sp2.*
        from public.supplier_products sp2
       where sp2.product_id = p.id
         and sp2.valid_to is null
         and (sp2.company_id is null or sp2.company_id = p_company_id)
       order by sp2.company_id nulls last, sp2.valid_from desc
       limit 1
    ) sp on true
    left join public.suppliers s on s.id = sp.supplier_id
    left join lateral (
      select h.old_purchase_price
        from public.price_change_history h
       where h.product_id = p.id and h.old_purchase_price is not null
       order by h.valid_from desc
       limit 1
    ) prev on true
  ),
  -- De waarde zoals de tabel hem toont, per kolomsleutel (tekst voor filteren).
  vals as (
    select b.*,
      coalesce(nullif(trim(b.custom_name), ''), b.name) as v_naam,
      coalesce(b.supplier_article_code, b.article_number) as v_artnr,
      case when b.purchase_price is not null and b.prev_price is not null and b.prev_price <> 0
           then (b.purchase_price - b.prev_price) / b.prev_price * 100 end as v_deltapct,
      case when b.purchase_price is not null and b.prev_price is not null and b.prev_price <> 0
           then b.purchase_price - b.prev_price end as v_deltaeur,
      case when b.flagged then 'Te controleren'
           when b.price_base is null then 'Geen prijs' else 'In orde' end as v_status,
      case when b.is_active then 'Ja' else 'Nee' end as v_actief
    from base b
  ),
  filtered as (
    select v.*
      from vals v
     where (p_supplier is null or v.supplier_label = p_supplier)
       and (p_filters->>'nr' is null or v.product_number::text ilike public.like_contains(p_filters->>'nr'))
       and (p_filters->>'naam' is null or v.v_naam ilike public.like_contains(p_filters->>'naam'))
       and (p_filters->>'artnr' is null or v.v_artnr ilike public.like_contains(p_filters->>'artnr'))
       and (p_filters->>'merk' is null or v.brand ilike public.like_contains(p_filters->>'merk'))
       and (p_filters->>'lev' is null or v.supplier_label ilike public.like_contains(p_filters->>'lev'))
       and (p_filters->>'cat' is null or v.product_group ilike public.like_contains(p_filters->>'cat'))
       and (p_filters->>'prijsverp' is null or v.purchase_price::text ilike public.like_contains(p_filters->>'prijsverp'))
       and (p_filters->>'verp' is null or v.packaging_description ilike public.like_contains(p_filters->>'verp'))
       and (p_filters->>'inhoud' is null or v.packaging_unit_count::text ilike public.like_contains(p_filters->>'inhoud'))
       and (p_filters->>'eenheid' is null or v.base_unit ilike public.like_contains(p_filters->>'eenheid'))
       and (p_filters->>'prijsbasis' is null or v.price_base::text ilike public.like_contains(p_filters->>'prijsbasis'))
       and (p_filters->>'deltapct' is null or round(v.v_deltapct, 2)::text ilike public.like_contains(p_filters->>'deltapct'))
       and (p_filters->>'deltaeur' is null or round(v.v_deltaeur, 2)::text ilike public.like_contains(p_filters->>'deltaeur'))
       and (p_filters->>'laatste' is null or v.valid_from::text ilike public.like_contains(p_filters->>'laatste'))
       and (p_filters->>'actief' is null or v.v_actief ilike public.like_contains(p_filters->>'actief'))
       and (p_filters->>'status' is null or v.v_status ilike public.like_contains(p_filters->>'status'))
       and (p_filters->>'notitie' is null or v.description ilike public.like_contains(p_filters->>'notitie'))
       and (p_filters->>'ean' is null or v.ean_code ilike public.like_contains(p_filters->>'ean'))
  ),
  sorted as (
    select f.*,
      case p_sort_key
        when 'nr' then f.product_number::numeric
        when 'prijsverp' then f.purchase_price
        when 'inhoud' then f.packaging_unit_count
        when 'prijsbasis' then f.price_base
        when 'deltapct' then f.v_deltapct
        when 'deltaeur' then f.v_deltaeur
      end as s_num,
      case p_sort_key
        when 'naam' then lower(f.v_naam)
        when 'artnr' then lower(f.v_artnr)
        when 'merk' then lower(f.brand)
        when 'lev' then lower(f.supplier_label)
        when 'cat' then lower(f.product_group)
        when 'verp' then lower(f.packaging_description)
        when 'eenheid' then f.base_unit
        when 'laatste' then f.valid_from::text
        when 'actief' then f.v_actief
        when 'status' then f.v_status
        when 'notitie' then lower(f.description)
        when 'ean' then f.ean_code
        when 'gemaakt' then f.created_at::text
        when 'gewijzigd' then f.updated_at::text
      end as s_txt,
      count(*) over () as n
    from filtered f
  )
  select
    s.id, s.product_number, s.name, s.custom_name, s.brand, s.product_group,
    s.base_unit, s.base_unit_id, s.avg_unit_quantity, s.avg_unit_key, s.net_unit_quantity,
    s.article_number, s.ean_code, s.description, s.is_active, s.created_at, s.updated_at,
    s.manual_price_per_base_unit, s.price_row_id, s.purchase_price, s.price_base,
    s.packaging_unit_count, s.packaging_description, s.supplier_article_code, s.supplier_label,
    s.valid_from, s.flagged, s.prev_price, s.is_favorite, s.n
  from sorted s
  order by
    (p_sort_key is not null and s.s_num is null and s.s_txt is null),
    case when not p_sort_desc then s.s_num end asc,
    case when p_sort_desc then s.s_num end desc,
    case when not p_sort_desc then s.s_txt end asc,
    case when p_sort_desc then s.s_txt end desc,
    s.is_favorite desc, lower(s.name), s.id
  limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0);
$$;

grant execute on function public.like_contains(text) to authenticated;
grant execute on function public.search_products_page(uuid, text, jsonb, text, boolean, integer, integer, boolean, boolean, text) to authenticated;

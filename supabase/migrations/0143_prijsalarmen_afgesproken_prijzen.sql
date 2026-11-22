-- 0143: Prijsalarmen blijven, ook bij afgesproken prijzen.
--
-- Correctie op 0142:
-- * Elke prijswijziging geeft een prijsalarm, zodat de ontwikkeling
--   zichtbaar blijft. Bij afgesproken prijzen (vaste prijslijst of
--   contractprijs) telt elke afwijking, ook onder de alarmgrens (%).
-- * Een factuur die afwijkt van een afgesproken prijs (vaste prijs of
--   contract) telt mee als prijsalarm op het dashboard, tot hij in de
--   prijscontrole is beoordeeld.
-- * Dagprijzen: weer gewone waarschuwingen in de prijscontrole (0142 zette
--   die uit). Vaste prijzen houden hun strengere regels.
-- * Pijltjes / vorige prijs blijven zichtbaar na accepteren (ontwikkeling).
--   Accepteren handelt alleen de openstaande alarmen af.
-- Halfproducten en gerechten rekenen altijd live met de actuele prijs
-- (current_product_cost); daar verandert niets aan.

-- Is dit een afgesproken prijs? (contractprijs of leverancier met vaste prijzen)
create or replace function public.is_agreed_price(p_supplier_id uuid, p_is_contract boolean)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce(p_is_contract, false)
      or exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.price_type = 'vast');
$$;
grant execute on function public.is_agreed_price(uuid, boolean) to authenticated;

-- Factuurregels die afwijken van een afgesproken prijs, nog niet beoordeeld.
create or replace function public.agreed_price_deviations(p_days integer default 30, p_company_ids uuid[] default null)
returns table(row_id uuid, batch_id uuid, invoice_number text, invoice_date date, supplier_name text,
  product_id uuid, product_name text, description text, invoice_price numeric, ref_price numeric,
  ref_source text, diff_pct numeric, impact numeric, reasons text[])
language sql
stable
set search_path to 'public'
as $$
  select c.row_id, c.batch_id, c.invoice_number, c.invoice_date, c.supplier_name,
         c.product_id, c.product_name, c.description, c.invoice_price, c.ref_price,
         c.ref_source, c.diff_pct, c.impact, c.reasons
  from public.price_comparison(current_date - greatest(p_days, 1), current_date, p_company_ids) c
  where c.review_status is null
    and c.reasons && array['Boven vaste prijs', 'Onder vaste prijs', 'Boven contractprijs', 'Onder contractprijs'];
$$;
grant execute on function public.agreed_price_deviations(integer, uuid[]) to authenticated;

create or replace function public.price_comparison(p_from date, p_to date, p_company_ids uuid[] default null::uuid[])
 returns table(row_id uuid, batch_id uuid, invoice_number text, invoice_date date, supplier_id uuid, supplier_name text, company_id uuid, product_id uuid, product_name text, article_number text, description text, packaging text, quantity numeric, invoice_price numeric, ref_price numeric, ref_source text, ref_date date, ref_after_invoice boolean, compare_basis text, diff_per_unit numeric, diff_pct numeric, impact numeric, priority integer, reasons text[], needs_check boolean, review_status text, review_note text)
 language sql
 stable
 set search_path to 'public'
as $function$
with s as (
  select
    coalesce(max(x.p1_amount), 100) as p1_amount,
    coalesce(max(x.p2_amount), 25)  as p2_amount,
    coalesce(max(x.p3_amount), 5)   as p3_amount,
    coalesce(max(x.p1_pct), 15)     as p1_pct,
    coalesce(max(x.p2_pct), 5)      as p2_pct,
    coalesce(max(x.p3_pct), 2)      as p3_pct,
    coalesce(max(x.repeat_count), 3) as repeat_count
  from public.price_comparison_settings x
  where x.group_id = public.current_user_group_id()
),
inv0 as (
  select
    r.id, r.batch_id, b.invoice_number, b.invoice_date, b.supplier_id, b.company_id,
    r.matched_product_id as product_id,
    r.article_number, r.description,
    coalesce(nullif(r.packaging_description, ''), r.raw->>'packagingDescription') as packaging,
    r.packaging_unit_count,
    public.normalize_article_number(r.article_number) as art_norm,
    lower(regexp_replace(coalesce(r.packaging_description, ''), '\s', '', 'g')) as pack_norm,
    nullif(r.raw->>'quantity', '')::numeric as raw_qty,
    nullif(r.raw->>'lineTotalExclVat', '')::numeric as line_total,
    coalesce(r.purchase_price, nullif(r.raw->>'unitPrice', '')::numeric) as unit_price,
    coalesce(r.raw->>'deliveryNote', '') as delivery_note,
    r.raw->>'deliveryDate' as delivery_date
  from public.price_import_rows r
  join public.price_import_batches b on b.id = r.batch_id
  where b.source_kind = 'factuur'
    and b.invoice_date between p_from and p_to
    and (p_company_ids is null or b.company_id is null or b.company_id = any(p_company_ids))
    and coalesce(r.status::text, '') <> 'niet_gematcht'
    and r.matched_product_id is not null
),
inv as (
  select
    i.id, i.batch_id, i.invoice_number, i.invoice_date, i.supplier_id, i.company_id,
    i.product_id, i.article_number, i.description, i.packaging, i.packaging_unit_count,
    i.art_norm, i.pack_norm,
    case
      when i.weighted then round(i.line_total / i.unit_price, 3)
      else i.raw_qty
    end as quantity,
    case
      when i.weighted then i.unit_price
      else coalesce(
        case when i.line_total is not null and i.raw_qty > 0
             then round(i.line_total / i.raw_qty, 4) end,
        i.unit_price)
    end as price,
    i.delivery_note, i.delivery_date
  from (
    select i0.*,
      (i0.line_total is not null and i0.raw_qty > 0 and i0.unit_price > 0
        and i0.line_total >= i0.unit_price * i0.raw_qty * 1.2) as weighted
    from inv0 i0
  ) i
),
pl as (
  select
    r.id, b.supplier_id, b.company_id, r.matched_product_id as product_id,
    public.normalize_article_number(r.article_number) as art_norm,
    lower(regexp_replace(coalesce(r.packaging_description, ''), '\s', '', 'g')) as pack_norm,
    r.packaging_unit_count, r.purchase_price as price,
    coalesce(b.price_date, b.created_at::date) as ref_date,
    b.price_valid_to as valid_to
  from public.price_import_rows r
  join public.price_import_batches b on b.id = r.batch_id
  where b.source_kind = 'prijslijst'
    and r.purchase_price > 0
),
matched as (
  select
    i.*,
    c.price as c_price, c.valid_from as c_date,
    p.price as p_price, p.ref_date as p_date, p.tier as p_tier,
    p.pack_norm as p_pack, p.packaging_unit_count as p_count,
    p.valid_to as p_valid_to,
    sup0.price_type
  from inv i
  left join public.suppliers sup0 on sup0.id = i.supplier_id
  left join lateral (
    select ct.price, ct.valid_from
    from public.supplier_contract_prices ct
    where ct.supplier_id = i.supplier_id
      and i.invoice_date >= ct.valid_from
      and (ct.valid_to is null or i.invoice_date <= ct.valid_to)
      and (ct.company_id is null or i.company_id is null or ct.company_id = i.company_id)
      and (
        (public.normalize_article_number(ct.article_number) is not null
          and public.normalize_article_number(ct.article_number) = i.art_norm)
        or (public.normalize_article_number(ct.article_number) is null
          and ct.product_id = i.product_id)
      )
    order by ct.valid_from desc
    limit 1
  ) c on true
  left join lateral (
    select x.price, x.ref_date, x.tier, x.pack_norm, x.packaging_unit_count, x.valid_to
    from (
      select pl.*,
        case
          when i.art_norm is not null and pl.art_norm = i.art_norm then 1
          when pl.product_id = i.product_id then 2
        end as tier
      from pl
      where pl.supplier_id = i.supplier_id
        and (pl.company_id is null or i.company_id is null or pl.company_id = i.company_id)
    ) x
    where x.tier is not null
    order by x.tier,
      (x.ref_date <= i.invoice_date) desc,
      case when x.ref_date <= i.invoice_date then x.ref_date end desc nulls last,
      x.ref_date asc
    limit 1
  ) p on true
  where i.price is not null
    and (c.price is not null or p.price is not null)
),
calc as (
  select
    m.*,
    case when m.c_price is not null then 'contract' else 'prijslijst' end as ref_source,
    case when m.c_price is not null then m.c_date else m.p_date end as ref_date,
    case
      when m.c_price is not null then 'verpakking'
      when m.p_tier = 1 then 'verpakking'
      when m.p_pack <> '' and m.p_pack = m.pack_norm then 'verpakking'
      when m.packaging_unit_count > 0 and m.p_count > 0 then 'basiseenheid'
      else null
    end as basis
  from matched m
),
calc2 as (
  select
    c.*,
    case
      when c.ref_source = 'contract' then c.c_price
      when c.basis = 'verpakking' then c.p_price
      when c.basis = 'basiseenheid' then round(c.p_price / c.p_count * c.packaging_unit_count, 4)
    end as ref_pack_price
  from calc c
),
calc3 as (
  select
    c.*,
    round(c.price - c.ref_pack_price, 4) as diff,
    case when c.ref_pack_price > 0
      then round((c.price - c.ref_pack_price) / c.ref_pack_price * 100, 2) end as pct,
    case
      when c.quantity is null then null
      when abs(c.price - c.ref_pack_price) < 0.005 then 0
      else round((c.price - c.ref_pack_price) * c.quantity, 2)
    end as amount,
    (c.ref_source = 'prijslijst' and c.p_tier = 2) as via_product,
    (c.ref_pack_price > 0 and (c.price / c.ref_pack_price > 2.5 or c.price / c.ref_pack_price < 0.4)) as extreme
  from calc2 c
  where c.ref_pack_price is not null
),
flags as (
  select
    c.*,
    exists (
      select 1 from inv o
      where o.supplier_id = c.supplier_id
        and o.batch_id <> c.batch_id
        and o.product_id = c.product_id
        and o.quantity is not distinct from c.quantity
        and c.delivery_date is not null
        and o.delivery_date = c.delivery_date
        and (c.delivery_note = '' or o.delivery_note = '' or o.delivery_note = c.delivery_note)
    ) as duplicate,
    count(*) filter (where c.diff > 0.005)
      over (partition by c.supplier_id, c.product_id) as pos_count
  from calc3 c
),
prio as (
  select
    f.*,
    s.*,
    case
      when abs(f.diff) < 0.005 then 5
      when f.duplicate then 1
      -- Vaste prijzen: elke afwijking melden.
      when f.price_type = 'vast' and f.diff > 0 then 1
      when f.price_type = 'vast' and f.ref_source = 'prijslijst'
           and f.p_valid_to is not null and f.invoice_date > f.p_valid_to then 2
      when f.price_type = 'vast' and f.diff < 0 then 3
      when f.ref_source = 'contract' and f.diff > 0 then 1
      when f.ref_source = 'contract' and f.diff < 0 then 3
      when f.diff < 0 then 4
      when coalesce(f.amount, 0) >= s.p1_amount or f.pct >= s.p1_pct then 1
      when coalesce(f.amount, 0) >= s.p2_amount or f.pct >= s.p2_pct then 2
      when coalesce(f.amount, 0) >= s.p3_amount or f.pct >= s.p3_pct then 3
      else 4
    end as base_prio
  from flags f cross join s
)
select
  p.id, p.batch_id, p.invoice_number, p.invoice_date, p.supplier_id, sup.name,
  p.company_id, p.product_id, prod.name,
  p.article_number, p.description, p.packaging, p.quantity,
  p.price, p.ref_pack_price, p.ref_source, p.ref_date,
  (p.ref_date > p.invoice_date), p.basis,
  p.diff, p.pct, p.amount,
  case
    when p.base_prio > 2 and p.diff > 0.005 and p.pos_count >= p.repeat_count then 2
    else p.base_prio
  end,
  array_remove(array[
    case when p.duplicate then 'Mogelijk dubbel gefactureerd' end,
    case when p.ref_source = 'contract' and p.diff > 0.005 then 'Boven contractprijs' end,
    case when p.ref_source = 'contract' and p.diff < -0.005 then 'Onder contractprijs' end,
    case when p.price_type = 'vast' and p.ref_source = 'prijslijst' and p.diff > 0.005 then 'Boven vaste prijs' end,
    case when p.price_type = 'vast' and p.ref_source = 'prijslijst' and p.diff < -0.005 then 'Onder vaste prijs' end,
    case when p.price_type = 'vast' and p.ref_source = 'prijslijst' and p.p_valid_to is not null
              and p.invoice_date > p.p_valid_to
         then 'Vaste prijslijst verlopen op ' || to_char(p.p_valid_to, 'DD-MM-YYYY') end,
    case when p.diff > 0.005 and coalesce(p.amount, 0) >= p.p1_amount then 'Grote financiële afwijking' end,
    case when p.diff > 0.005 and p.pct >= p.p1_pct then 'Prijsstijging boven ' || trim(to_char(p.p1_pct, 'FM999')) || '%' end,
    case when p.diff > 0.005 and p.pos_count >= p.repeat_count then 'Herhaaldelijk te duur (' || p.pos_count || '×)' end,
    case when p.extreme then 'Verschil extreem groot — verpakking of eenheid controleren' end,
    case when p.via_product then 'Gekoppeld via ingrediënt, niet via artikelnummer' end,
    case when p.basis = 'basiseenheid' then 'Omgerekend per kg/liter/stuk' end,
    case when p.ref_date > p.invoice_date then 'Prijslijst is van na de factuurdatum' end,
    case when p.quantity is null then 'Aantal onbekend' end
  ], null),
  (p.via_product or p.extreme or p.basis = 'basiseenheid'),
  rv.status, rv.note
from prio p
join public.suppliers sup on sup.id = p.supplier_id
left join public.products prod on prod.id = p.product_id
left join public.price_comparison_reviews rv on rv.row_id = p.id
$function$;

-- Dashboard: alarmen tellen afgesproken prijzen altijd mee.
create or replace function public.dashboard_price_changes(p_days integer DEFAULT 30, p_limit integer DEFAULT 10, p_direction text DEFAULT 'alle'::text)
 RETURNS TABLE(product_id uuid, product_name text, supplier_name text, old_price numeric, new_price numeric, difference_eur numeric, difference_pct numeric, changed_on date, above_alert boolean, price_row_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
  with threshold as (
    select coalesce(max(price_alert_threshold_pct), 10) as pct from public.groups
  ),
  changes as (
    select
      h.id as price_row_id,
      h.product_id,
      coalesce(nullif(p.custom_name, ''), p.name) as product_name,
      s.name as supplier_name,
      h.old_purchase_price as old_price,
      h.new_purchase_price as new_price,
      h.new_purchase_price - h.old_purchase_price as difference_eur,
      (h.new_purchase_price - h.old_purchase_price) / h.old_purchase_price * 100 as difference_pct,
      h.valid_from as changed_on,
      t.pct as alert_pct,
      (s.price_type = 'vast' or coalesce(h.is_contract_price, false)) as agreed,
      h.is_acknowledged as dismissed
    from public.price_change_history h
    join public.products p on p.id = h.product_id
    left join public.suppliers s on s.id = h.supplier_id
    cross join threshold t
    where h.old_purchase_price is not null
      and h.old_purchase_price > 0
      and h.valid_from >= current_date - greatest(p_days, 1)
  ),
  flagged as (
    select c.*,
      ((abs(c.difference_pct) >= c.alert_pct
        or (coalesce(c.agreed, false) and abs(c.difference_eur) >= 0.005))
       and not c.dismissed) as is_alert
    from changes c
  )
  select
    product_id, product_name, supplier_name, old_price, new_price,
    round(difference_eur, 4), round(difference_pct, 2), changed_on,
    is_alert,
    price_row_id
  from flagged
  where (p_direction = 'alle')
     or (p_direction = 'stijging' and difference_pct > 0)
     or (p_direction = 'daling' and difference_pct < 0)
  order by is_alert desc, abs(difference_pct) desc
  limit greatest(p_limit, 1);
$function$;

create or replace function public.dashboard_summary_scoped(p_company_id uuid DEFAULT NULL::uuid, p_only_current boolean DEFAULT false)
 RETURNS TABLE(price_alerts integer, cost_problems integer, unmatched_ingredients integer, invoices_to_check integer, upcoming_menus integer, flagged_prices integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with threshold as (
    select coalesce(max(price_alert_threshold_pct), 10) as pct from public.groups
  ),
  cur_r as (select recipe_id from public.current_recipe_ids() where p_only_current),
  cur_p as (select product_id from public.current_product_ids() where p_only_current)
  select
    (select count(*)::integer
       from public.price_change_history h
       left join public.suppliers s on s.id = h.supplier_id
       cross join threshold t
      where h.old_purchase_price is not null
        and h.old_purchase_price > 0
        and h.valid_from >= current_date - 30
        and (abs((h.new_purchase_price - h.old_purchase_price) / h.old_purchase_price * 100) >= t.pct
             or ((s.price_type = 'vast' or coalesce(h.is_contract_price, false))
                 and abs(h.new_purchase_price - h.old_purchase_price) >= 0.005))
        and not h.is_acknowledged
        and (not p_only_current or h.product_id in (select product_id from cur_p)))
    +
    (select count(*)::integer
       from public.agreed_price_deviations(30, case when p_company_id is null then null else array[p_company_id] end) d
      where (not p_only_current or d.product_id in (select product_id from cur_p))),
    (select count(*)::integer
       from public.recipes r
      where r.recipe_kind = 'gerecht'
        and r.status = 'goedgekeurd'
        and r.sales_price is not null
        and r.sales_price > 0
        and (not p_only_current or r.id in (select recipe_id from cur_r))
        and coalesce(public.calculate_recipe_cost(r.id, p_company_id), 0) >
            (r.sales_price / (1 + coalesce(r.vat_rate, 9) / 100)) * 0.33),
    (select count(distinct ri.unmatched_name)::integer
       from public.recipe_ingredients ri
      where ri.unmatched_name is not null
        and (not p_only_current or ri.recipe_id in (select recipe_id from cur_r))),
    (select count(*)::integer from public.price_import_batches
      where source_kind = 'factuur' and status = 'wacht_op_controle')
    +
    (select count(*)::integer from public.inbound_invoice_queue
      where status in ('wacht_op_leverancier', 'fout')
        and resulting_batch_id is null),
    (select count(*)::integer from public.event_menus
      where service_date >= current_date
        and status in ('concept', 'definitief')),
    (select count(*)::integer from public.supplier_products sp
      where sp.flagged_for_review and sp.valid_to is null
        and (not p_only_current or sp.product_id in (select product_id from cur_p)));
$function$;

-- Ingrediëntenlijst: vorige prijs weer altijd tonen (ontwikkeling).
create or replace function public.search_products_overview(p_company_id uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_only_active boolean DEFAULT false)
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
    -- Geaccepteerde wijziging (nieuwe standaard): geen pijltje meer.
    select h.old_purchase_price
    from public.price_change_history h
    where h.product_id = pg.id and h.old_purchase_price is not null
    order by h.valid_from desc
    limit 1
  ) prev on true
  order by pg.is_favorite desc, pg.name;
$function$;

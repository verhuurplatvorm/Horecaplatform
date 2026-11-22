-- 0147: Prijsvergelijking — referentie zichtbaar, regels zonder referentieprijs.
--
-- * Nieuwe parameter p_include_unreferenced (standaard false): de pagina
--   Prijsvergelijking krijgt ook factuurregels zonder bruikbare
--   referentieprijs terug (ref_source = 'geen', ref_price/verschil/impact
--   null, prioriteit 4). Dashboard, factuurcontrole en prijsalarmen roepen
--   de functie zonder deze parameter aan en zien dus precies hetzelfde als
--   voorheen.
-- * Extra kolommen: ref_valid_to (t/m wanneer de referentie geldt),
--   ref_packaging (verpakking van de referentie) en article_key
--   (genormaliseerd artikelnummer, voor het bundelen van afwijkingen).
-- * Contractprijs: een geldige contractprijs blijft vóór de prijslijst gaan;
--   bij meerdere geldige contracten gaat het bedrijfsspecifieke contract
--   vóór het groepsbrede, daarna de laatst ingegane.
--
-- Verder ongewijzigd t.o.v. 0145.

drop function if exists public.price_comparison(date, date, uuid[]);

create function public.price_comparison(p_from date, p_to date, p_company_ids uuid[] default null::uuid[], p_include_unreferenced boolean default false)
 returns table(row_id uuid, batch_id uuid, invoice_number text, invoice_date date, supplier_id uuid, supplier_name text, company_id uuid, product_id uuid, product_name text, article_number text, description text, packaging text, quantity numeric, invoice_price numeric, ref_price numeric, ref_source text, ref_date date, ref_after_invoice boolean, compare_basis text, diff_per_unit numeric, diff_pct numeric, impact numeric, priority integer, reasons text[], needs_check boolean, review_status text, review_note text, ref_valid_to date, ref_packaging text, article_key text)
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
    r.packaging_description as packaging_raw,
    coalesce(b.price_date, b.created_at::date) as ref_date,
    b.price_valid_to as valid_to,
    (b.accepted_at is not null) as accepted
  from public.price_import_rows r
  join public.price_import_batches b on b.id = r.batch_id
  where b.source_kind = 'prijslijst'
    and r.purchase_price > 0
),
matched as (
  select
    i.*,
    c.price as c_price, c.valid_from as c_date, c.valid_to as c_valid_to,
    c.packaging_description as c_pack_raw, p.packaging_raw as p_pack_raw,
    p.price as p_price, p.ref_date as p_date, p.tier as p_tier,
    p.pack_norm as p_pack, p.packaging_unit_count as p_count,
    p.valid_to as p_valid_to,
    sup0.price_type,
    nxt.ref_date as conform_date
  from inv i
  left join public.suppliers sup0 on sup0.id = i.supplier_id
  left join lateral (
    select ct.price, ct.valid_from, ct.valid_to, ct.packaging_description
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
    order by (ct.company_id is not null) desc, ct.valid_from desc
    limit 1
  ) c on true
  left join lateral (
    select x.price, x.ref_date, x.tier, x.pack_norm, x.packaging_unit_count, x.valid_to, x.packaging_raw
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
  -- Nieuwere, geaccepteerde prijslijst met precies deze factuurprijs: de
  -- factuur volgde al de nieuwe standaard -> conform, geen melding.
  left join lateral (
    select pl2.ref_date
    from pl pl2
    where pl2.supplier_id = i.supplier_id
      and pl2.accepted
      and pl2.ref_date > coalesce(p.ref_date, date '1900-01-01')
      and (pl2.company_id is null or i.company_id is null or pl2.company_id = i.company_id)
      and ((i.art_norm is not null and pl2.art_norm = i.art_norm) or pl2.product_id = i.product_id)
      and abs(pl2.price - i.price) < 0.005
    order by pl2.ref_date desc
    limit 1
  ) nxt on true
  where i.price is not null
    and (p_include_unreferenced or c.price is not null or p.price is not null)
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
  where c.ref_pack_price is not null or p_include_unreferenced
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
      when f.ref_pack_price is null then 4
      when abs(f.diff) < 0.005 then 5
      when f.duplicate then 1
      when f.conform_date is not null then 5
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
  p.price, p.ref_pack_price,
  case when p.ref_pack_price is null then 'geen' else p.ref_source end,
  case when p.ref_pack_price is null then null else p.ref_date end,
  (p.ref_pack_price is not null and p.ref_date > p.invoice_date), p.basis,
  p.diff, p.pct, p.amount,
  case
    when p.base_prio > 2 and p.base_prio < 5 and p.diff > 0.005 and p.pos_count >= p.repeat_count then 2
    else p.base_prio
  end,
  case when p.ref_pack_price is null then array[
    case when p.p_price is not null
      then 'Prijslijstprijs gevonden, maar verpakking niet vergelijkbaar'
      else 'Geen contract- of prijslijstprijs' end]
  when p.conform_date is not null and not p.duplicate
    then array['Conform nieuwe prijslijst van ' || to_char(p.conform_date, 'DD-MM-YYYY')]
  else array_remove(array[
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
  ], null) end,
  (p.ref_pack_price is not null and (p.via_product or p.extreme or p.basis = 'basiseenheid')),
  rv.status, rv.note,
  case when p.ref_pack_price is null then null
       when p.ref_source = 'contract' then p.c_valid_to else p.p_valid_to end,
  case when p.ref_pack_price is null then null
       when p.ref_source = 'contract' then p.c_pack_raw else p.p_pack_raw end,
  p.art_norm
from prio p
join public.suppliers sup on sup.id = p.supplier_id
left join public.products prod on prod.id = p.product_id
left join public.price_comparison_reviews rv on rv.row_id = p.id
$function$;

grant execute on function public.price_comparison(date, date, uuid[], boolean) to authenticated;

comment on function public.price_comparison(date, date, uuid[], boolean) is
  'Factuurregels vergeleken met contractprijs (voorrang) of prijslijst. p_include_unreferenced = ook regels zonder referentieprijs (ref_source geen).';

-- Contractprijzen: overlappende geldigheidsperiodes (voor de import-voorvertoning
-- en het overzicht). Twee contracten overlappen als leverancier, bedrijf
-- (of groepsbreed), artikelnummer/ingrediënt en verpakking gelijk zijn en de
-- periodes elkaar raken.
create or replace function public.contract_price_overlaps()
returns table(id uuid, other_id uuid)
language sql
stable
set search_path to 'public'
as $$
  select a.id, b.id
  from public.supplier_contract_prices a
  join public.supplier_contract_prices b
    on b.id <> a.id
   and b.supplier_id = a.supplier_id
   and b.company_id is not distinct from a.company_id
   and lower(regexp_replace(coalesce(b.packaging_description, ''), '\s', '', 'g'))
     = lower(regexp_replace(coalesce(a.packaging_description, ''), '\s', '', 'g'))
   and (
     (public.normalize_article_number(a.article_number) is not null
       and public.normalize_article_number(b.article_number) = public.normalize_article_number(a.article_number))
     or (public.normalize_article_number(a.article_number) is null
       and public.normalize_article_number(b.article_number) is null
       and b.product_id = a.product_id)
   )
   and a.valid_from <= coalesce(b.valid_to, 'infinity'::date)
   and b.valid_from <= coalesce(a.valid_to, 'infinity'::date);
$$;

grant execute on function public.contract_price_overlaps() to authenticated;

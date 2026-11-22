-- 0142: Nieuwe prijslijst = nieuwe standaard. Dagprijzen of vaste prijzen.
--
-- 1. Per leverancier: price_type 'dag' (dagprijzen) of 'vast' (vaste
--    prijzen, bv. Horesca). Leeg = niet ingesteld: alles werkt als voorheen.
-- 2. Prijslijst accepteren als nieuwe standaard: de prijshistorie blijft
--    staan, maar de wijzigingen gelden niet meer als waarschuwing (dashboard,
--    prijsalarmen, pijltjes bij ingrediënten en recepten). Gebruikt de
--    bestaande tabel dismissed_price_alerts (0087).
-- 3. Vaste prijzen: een prijslijst geldt voor een periode (price_date t/m
--    price_valid_to). In de prijscontrole van facturen wordt elke afwijking
--    gemeld; bij dagprijzen is een afwijking normaal en geen waarschuwing.

-- 1. Leverancier: dagprijzen of vaste prijzen ------------------------------
alter table public.suppliers
  add column if not exists price_type text;
alter table public.suppliers drop constraint if exists suppliers_price_type_check;
alter table public.suppliers
  add constraint suppliers_price_type_check check (price_type is null or price_type in ('dag', 'vast'));
comment on column public.suppliers.price_type is
  'dag = dagprijzen (afwijking op factuur is normaal), vast = vaste prijzen per periode (elke afwijking melden). Leeg = niet ingesteld.';

-- 2. Prijslijst: geldigheidsperiode en acceptatie --------------------------
alter table public.price_import_batches
  add column if not exists price_valid_to date,
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by uuid references auth.users(id) on delete set null;
comment on column public.price_import_batches.price_valid_to is
  'Vaste prijzen: laatste dag dat deze prijslijst geldt (vanaf = price_date).';
comment on column public.price_import_batches.accepted_at is
  'Prijslijst geaccepteerd als nieuwe standaard: wijzigingen staan in de historie maar geven geen waarschuwing meer.';

alter table public.dismissed_price_alerts
  add column if not exists reason text,
  add column if not exists batch_id uuid references public.price_import_batches(id) on delete set null;

-- Prijshistorie: + is_acknowledged (wijziging is afgehandeld / nieuwe standaard).
create or replace view public.price_change_history as
 SELECT curr.id,
    curr.product_id,
    curr.supplier_id,
    curr.company_id,
    curr.purchase_price AS new_purchase_price,
    curr.packaging_description AS new_packaging_description,
    curr.packaging_unit_count AS new_packaging_unit_count,
    curr.price_per_base_unit AS new_price_per_base_unit,
    curr.valid_from,
    curr.change_reason,
    curr.is_contract_price,
    prev.purchase_price AS old_purchase_price,
    prev.packaging_description AS old_packaging_description,
    prev.packaging_unit_count AS old_packaging_unit_count,
    prev.price_per_base_unit AS old_price_per_base_unit,
    exists (select 1 from public.dismissed_price_alerts d where d.supplier_product_id = curr.id) AS is_acknowledged
   FROM (supplier_products curr
     LEFT JOIN LATERAL ( SELECT sp.purchase_price,
            sp.packaging_description,
            sp.packaging_unit_count,
            sp.price_per_base_unit
           FROM supplier_products sp
          WHERE ((sp.supplier_id = curr.supplier_id) AND (sp.product_id = curr.product_id) AND (NOT (sp.company_id IS DISTINCT FROM curr.company_id)) AND (sp.valid_to = (curr.valid_from - '1 day'::interval)))
          ORDER BY sp.created_at DESC, sp.id DESC
         LIMIT 1) prev ON (true));

-- Overzicht van een prijslijst: wat is hoger, lager, gelijk of nieuw.
create or replace function public.price_import_batch_changes(p_batch_id uuid)
returns table(
  row_id uuid, product_id uuid, product_name text, article_number text,
  old_price numeric, new_price numeric, diff numeric, diff_pct numeric,
  change_kind text, valid_from date
)
language sql
stable
set search_path to 'public'
as $$
  select
    r.id,
    r.matched_product_id,
    coalesce(nullif(p.custom_name, ''), p.name, r.description),
    r.article_number,
    coalesce(oud.purchase_price, case when r.status = 'ongewijzigd' then r.purchase_price end),
    coalesce(nieuw.purchase_price, r.purchase_price),
    case when oud.purchase_price is not null and nieuw.purchase_price is not null
         then round(nieuw.purchase_price - oud.purchase_price, 4) end,
    case when oud.purchase_price > 0 and nieuw.purchase_price is not null
         then round((nieuw.purchase_price - oud.purchase_price) / oud.purchase_price * 100, 2) end,
    case
      when r.status = 'ongewijzigd' then 'gelijk'
      when oud.purchase_price is null then 'nieuw'
      when nieuw.purchase_price > oud.purchase_price then 'hoger'
      when nieuw.purchase_price < oud.purchase_price then 'lager'
      else 'gelijk'
    end,
    nieuw.valid_from
  from public.price_import_rows r
  left join public.products p on p.id = r.matched_product_id
  left join public.supplier_products nieuw on nieuw.id = r.resulting_supplier_product_id
  left join public.supplier_products oud on oud.id = r.reopened_supplier_product_id
  where r.batch_id = p_batch_id
    and r.matched_product_id is not null
    and (r.status = 'ongewijzigd' or (r.status = 'toegepast' and r.resulting_supplier_product_id is not null));
$$;
grant execute on function public.price_import_batch_changes(uuid) to authenticated;

-- Prijslijst accepteren als nieuwe standaard. Alle doorgevoerde prijzen van
-- deze lijst (en eerdere, nog openstaande wijzigingen van dezelfde
-- leverancier voor dezelfde ingrediënten) gelden daarna niet meer als
-- waarschuwing. De historie zelf blijft ongewijzigd.
create or replace function public.accept_price_import_batch(p_batch_id uuid)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  v_batch record;
  v_count integer;
begin
  select id, group_id, supplier_id, company_id, source_kind
  into v_batch
  from public.price_import_batches
  where id = p_batch_id;
  if not found then
    raise exception 'Prijslijst niet gevonden.';
  end if;

  with nieuw as (
    select sp.id, sp.product_id, sp.valid_from
    from public.price_import_rows r
    join public.supplier_products sp on sp.id = r.resulting_supplier_product_id
    where r.batch_id = p_batch_id and r.status = 'toegepast'
  ),
  te_accepteren as (
    select n.id from nieuw n
    union
    select sp.id
    from nieuw n
    join public.supplier_products sp
      on sp.product_id = n.product_id
     and sp.supplier_id = v_batch.supplier_id
     and sp.company_id is not distinct from v_batch.company_id
     and sp.valid_from <= n.valid_from
  ),
  ins as (
    insert into public.dismissed_price_alerts (supplier_product_id, group_id, reason, batch_id)
    select t.id, v_batch.group_id, 'prijslijst_geaccepteerd', p_batch_id
    from te_accepteren t
    on conflict (supplier_product_id) do nothing
    returning 1
  )
  select count(*) into v_count from ins;

  update public.price_import_batches
     set accepted_at = now(), accepted_by = auth.uid()
   where id = p_batch_id;

  return v_count;
end;
$$;
grant execute on function public.accept_price_import_batch(uuid) to authenticated;

-- 3. Ingrediëntenlijst: geen pijltje bij een geaccepteerde wijziging -------
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
    select case when h.is_acknowledged then null else h.old_purchase_price end as old_purchase_price
    from public.price_change_history h
    where h.product_id = pg.id and h.old_purchase_price is not null
    order by h.valid_from desc
    limit 1
  ) prev on true
  order by pg.is_favorite desc, pg.name;
$function$;
grant execute on function public.search_products_overview(uuid, text, integer, integer, boolean) to authenticated;


-- 4. Prijscontrole facturen: dagprijzen vs vaste prijzen -------------------
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
      -- Dagprijzen: een andere prijs dan de lijst is normaal.
      when f.price_type = 'dag' then 4
      -- Vaste prijzen: elke afwijking melden.
      when f.price_type = 'vast' and f.diff > 0 then 1
      when f.price_type = 'vast' and f.ref_source = 'prijslijst'
           and f.p_valid_to is not null and f.invoice_date > f.p_valid_to then 2
      when f.price_type = 'vast' and f.diff < 0 then 3
      when f.ref_source = 'contract' and f.diff > 0 then 1
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
    when p.base_prio > 2 and p.diff > 0.005 and p.pos_count >= p.repeat_count
         and p.price_type is distinct from 'dag' then 2
    else p.base_prio
  end,
  array_remove(array[
    case when p.duplicate then 'Mogelijk dubbel gefactureerd' end,
    case when p.ref_source = 'contract' and p.diff > 0.005 then 'Boven contractprijs' end,
    case when p.price_type = 'vast' and p.ref_source = 'prijslijst' and p.diff > 0.005 then 'Boven vaste prijs' end,
    case when p.price_type = 'vast' and p.ref_source = 'prijslijst' and p.diff < -0.005 then 'Onder vaste prijs' end,
    case when p.price_type = 'vast' and p.ref_source = 'prijslijst' and p.p_valid_to is not null
              and p.invoice_date > p.p_valid_to
         then 'Vaste prijslijst verlopen op ' || to_char(p.p_valid_to, 'DD-MM-YYYY') end,
    case when p.price_type = 'dag' and abs(p.diff) > 0.005 then 'Dagprijs — afwijking is normaal' end,
    case when p.price_type is distinct from 'dag' and p.diff > 0.005 and coalesce(p.amount, 0) >= p.p1_amount then 'Grote financiële afwijking' end,
    case when p.price_type is distinct from 'dag' and p.diff > 0.005 and p.pct >= p.p1_pct then 'Prijsstijging boven ' || trim(to_char(p.p1_pct, 'FM999')) || '%' end,
    case when p.price_type is distinct from 'dag' and p.diff > 0.005 and p.pos_count >= p.repeat_count then 'Herhaaldelijk te duur (' || p.pos_count || '×)' end,
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

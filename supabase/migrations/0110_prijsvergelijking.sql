-- 0110_prijsvergelijking.sql
--
-- Prijsvergelijking: factuurprijzen naast referentieprijzen (contract of
-- prijslijst/webshop) leggen en de financiële afwijking berekenen.
--
-- Uitgangspunten
-- * Alleen-lezen ten opzichte van bestaande prijzen: deze migratie past geen
--   inkoop- of verkoopprijzen aan en verwijdert niets. Volledig additief.
-- * Referentieprijzen zijn historisch: elke prijslijst-import blijft bewaard
--   met een prijsdatum. Een nieuwe prijslijst verandert oude vergelijkingen
--   niet, omdat per factuur de prijs geldt die op de factuurdatum gold.
-- * Vergelijken gebeurt bij voorkeur per verpakking op hetzelfde
--   artikelnummer. Het veld "stuks in verpakking" is op facturen niet altijd
--   betrouwbaar (bv. 3,3 vs 3300), dus omrekenen per basiseenheid gebeurt
--   alleen als terugval en zo'n regel krijgt altijd "Controle nodig".

-- 1. Prijsdatum van een prijslijst/webshop-import (standaard de importdatum).
alter table public.price_import_batches
  add column if not exists price_date date;

comment on column public.price_import_batches.price_date is
  'Datum vanaf wanneer deze prijslijst geldt. Leeg = importdatum. Gebruikt door de prijsvergelijking.';

-- 2. Contractprijzen (per verpakking, zoals op de factuur).
create table if not exists public.supplier_contract_prices (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid not null default public.current_user_group_id()
                          references public.groups(id) on delete cascade,
  supplier_id           uuid not null references public.suppliers(id) on delete cascade,
  product_id            uuid references public.products(id) on delete set null,
  company_id            uuid references public.companies(id) on delete cascade,
  article_number        text,
  description           text,
  packaging_description text,
  price                 numeric(12,4) not null check (price > 0),
  valid_from            date not null default current_date,
  valid_to              date,
  note                  text,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (product_id is not null or nullif(trim(article_number), '') is not null),
  check (valid_to is null or valid_to >= valid_from)
);

create index if not exists supplier_contract_prices_supplier_idx
  on public.supplier_contract_prices (supplier_id, product_id);

alter table public.supplier_contract_prices enable row level security;

create policy supplier_contract_prices_select on public.supplier_contract_prices
  for select using (
    (company_id is null and group_id = public.current_user_group_id())
    or public.has_company_access(company_id)
  );

create policy supplier_contract_prices_write on public.supplier_contract_prices
  for all using (
    (company_id is null and group_id = public.current_user_group_id() and public.is_group_admin())
    or public.has_company_access(company_id)
  ) with check (
    (company_id is null and group_id = public.current_user_group_id() and public.is_group_admin())
    or public.has_company_access(company_id)
  );

comment on table public.supplier_contract_prices is
  'Afgesproken contractprijzen per verpakking. Gaan in de prijsvergelijking vóór prijslijst/webshopprijzen.';

-- 3. Beoordeling van een vergeleken factuurregel (Accepteren / Betwisten).
create table if not exists public.price_comparison_reviews (
  row_id       uuid primary key references public.price_import_rows(id) on delete cascade,
  group_id     uuid not null default public.current_user_group_id()
                 references public.groups(id) on delete cascade,
  status       text not null check (status in ('geaccepteerd', 'betwist')),
  note         text,
  reviewed_by  uuid default auth.uid(),
  reviewed_at  timestamptz not null default now()
);

alter table public.price_comparison_reviews enable row level security;

create policy price_comparison_reviews_all on public.price_comparison_reviews
  for all using (group_id = public.current_user_group_id())
  with check (group_id = public.current_user_group_id());

-- 4. Instelbare grenzen voor de prioriteiten (per groep).
create table if not exists public.price_comparison_settings (
  group_id       uuid primary key default public.current_user_group_id()
                   references public.groups(id) on delete cascade,
  p1_amount      numeric not null default 100,
  p2_amount      numeric not null default 25,
  p3_amount      numeric not null default 5,
  p1_pct         numeric not null default 15,
  p2_pct         numeric not null default 5,
  p3_pct         numeric not null default 2,
  repeat_count   integer not null default 3,
  updated_at     timestamptz not null default now()
);

alter table public.price_comparison_settings enable row level security;

create policy price_comparison_settings_select on public.price_comparison_settings
  for select using (group_id = public.current_user_group_id());

create policy price_comparison_settings_write on public.price_comparison_settings
  for all using (group_id = public.current_user_group_id() and public.is_group_admin())
  with check (group_id = public.current_user_group_id() and public.is_group_admin());

-- 5. Hulpfunctie: artikelnummer vergelijkbaar maken.
create or replace function public.normalize_article_number(p text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(regexp_replace(coalesce(p, ''), '\s', '', 'g')), '^0+', ''), '')
$$;

-- 6. De vergelijking zelf.
create or replace function public.price_comparison(
  p_from date,
  p_to date,
  p_company_ids uuid[] default null
)
returns table (
  row_id            uuid,
  batch_id          uuid,
  invoice_number    text,
  invoice_date      date,
  supplier_id       uuid,
  supplier_name     text,
  company_id        uuid,
  product_id        uuid,
  product_name      text,
  article_number    text,
  description       text,
  packaging         text,
  quantity          numeric,
  invoice_price     numeric,
  ref_price         numeric,
  ref_source        text,
  ref_date          date,
  ref_after_invoice boolean,
  compare_basis     text,
  diff_per_unit     numeric,
  diff_pct          numeric,
  impact            numeric,
  priority          integer,
  reasons           text[],
  needs_check       boolean,
  review_status     text,
  review_note       text
)
language sql
stable
set search_path = public
as $$
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
inv as (
  select
    r.id, r.batch_id, b.invoice_number, b.invoice_date, b.supplier_id, b.company_id,
    r.matched_product_id as product_id,
    r.article_number, r.description,
    coalesce(nullif(r.packaging_description, ''), r.raw->>'packagingDescription') as packaging,
    r.packaging_unit_count,
    public.normalize_article_number(r.article_number) as art_norm,
    lower(regexp_replace(coalesce(r.packaging_description, ''), '\s', '', 'g')) as pack_norm,
    nullif(r.raw->>'quantity', '')::numeric as quantity,
    -- Effectieve prijs per eenheid op de factuur: regeltotaal / aantal
    -- (verwerkt korting), anders de stukprijs.
    coalesce(
      case
        when nullif(r.raw->>'lineTotalExclVat', '') is not null
         and nullif(r.raw->>'quantity', '')::numeric > 0
        then round((r.raw->>'lineTotalExclVat')::numeric / (r.raw->>'quantity')::numeric, 4)
      end,
      r.purchase_price,
      nullif(r.raw->>'unitPrice', '')::numeric
    ) as price,
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
pl as (
  select
    r.id, b.supplier_id, b.company_id, r.matched_product_id as product_id,
    public.normalize_article_number(r.article_number) as art_norm,
    lower(regexp_replace(coalesce(r.packaging_description, ''), '\s', '', 'g')) as pack_norm,
    r.packaging_unit_count, r.purchase_price as price,
    coalesce(b.price_date, b.created_at::date) as ref_date
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
    p.pack_norm as p_pack, p.packaging_unit_count as p_count
  from inv i
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
    select x.price, x.ref_date, x.tier, x.pack_norm, x.packaging_unit_count
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
    case when c.quantity is not null
      then round((c.price - c.ref_pack_price) * c.quantity, 2) end as amount,
    (c.ref_source = 'prijslijst' and c.p_tier = 2) as via_product,
    (c.ref_pack_price > 0 and (c.price / c.ref_pack_price > 2.5 or c.price / c.ref_pack_price < 0.4)) as extreme
  from calc2 c
  where c.ref_pack_price is not null
),
flags as (
  select
    c.*,
    -- Mogelijke dubbele facturatie: zelfde leverbon/leverdatum, artikel en
    -- aantal op een andere factuur van dezelfde leverancier.
    exists (
      select 1 from inv o
      where o.supplier_id = c.supplier_id
        and o.batch_id <> c.batch_id
        and o.product_id = c.product_id
        and o.quantity is not distinct from c.quantity
        and (
          (c.delivery_note <> '' and o.delivery_note = c.delivery_note)
          or (c.delivery_note = '' and c.delivery_date is not null and o.delivery_date = c.delivery_date)
        )
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
    when p.base_prio > 2 and p.diff > 0.005 and p.pos_count >= p.repeat_count then 2
    else p.base_prio
  end,
  array_remove(array[
    case when p.duplicate then 'Mogelijk dubbel gefactureerd' end,
    case when p.ref_source = 'contract' and p.diff > 0.005 then 'Boven contractprijs' end,
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
$$;

comment on function public.price_comparison(date, date, uuid[]) is
  'Vergelijkt factuurregels met de contract- of prijslijstprijs die gold op de factuurdatum en bepaalt prioriteit 1-5. Alleen lezen.';

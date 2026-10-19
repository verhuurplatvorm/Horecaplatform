-- 0087_prijsalarm_verwijderen.sql
--
-- Een prijsalarm kan onterecht zijn (bv. met een verkeerd gewicht gerekend).
-- Dan moet je het kunnen verwijderen. De prijshistorie zelf blijft
-- ongemoeid: we onthouden alleen welke prijsregel als "afgehandeld" is
-- gemarkeerd, en het alarm verdwijnt uit het dashboard en de teller.
-- Additief en idempotent.

create table if not exists public.dismissed_price_alerts (
  supplier_product_id uuid primary key references public.supplier_products(id) on delete cascade,
  group_id            uuid not null default public.current_user_group_id()
                        references public.groups(id) on delete cascade,
  dismissed_by        uuid default auth.uid(),
  dismissed_at        timestamptz not null default now()
);

alter table public.dismissed_price_alerts enable row level security;

drop policy if exists dismissed_price_alerts_all on public.dismissed_price_alerts;
create policy dismissed_price_alerts_all on public.dismissed_price_alerts
  for all using (group_id = public.current_user_group_id())
  with check (group_id = public.current_user_group_id());

comment on table public.dismissed_price_alerts is
  'Prijsalarmen die de gebruiker heeft weggehaald (bv. onterecht door verkeerd gewicht). De prijshistorie blijft staan; alleen het alarm verdwijnt.';

-- Dashboardteller: wegbewaarde alarmen tellen niet mee.
create or replace function public.dashboard_summary(p_company_id uuid default null)
returns table (
  price_alerts integer,
  cost_problems integer,
  unmatched_ingredients integer,
  invoices_to_check integer,
  upcoming_menus integer,
  flagged_prices integer,
  recipe_count integer,
  halfproduct_count integer,
  product_count integer,
  supplier_count integer,
  menu_count integer,
  menu_card_count integer
)
language sql
stable
as $$
  with threshold as (
    select coalesce(max(price_alert_threshold_pct), 10) as pct from public.groups
  )
  select
    (select count(*)::integer
     from public.price_change_history h, threshold t
     where h.old_purchase_price is not null
       and h.old_purchase_price > 0
       and h.valid_from >= current_date - 30
       and abs((h.new_purchase_price - h.old_purchase_price) / h.old_purchase_price * 100) >= t.pct
       and not exists (select 1 from public.dismissed_price_alerts d where d.supplier_product_id = h.id)
    ),
    (select count(*)::integer
     from public.recipes r
     where r.recipe_kind = 'gerecht'
       and r.status = 'goedgekeurd'
       and r.sales_price is not null
       and r.sales_price > 0
       and coalesce(public.calculate_recipe_cost(r.id, p_company_id), 0) >
           (r.sales_price / (1 + coalesce(r.vat_rate, 9) / 100)) * 0.33
    ),
    (select count(distinct ri.unmatched_name)::integer
     from public.recipe_ingredients ri
     where ri.unmatched_name is not null
    ),
    (select count(*)::integer from public.price_import_batches
       where source_kind = 'factuur' and status = 'wacht_op_controle')
    +
    (select count(*)::integer from public.inbound_invoice_queue
       where status in ('wacht_op_leverancier', 'fout', 'dubbele_factuur')
         and resulting_batch_id is null
    ),
    (select count(*)::integer from public.event_menus
     where service_date >= current_date
       and status in ('concept', 'definitief')
    ),
    (select count(*)::integer from public.supplier_products
     where flagged_for_review and valid_to is null
    ),
    (select count(*)::integer from public.recipes where recipe_kind = 'gerecht'),
    (select count(*)::integer from public.recipes where recipe_kind = 'halfproduct'),
    (select count(*)::integer from public.products where is_active),
    (select count(*)::integer from public.suppliers),
    (select count(*)::integer from public.event_menus),
    (select count(*)::integer from public.menu_cards);
$$;

-- Prijswijzigingen: nu met het id van de prijsregel (om het alarm weg te
-- kunnen halen) en zonder alarmmarkering voor weggehaalde alarmen.
drop function if exists public.dashboard_price_changes(integer, integer, text);

create or replace function public.dashboard_price_changes(
  p_days integer default 30,
  p_limit integer default 10,
  p_direction text default 'alle'
)
returns table (
  product_id uuid,
  product_name text,
  supplier_name text,
  old_price numeric,
  new_price numeric,
  difference_eur numeric,
  difference_pct numeric,
  changed_on date,
  above_alert boolean,
  price_row_id uuid
)
language sql
stable
as $$
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
      exists (select 1 from public.dismissed_price_alerts d where d.supplier_product_id = h.id) as dismissed
    from public.price_change_history h
    join public.products p on p.id = h.product_id
    left join public.suppliers s on s.id = h.supplier_id
    cross join threshold t
    where h.old_purchase_price is not null
      and h.old_purchase_price > 0
      and h.valid_from >= current_date - greatest(p_days, 1)
  )
  select
    product_id, product_name, supplier_name, old_price, new_price,
    round(difference_eur, 4), round(difference_pct, 2), changed_on,
    (abs(difference_pct) >= alert_pct and not dismissed),
    price_row_id
  from changes
  where (p_direction = 'alle')
     or (p_direction = 'stijging' and difference_pct > 0)
     or (p_direction = 'daling' and difference_pct < 0)
  order by
    (abs(difference_pct) >= alert_pct and not dismissed) desc,
    abs(difference_pct) desc
  limit greatest(p_limit, 1);
$$;

comment on function public.dashboard_price_changes(integer, integer, text) is
  'Prijswijzigingen over een periode, grootste afwijking eerst en alarmregels bovenaan; weggehaalde alarmen (dismissed_price_alerts) krijgen geen alarmmarkering meer.';

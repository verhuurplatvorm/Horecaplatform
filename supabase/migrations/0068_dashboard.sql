-- 0068_dashboard.sql
--
-- Gegevens voor het dashboard. Vat uitsluitend bestaande gegevens samen —
-- er wordt geen nieuwe administratie bijgehouden en niets gedupliceerd:
--   prijswijzigingen  -> public.price_change_history
--   prijsalarm        -> groups.price_alert_threshold_pct (0061)
--   kostprijs/marge   -> public.calculate_recipe_cost
--   niet herkend      -> recipe_ingredients.unmatched_name (0045)
--                        + supplier_products.flagged_for_review (0047)
--   facturen          -> public.inbound_invoice_queue / price_import_batches
--   menu's            -> public.event_menus
--
-- Voorraad komt hier bewust niet in voor.

-- ---------------------------------------------------------------------
-- 1. Managementsamenvatting: alleen tellingen, dus snel.
-- ---------------------------------------------------------------------
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
    -- Prijswijzigingen van de afgelopen 30 dagen boven de alarmgrens.
    (select count(*)::integer
     from public.price_change_history h, threshold t
     where h.old_purchase_price is not null
       and h.old_purchase_price > 0
       and h.valid_from >= current_date - 30
       and abs((h.new_purchase_price - h.old_purchase_price) / h.old_purchase_price * 100) >= t.pct
    ),
    -- Gerechten met een verkoopprijs waarvan de foodcost boven de norm ligt.
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
    (select count(*)::integer from public.inbound_invoice_queue
     where status in ('nieuw', 'verwerkt')
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

comment on function public.dashboard_summary(uuid) is
  'Tellingen voor de managementsamenvatting en het statistiekenblok van het dashboard. Vat bestaande gegevens samen; houdt zelf niets bij.';

-- ---------------------------------------------------------------------
-- 2. Prijswijzigingen: stijgers en dalers over een periode.
-- ---------------------------------------------------------------------
create or replace function public.dashboard_price_changes(
  p_days integer default 30,
  p_limit integer default 10,
  p_direction text default 'alle'   -- 'stijging' | 'daling' | 'alle'
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
  above_alert boolean
)
language sql
stable
as $$
  with threshold as (
    select coalesce(max(price_alert_threshold_pct), 10) as pct from public.groups
  ),
  changes as (
    select
      h.product_id,
      coalesce(nullif(p.custom_name, ''), p.name) as product_name,
      s.name as supplier_name,
      h.old_purchase_price as old_price,
      h.new_purchase_price as new_price,
      h.new_purchase_price - h.old_purchase_price as difference_eur,
      (h.new_purchase_price - h.old_purchase_price) / h.old_purchase_price * 100 as difference_pct,
      h.valid_from as changed_on,
      t.pct as alert_pct
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
    abs(difference_pct) >= alert_pct
  from changes
  where (p_direction = 'alle')
     or (p_direction = 'stijging' and difference_pct > 0)
     or (p_direction = 'daling' and difference_pct < 0)
  order by
    (abs(difference_pct) >= alert_pct) desc,
    abs(difference_pct) desc
  limit greatest(p_limit, 1);
$$;

comment on function public.dashboard_price_changes(integer, integer, text) is
  'Prijswijzigingen over een periode, grootste afwijking eerst en alarmregels bovenaan. Voor de blokken Prijswijzigingen, Grootste stijgers/dalers en Prijsalarmen.';

-- ---------------------------------------------------------------------
-- 3. Gerechten met een marge- of kostprijsprobleem.
-- ---------------------------------------------------------------------
create or replace function public.dashboard_margin_problems(
  p_company_id uuid,
  p_foodcost_norm numeric default 33,
  p_limit integer default 15
)
returns table (
  recipe_id uuid,
  recipe_name text,
  category text,
  cost_price numeric,
  sales_price numeric,
  foodcost_pct numeric,
  margin_pct numeric
)
language sql
stable
as $$
  with calc as (
    select
      r.id,
      r.name,
      r.category,
      public.calculate_recipe_cost(r.id, p_company_id) as cost,
      r.sales_price / (1 + coalesce(r.vat_rate, 9) / 100) as sales_excl
    from public.recipes r
    where r.recipe_kind = 'gerecht'
      and r.status <> 'vervallen'
      and r.sales_price is not null
      and r.sales_price > 0
  )
  select
    id, name, category,
    round(cost, 4),
    round(sales_excl, 2),
    round(cost / nullif(sales_excl, 0) * 100, 1),
    round((sales_excl - cost) / nullif(sales_excl, 0) * 100, 1)
  from calc
  where cost is not null
    and sales_excl > 0
    and cost / sales_excl * 100 > p_foodcost_norm
  order by cost / nullif(sales_excl, 0) desc
  limit greatest(p_limit, 1);
$$;

comment on function public.dashboard_margin_problems(uuid, numeric, integer) is
  'Gerechten waarvan de foodcost boven de norm ligt, hoogste eerst. Gebruikt de bestaande kostprijsberekening.';

-- ---------------------------------------------------------------------
-- 4. Niet-herkende ingrediëntregels uit imports.
-- ---------------------------------------------------------------------
create or replace view public.dashboard_unmatched_ingredients as
select
  ri.id as line_id,
  ri.unmatched_name,
  ri.quantity,
  u.name as unit_name,
  r.id as recipe_id,
  r.name as recipe_name,
  r.recipe_kind,
  r.updated_at as changed_at
from public.recipe_ingredients ri
join public.recipes r on r.id = ri.recipe_id
left join public.units u on u.id = ri.unit_id
where ri.unmatched_name is not null;

comment on view public.dashboard_unmatched_ingredients is
  'Receptregels die bij een import niet aan een bestaand ingrediënt gekoppeld konden worden. Bron voor het dashboardblok "Niet-herkende ingrediënten".';

-- Index zodat dat blok snel blijft bij veel receptregels.
create index if not exists idx_recipe_ingredients_unmatched
  on public.recipe_ingredients(unmatched_name)
  where unmatched_name is not null;

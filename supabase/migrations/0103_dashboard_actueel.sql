-- Dashboard alleen voor de actuele kaart.
-- "Actueel" = gerechten op een actieve menukaart (menu_cards.status='actief')
-- + handmatig aangevinkte halfproducten (recipes.is_current_menu), en alles
-- wat daar (op elke diepte) als halfproduct in zit. Actuele ingrediënten
-- zijn de producten die in die recepten gebruikt worden.
-- De bestaande dashboardfuncties blijven ongewijzigd; de *_scoped-varianten
-- hebben een extra schakelaar p_only_current.

create or replace function public.current_recipe_ids()
returns table (recipe_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive roots as (
    select r.id
      from recipes r
     where r.is_current_menu and r.status <> 'vervallen'
    union
    select mi.recipe_id
      from menu_items mi
      join menu_folders f on f.id = mi.folder_id
      join menu_cards c on c.id = f.menu_card_id
     where c.status = 'actief'
  ),
  tree (recipe_id) as (
    select id from roots
    union
    select ri.sub_recipe_id
      from recipe_ingredients ri
      join tree t on t.recipe_id = ri.recipe_id
     where ri.sub_recipe_id is not null
  )
  select recipe_id from tree;
$$;

create or replace function public.current_product_ids()
returns table (product_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct ri.product_id
    from recipe_ingredients ri
   where ri.product_id is not null
     and ri.recipe_id in (select c.recipe_id from public.current_recipe_ids() c);
$$;

grant execute on function public.current_recipe_ids() to authenticated;
grant execute on function public.current_product_ids() to authenticated;

create or replace function public.dashboard_summary_scoped(
  p_company_id uuid default null,
  p_only_current boolean default false
)
returns table(price_alerts integer, cost_problems integer, unmatched_ingredients integer,
  invoices_to_check integer, upcoming_menus integer, flagged_prices integer)
language sql
stable
security invoker
set search_path = public
as $$
  with threshold as (
    select coalesce(max(price_alert_threshold_pct), 10) as pct from public.groups
  ),
  cur_r as (select recipe_id from public.current_recipe_ids() where p_only_current),
  cur_p as (select product_id from public.current_product_ids() where p_only_current)
  select
    (select count(*)::integer
       from public.price_change_history h, threshold t
      where h.old_purchase_price is not null
        and h.old_purchase_price > 0
        and h.valid_from >= current_date - 30
        and abs((h.new_purchase_price - h.old_purchase_price) / h.old_purchase_price * 100) >= t.pct
        and not exists (select 1 from public.dismissed_price_alerts d where d.supplier_product_id = h.id)
        and (not p_only_current or h.product_id in (select product_id from cur_p))),
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
      where status in ('wacht_op_leverancier', 'fout', 'dubbele_factuur')
        and resulting_batch_id is null),
    (select count(*)::integer from public.event_menus
      where service_date >= current_date
        and status in ('concept', 'definitief')),
    (select count(*)::integer from public.supplier_products sp
      where sp.flagged_for_review and sp.valid_to is null
        and (not p_only_current or sp.product_id in (select product_id from cur_p)));
$$;

create or replace function public.dashboard_price_changes_scoped(
  p_days integer default 30,
  p_limit integer default 10,
  p_direction text default 'alle',
  p_only_current boolean default false
)
returns table(product_id uuid, product_name text, supplier_name text, old_price numeric,
  new_price numeric, difference_eur numeric, difference_pct numeric, changed_on date,
  above_alert boolean, price_row_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select c.*
    from public.dashboard_price_changes(p_days, 100000, p_direction) c
   where not p_only_current
      or c.product_id in (select x.product_id from public.current_product_ids() x)
   order by c.above_alert desc, abs(c.difference_pct) desc
   limit greatest(p_limit, 1);
$$;

create or replace function public.dashboard_margin_problems_scoped(
  p_company_id uuid,
  p_foodcost_norm numeric default 33,
  p_limit integer default 15,
  p_only_current boolean default false
)
returns table(recipe_id uuid, recipe_name text, category text, cost_price numeric,
  sales_price numeric, foodcost_pct numeric, margin_pct numeric)
language sql
stable
security invoker
set search_path = public
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
      and (not p_only_current
           or r.id in (select x.recipe_id from public.current_recipe_ids() x))
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

grant execute on function public.dashboard_summary_scoped(uuid, boolean) to authenticated;
grant execute on function public.dashboard_price_changes_scoped(integer, integer, text, boolean) to authenticated;
grant execute on function public.dashboard_margin_problems_scoped(uuid, numeric, integer, boolean) to authenticated;

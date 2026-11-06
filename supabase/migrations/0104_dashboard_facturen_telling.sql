-- Dashboard-tegel "Facturen" telde ook e-mailfacturen die als dubbel waren
-- herkend (al verwerkt) mee: 216 i.p.v. de 4 die echt op actie wachten.
-- Nu dezelfde telling als het facturenscherm: wacht op controle +
-- e-mailfacturen die wachten op leverancier of mislukt zijn.

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
      where status in ('wacht_op_leverancier', 'fout')
        and resulting_batch_id is null),
    (select count(*)::integer from public.event_menus
      where service_date >= current_date
        and status in ('concept', 'definitief')),
    (select count(*)::integer from public.supplier_products sp
      where sp.flagged_for_review and sp.valid_to is null
        and (not p_only_current or sp.product_id in (select product_id from cur_p)));
$$;


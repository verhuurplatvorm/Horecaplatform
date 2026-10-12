-- 0076_dashboard_factuurteller.sql
--
-- De dashboardtegel "Facturen" telde mails met de status 'nieuw' of
-- 'verwerkt', maar die statussen bestaan in de factuurmailbox niet meer
-- (het zijn nieuw_ontvangen, verwerkt, wacht_op_leverancier, ...), waardoor
-- de teller vrijwel altijd 0 toonde. Nu: facturen die op controle wachten.
-- Idempotent (create or replace).

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
    -- Facturen die op controle wachten: uitgelezen facturen waarvan de
    -- prijzen nog niet zijn doorgevoerd, plus mails die vastlopen
    -- (controle nodig / fout / dubbel).
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

comment on function public.dashboard_summary(uuid) is
  'Tellingen voor de managementsamenvatting en het statistiekenblok van het dashboard. Vat bestaande gegevens samen; houdt zelf niets bij.';

-- 0026_prijswijzigingen_overzicht.sql
-- View die elke leveranciersprijs koppelt aan zijn direct voorgaande
-- prijs (zelfde leverancier/product/bedrijf, valid_to = dag vóór deze
-- valid_from), zodat een prijswijzigingenoverzicht (spec §7) niet voor
-- elke rij apart een lookup hoeft te doen.

create or replace view public.price_change_history as
select
  curr.id,
  curr.product_id,
  curr.supplier_id,
  curr.company_id,
  curr.purchase_price as new_purchase_price,
  curr.price_per_base_unit as new_price_per_base_unit,
  curr.valid_from,
  curr.change_reason,
  curr.is_contract_price,
  prev.purchase_price as old_purchase_price,
  prev.price_per_base_unit as old_price_per_base_unit
from public.supplier_products curr
left join public.supplier_products prev
  on prev.supplier_id = curr.supplier_id
  and prev.product_id = curr.product_id
  and prev.company_id is not distinct from curr.company_id
  and prev.valid_to = curr.valid_from - interval '1 day';

comment on view public.price_change_history is
  'Elke leveranciersprijs gekoppeld aan zijn directe voorganger (spec §7: prijswijzigingenoverzicht). old_price_per_base_unit is null bij de allereerste prijs van een product/leverancier/bedrijf-combinatie.';

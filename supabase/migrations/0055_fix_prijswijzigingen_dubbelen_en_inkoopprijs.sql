-- 0055_fix_prijswijzigingen_dubbelen_en_inkoopprijs.sql
--
-- BUGFIX — "Duurder/Goedkoper/Ongewijzigd"-filters op het
-- prijswijzigingenscherm leken niet te werken. De echte oorzaak: de
-- view price_change_history koppelt elke prijsregel via een LEFT JOIN
-- aan zijn voorganger (op valid_to = valid_from - 1 dag). Bij nog
-- aanwezige dubbele HISTORISCHE (afgesloten) prijsregels uit oude
-- testruns kan die join naar twee voorgangers tegelijk matchen, zodat
-- dezelfde huidige prijs twee keer in de lijst verschijnt — één keer
-- terecht als "duurder" (t.o.v. de echte vorige prijs) en één keer als
-- "ongewijzigd" (toevallig gekoppeld aan een dubbele regel met exact
-- dezelfde prijs). De filters werkten dus wél correct per rij, maar de
-- onderliggende rij was al dubbel.
--
-- Fix in twee stappen:
-- 1. Opschonen: exacte dubbele afgesloten prijsregels verwijderen
--    (zelfde leverancier/product/bedrijf/prijs/verpakking/periode) —
--    dezelfde aanpak als eerder bij de nog-actieve dubbelen (0049),
--    nu ook toegepast op historische (afgesloten) regels.
-- 2. De view zelf robuust maken met een LATERAL join die altijd hoogstens
--    één voorganger oplevert, zodat dit structureel niet meer kan
--    voorkomen, ook niet bij eventuele toekomstige datarommel.
--
-- Extra, op verzoek: naast de prijs per basiseenheid (gram/ml) ook de
-- inkoopprijs per verpakking tonen (bv. "€ 24,15 voor 1 × 12.500 gram"),
-- zodat je meteen ziet wát er precies duurder is geworden.

-- Stap 1: exacte dubbele afgesloten prijsregels opschonen
with exacte_duplicaten as (
  select
    id,
    row_number() over (
      partition by
        supplier_id,
        product_id,
        coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
        purchase_price,
        packaging_unit_count,
        valid_from,
        valid_to
      order by created_at asc, id asc
    ) as rn
  from public.supplier_products
  where valid_to is not null
)
delete from public.supplier_products sp
using exacte_duplicaten d
where sp.id = d.id
  and d.rn > 1;

-- Stap 2: view herbouwen met LATERAL join (altijd max. één voorganger)
-- en met inkoopprijs + verpakking erbij.
drop view if exists public.price_change_history;

create view public.price_change_history as
select
  curr.id,
  curr.product_id,
  curr.supplier_id,
  curr.company_id,
  curr.purchase_price as new_purchase_price,
  curr.packaging_description as new_packaging_description,
  curr.packaging_unit_count as new_packaging_unit_count,
  curr.price_per_base_unit as new_price_per_base_unit,
  curr.valid_from,
  curr.change_reason,
  curr.is_contract_price,
  prev.purchase_price as old_purchase_price,
  prev.packaging_description as old_packaging_description,
  prev.packaging_unit_count as old_packaging_unit_count,
  prev.price_per_base_unit as old_price_per_base_unit
from public.supplier_products curr
left join lateral (
  select sp.purchase_price, sp.packaging_description, sp.packaging_unit_count, sp.price_per_base_unit
  from public.supplier_products sp
  where sp.supplier_id = curr.supplier_id
    and sp.product_id = curr.product_id
    and sp.company_id is not distinct from curr.company_id
    and sp.valid_to = curr.valid_from - interval '1 day'
  order by sp.created_at desc, sp.id desc
  limit 1
) prev on true;

comment on view public.price_change_history is
  'Elke leveranciersprijs gekoppeld aan hoogstens één directe voorganger (LATERAL + LIMIT 1, voorkomt dubbele rijen bij historische datarommel). Bevat zowel de prijs per basiseenheid als de inkoopprijs per verpakking (oud en nieuw). old_price_per_base_unit is null bij de allereerste prijs van een product/leverancier/bedrijf-combinatie.';

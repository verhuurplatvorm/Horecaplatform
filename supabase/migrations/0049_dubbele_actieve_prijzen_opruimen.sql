-- 0049_dubbele_actieve_prijzen_opruimen.sql
-- Eenmalige opschoning: door herhaalde testruns van de bulk-import
-- (vóór de dubbel-preventie er was) staan er voor sommige combinaties
-- leverancier+product+bedrijf meerdere "actieve" prijzen (valid_to is
-- null) naast elkaar. Sluit alle behalve de meest recente af, zodat
-- elk product weer één eenduidige actuele prijs per leverancier heeft.

with duplicates as (
  select
    id,
    row_number() over (
      partition by supplier_id, product_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by valid_from desc, created_at desc
    ) as rn
  from public.supplier_products
  where valid_to is null
)
update public.supplier_products sp
set valid_to = current_date - interval '1 day'
from duplicates d
where sp.id = d.id
  and d.rn > 1;

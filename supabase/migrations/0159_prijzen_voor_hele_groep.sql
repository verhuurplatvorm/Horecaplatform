-- 0159: Eén prijs per ingrediënt voor Het Strand én Zomers (synergie).
--
-- Oorzaak: een Rovers-prijslijst was ingelezen met "Het Strand" geselecteerd;
-- 106 prijzen golden daardoor alleen voor Het Strand en Zomers zag geen prijs.
--
-- 1. Bedrijfsgebonden leveranciersprijzen (geen contractprijs) zonder
--    groepsprijs ernaast → geldig voor de hele groep.
-- 2. Waar al een nieuwere groepsprijs bestaat → de oudere bedrijfsprijs
--    afsluiten (historie blijft bewaard).
-- 3. Imports (prijslijst, factuur, mailbox) schrijven voortaan altijd een
--    groepsprijs. De factuur/batch zelf blijft bij het bedrijf horen
--    (nodig voor de prijsvergelijking).

-- 2. oudere bedrijfsprijs afsluiten als er een nieuwere groepsprijs is
update public.supplier_products sp
   set valid_to = greatest(sp.valid_from, current_date - 1)
 where sp.company_id is not null
   and not sp.is_contract_price
   and sp.valid_to is null
   and exists (select 1 from public.supplier_products g
                where g.product_id = sp.product_id and g.supplier_id = sp.supplier_id
                  and g.company_id is null and g.valid_to is null and g.valid_from >= sp.valid_from);

-- 1. overige bedrijfsprijzen → groepsprijs
update public.supplier_products sp
   set company_id = null
 where sp.company_id is not null
   and not sp.is_contract_price
   and sp.valid_to is null
   and not exists (select 1 from public.supplier_products g
                    where g.product_id = sp.product_id and g.supplier_id = sp.supplier_id
                      and g.company_id is null and g.valid_to is null);

-- 3. import schrijft altijd een groepsprijs (zelfde functie, bedrijf → null)
do $m$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.apply_price_import_row(uuid)'::regprocedure);
  v_def := replace(v_def, 'and company_id is not distinct from v_batch.company_id', 'and company_id is null');
  v_def := replace(v_def, 'v_batch.supplier_id, v_row.matched_product_id, v_batch.company_id,', 'v_batch.supplier_id, v_row.matched_product_id, null,');
  if v_def like '%v_batch.company_id%' then
    raise exception 'apply_price_import_row: onverwachte definitie, niet aangepast';
  end if;
  execute v_def;
end $m$;

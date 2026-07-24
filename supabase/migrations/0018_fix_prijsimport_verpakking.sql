-- 0018_fix_prijsimport_verpakking.sql
-- apply_price_import_row nam voorheen stilzwijgend packaging_unit_count = 1
-- aan wanneer een prijslijst geen verpakkingskolom bevatte. Voor een
-- product met een kleine basiseenheid (ml, g) resulteert dat in een
-- absurd hoge prijs per basiseenheid (de volledige inkoopprijs wordt dan
-- behandeld als prijs voor 1 ml/gram), zonder dat iemand dat opmerkt totdat
-- de kostprijs van een recept ineens duizenden euro's blijkt te zijn.
--
-- Vanaf nu: een regel zonder bekende verpakkingshoeveelheid wordt NIET
-- toegepast, met een duidelijke foutmelding, in plaats van een gok te
-- wagen. De gebruiker vult de verpakking dan handmatig aan in het
-- controlescherm (UI-wijziging, zie price-import review page) vóórdat de
-- regel alsnog kan worden toegepast.

create or replace function public.apply_price_import_row(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.price_import_rows%rowtype;
  v_batch public.price_import_batches%rowtype;
begin
  select * into v_row from public.price_import_rows where id = p_row_id;
  if v_row.matched_product_id is null then
    raise exception 'Kan regel % niet toepassen: geen gekoppeld product', p_row_id;
  end if;

  if v_row.packaging_unit_count is null or v_row.packaging_unit_count <= 0 then
    raise exception 'Kan regel % niet toepassen: verpakkingshoeveelheid ontbreekt. Vul eerst in hoeveel basiseenheden deze prijs vertegenwoordigt (bv. 30000 voor een fust van 30L bij basiseenheid ml).', p_row_id;
  end if;

  select * into v_batch from public.price_import_batches where id = v_row.batch_id;

  update public.supplier_products
  set valid_to = current_date - interval '1 day'
  where supplier_id = v_batch.supplier_id
    and product_id = v_row.matched_product_id
    and company_id is not distinct from v_batch.company_id
    and valid_to is null;

  insert into public.supplier_products (
    supplier_id, product_id, company_id, supplier_article_code,
    packaging_description, packaging_unit_count, purchase_price,
    is_contract_price, valid_from
  ) values (
    v_batch.supplier_id, v_row.matched_product_id, v_batch.company_id, v_row.article_number,
    v_row.packaging_description, v_row.packaging_unit_count, v_row.purchase_price,
    false, current_date
  );

  update public.price_import_rows
  set status = 'toegepast'
  where id = p_row_id;
end;
$$;

comment on function public.apply_price_import_row(uuid) is
  'Verwerkt één importregel tot een nieuwe supplier_products-prijs, met behoud van historie. Weigert regels zonder bekende verpakkingshoeveelheid (voorkomt absurde prijzen per basiseenheid) i.p.v. stilzwijgend 1 aan te nemen.';

-- 0037_verpakking_eenheid_conversie_fix.sql
-- Structurele fix: packaging_unit_count werd altijd berekend in de
-- kleinst mogelijke eenheid (gram/ml/stuk), maar bij het toepassen werd
-- nooit gecontroleerd of het gekoppelde product wél diezelfde
-- basiseenheid gebruikt (een product kan bv. "kg" als basiseenheid
-- hebben in plaats van "g"). Dat gaf een stille factor-1000-fout in de
-- opgeslagen prijs. Nu wordt de hoeveelheid bij het toepassen altijd
-- omgerekend naar de daadwerkelijke basiseenheid van het gekoppelde
-- product, met een harde controle op verkeerde dimensie (bv. gewicht
-- toepassen op een product met een inhoudseenheid).

alter table public.price_import_rows
  add column if not exists packaging_unit_key text references public.units(key);

comment on column public.price_import_rows.packaging_unit_key is
  'In welke eenheid packaging_unit_count is uitgedrukt (meestal de kleinste eenheid: g/ml/stuk). Null = waarde is al in de basiseenheid van het gekoppelde product (bv. bij handmatige invoer).';

create or replace function public.apply_price_import_row(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.price_import_rows%rowtype;
  v_batch public.price_import_batches%rowtype;
  v_reopened_id uuid;
  v_new_id uuid;
  v_product_base_unit_id uuid;
  v_packaging_factor numeric;
  v_packaging_dim public.unit_dimension;
  v_product_factor numeric;
  v_product_dim public.unit_dimension;
  v_final_count numeric;
begin
  select * into v_row from public.price_import_rows where id = p_row_id;
  if v_row.matched_product_id is null then
    raise exception 'Kan regel % niet toepassen: geen gekoppeld product', p_row_id;
  end if;

  if v_row.packaging_unit_count is null or v_row.packaging_unit_count <= 0 then
    raise exception 'Kan regel % niet toepassen: verpakkingshoeveelheid ontbreekt.', p_row_id;
  end if;

  v_final_count := v_row.packaging_unit_count;

  if v_row.packaging_unit_key is not null then
    select base_unit_id into v_product_base_unit_id
    from public.products where id = v_row.matched_product_id;

    select factor_to_base, dimension into v_packaging_factor, v_packaging_dim
    from public.units where key = v_row.packaging_unit_key;

    select factor_to_base, dimension into v_product_factor, v_product_dim
    from public.units where id = v_product_base_unit_id;

    if v_packaging_factor is not null and v_product_factor is not null then
      if v_packaging_dim is distinct from v_product_dim then
        raise exception
          'Kan regel % niet toepassen: de verpakkingseenheid (%) past niet bij de eenheid van het gekoppelde product (verschillende dimensie — bv. gewicht vs. inhoud). Controleer de productkoppeling.',
          p_row_id, v_row.packaging_unit_key;
      end if;
      v_final_count := v_row.packaging_unit_count * v_packaging_factor / v_product_factor;
    end if;
  end if;

  select * into v_batch from public.price_import_batches where id = v_row.batch_id;

  select id into v_reopened_id
  from public.supplier_products
  where supplier_id = v_batch.supplier_id
    and product_id = v_row.matched_product_id
    and company_id is not distinct from v_batch.company_id
    and valid_to is null;

  if v_reopened_id is not null then
    update public.supplier_products
    set valid_to = current_date - interval '1 day'
    where id = v_reopened_id;
  end if;

  insert into public.supplier_products (
    supplier_id, product_id, company_id, supplier_article_code,
    packaging_description, packaging_unit_count, purchase_price,
    is_contract_price, valid_from
  ) values (
    v_batch.supplier_id, v_row.matched_product_id, v_batch.company_id, v_row.article_number,
    v_row.packaging_description, v_final_count, v_row.purchase_price,
    false, current_date
  )
  returning id into v_new_id;

  update public.price_import_rows
  set status = 'toegepast',
      resulting_supplier_product_id = v_new_id,
      reopened_supplier_product_id = v_reopened_id
  where id = p_row_id;
end;
$$;

comment on function public.apply_price_import_row(uuid) is
  'Past één prijsimport-regel toe: rekent packaging_unit_count (indien packaging_unit_key gezet is) om naar de daadwerkelijke basiseenheid van het gekoppelde product, met een harde stop bij een dimensie-mismatch.';

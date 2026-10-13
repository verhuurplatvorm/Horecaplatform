-- 0079_prijs_per_kilo.sql
--
-- Op facturen staat de prijs van vis/vlees/groenten meestal per kilo. Een
-- regel in kilo's of liters heeft daarom altijd verpakking 1 kg / 1 liter.
-- Eerder bleef bij een bestaande prijs de oude (soms verkeerde) verpakking
-- staan, bv. "200 gram" of "1600 gram" bij een prijs die per kilo is, en
-- werd de prijs als "te controleren" gemarkeerd.
-- Nu: bij een kilo-/literregel met een bestaand artikel wordt de verpakking
-- uit de factuur overgenomen (nieuwe prijsregel, historie blijft bewaard)
-- en niet gemarkeerd. Ook als de prijs gelijk is maar de verpakking niet,
-- wordt de verpakking gecorrigeerd. Andere regels: ongewijzigd gedrag.
-- Idempotent (create or replace).

create or replace function public.apply_price_import_row(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.price_import_rows%rowtype;
  v_batch public.price_import_batches%rowtype;
  v_existing public.supplier_products%rowtype;
  v_new_id uuid;
  v_product_base_unit_id uuid;
  v_packaging_unit_id uuid;
  v_packaging_dim public.unit_dimension;
  v_product_dim public.unit_dimension;
  v_incoming_count numeric;
  v_incoming_valid boolean := false;
  v_bridged boolean := false;
  v_final_count numeric;
  v_final_description text;
  v_flag_review boolean := false;
  v_per_unit boolean := false;
begin
  select * into v_row from public.price_import_rows where id = p_row_id;
  if v_row.matched_product_id is null then
    raise exception 'Kan regel % niet toepassen: geen gekoppeld product', p_row_id;
  end if;
  if v_row.purchase_price is null then
    raise exception 'Kan regel % niet toepassen: prijs ontbreekt.', p_row_id;
  end if;

  select * into v_batch from public.price_import_batches where id = v_row.batch_id;

  -- Regel in kilo's of liters: de prijs is per kg/liter, dus de verpakking
  -- is 1 kg / 1 liter. Dat is zeker, ook als de bestaande verpakking anders is.
  v_per_unit := lower(regexp_replace(coalesce(v_row.raw->>'unit', ''), '[^A-Za-z]', '', 'g'))
    in ('kg', 'kgs', 'kilo', 'kilogram', 'l', 'lt', 'ltr', 'liter', 'litre');

  select * into v_existing
  from public.supplier_products
  where supplier_id = v_batch.supplier_id
    and product_id = v_row.matched_product_id
    and company_id is not distinct from v_batch.company_id
    and valid_to is null
  limit 1;

  -- Inkomende verpakkingshoeveelheid omrekenen naar de basiseenheid van
  -- het product via de centrale conversieregel (incl. stuk-brug).
  if v_row.packaging_unit_count is not null and v_row.packaging_unit_count > 0 then
    v_incoming_count := v_row.packaging_unit_count;
    v_incoming_valid := true;

    if v_row.packaging_unit_key is not null then
      select base_unit_id into v_product_base_unit_id
      from public.products where id = v_row.matched_product_id;
      select id, dimension into v_packaging_unit_id, v_packaging_dim
      from public.units where key = v_row.packaging_unit_key;
      select dimension into v_product_dim
      from public.units where id = v_product_base_unit_id;

      if v_packaging_unit_id is not null and v_product_base_unit_id is not null then
        v_incoming_count := public.convert_quantity(
          v_row.matched_product_id, v_row.packaging_unit_count,
          v_packaging_unit_id, v_product_base_unit_id
        );
        if v_incoming_count is null then
          v_incoming_valid := false;
        elsif v_packaging_dim is distinct from v_product_dim then
          v_bridged := true; -- via de stuk-brug omgerekend
        end if;
      end if;
    end if;
  end if;

  if v_existing.id is not null then
    -- BESTAANDE PRIJS: alleen de prijs mag wijzigen; verpakking blijft.
    if abs(v_existing.purchase_price - v_row.purchase_price) < 0.0001
       and not (v_per_unit and v_incoming_valid and not v_bridged
                and abs(v_incoming_count - v_existing.packaging_unit_count) > 0.0001) then
      update public.price_import_rows
      set status = 'ongewijzigd',
          resulting_supplier_product_id = v_existing.id,
          reopened_supplier_product_id = null
      where id = p_row_id;
      return;
    end if;

    v_final_count := v_existing.packaging_unit_count;
    v_final_description := v_existing.packaging_description;
    if v_per_unit and v_incoming_valid and not v_bridged then
      -- Prijs per kilo/liter: verpakking uit de factuur is leidend en
      -- corrigeert een eerder verkeerd opgeslagen verpakking.
      v_final_count := v_incoming_count;
      v_final_description := v_row.packaging_description;
    elsif not v_incoming_valid
       or abs(v_incoming_count - v_existing.packaging_unit_count) > 0.0001 then
      v_flag_review := true;
    end if;

    update public.supplier_products
    set valid_to = current_date - interval '1 day'
    where id = v_existing.id;

    insert into public.supplier_products (
      supplier_id, product_id, company_id, supplier_article_code,
      packaging_description, packaging_unit_count, purchase_price,
      is_contract_price, flagged_for_review, valid_from
    ) values (
      v_batch.supplier_id, v_row.matched_product_id, v_batch.company_id,
      coalesce(v_row.article_number, v_existing.supplier_article_code),
      v_final_description, v_final_count, v_row.purchase_price,
      false, v_flag_review, current_date
    )
    returning id into v_new_id;

    update public.price_import_rows
    set status = 'toegepast',
        resulting_supplier_product_id = v_new_id,
        reopened_supplier_product_id = v_existing.id
    where id = p_row_id;
    return;
  end if;

  -- NIEUWE PRIJS: verpakking uit het bestand is leidend.
  if v_row.packaging_unit_count is null or v_row.packaging_unit_count <= 0 then
    raise exception 'Kan regel % niet toepassen: verpakkingshoeveelheid ontbreekt.', p_row_id;
  end if;
  if not v_incoming_valid then
    raise exception
      'Kan regel % niet toepassen: de verpakkingseenheid (%) past niet bij de eenheid van het gekoppelde product en er is geen gemiddeld gewicht/inhoud per stuk ingesteld. Stel dat in bij het ingrediënt, of controleer de koppeling.',
      p_row_id, v_row.packaging_unit_key;
  end if;

  insert into public.supplier_products (
    supplier_id, product_id, company_id, supplier_article_code,
    packaging_description, packaging_unit_count, purchase_price,
    is_contract_price, flagged_for_review, valid_from
  ) values (
    v_batch.supplier_id, v_row.matched_product_id, v_batch.company_id, v_row.article_number,
    v_row.packaging_description, v_incoming_count, v_row.purchase_price,
    false, v_bridged, current_date
  )
  returning id into v_new_id;

  update public.price_import_rows
  set status = 'toegepast',
      resulting_supplier_product_id = v_new_id,
      reopened_supplier_product_id = null
  where id = p_row_id;
end;
$$;

comment on function public.apply_price_import_row(uuid) is
  'Past één prijsimport-regel toe. Kilo-/literregels krijgen verpakking 1 kg/1 liter (prijs per kilo); overige regels: alleen-prijswijzigingen-principe met conversie via public.convert_quantity.';

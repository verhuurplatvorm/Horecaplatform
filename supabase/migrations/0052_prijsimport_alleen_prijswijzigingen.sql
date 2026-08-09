-- 0052_prijsimport_alleen_prijswijzigingen.sql
-- Prijsimports (geüploade prijslijsten én automatisch uitgelezen
-- facturen) raken bestaande productgegevens niet meer aan:
--
-- 1. Bestaat er al een actieve prijs voor leverancier + product, dan
--    wordt ALLEEN de prijs gewijzigd — en alleen als die afwijkt.
--    De bestaande verpakkingseenheid en -omschrijving blijven behouden
--    (een handmatige correctie, bv. stuk → 10.000 ml, blijft dus staan).
-- 2. Is de prijs identiek, dan gebeurt er niets: de regel krijgt de
--    nieuwe status 'ongewijzigd' i.p.v. een duplicaat in de historie.
-- 3. Wijkt de door het bestand gesuggereerde verpakking af van de
--    bestaande, dan wordt de nieuwe prijsregel gemarkeerd als
--    "Te controleren" (flagged_for_review) — de prijs loopt gewoon mee,
--    maar je kunt nagaan of de leverancier echt een andere verpakking
--    is gaan leveren.
-- 4. Alleen bij een product ZONDER bestaande prijs wordt de verpakking
--    uit het bestand gebruikt; een dimensie-mismatch blijft daar een
--    harde stop (niet gokken).
--
-- Prijshistorie blijft volledig: oude prijs wordt afgesloten
-- (valid_to = gisteren), nieuwe prijs krijgt valid_from = vandaag.

alter type public.price_import_row_status add value if not exists 'ongewijzigd';

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
  v_packaging_factor numeric;
  v_packaging_dim public.unit_dimension;
  v_product_factor numeric;
  v_product_dim public.unit_dimension;
  v_incoming_count numeric;
  v_incoming_valid boolean := false;
  v_final_count numeric;
  v_final_description text;
  v_flag_review boolean := false;
begin
  select * into v_row from public.price_import_rows where id = p_row_id;
  if v_row.matched_product_id is null then
    raise exception 'Kan regel % niet toepassen: geen gekoppeld product', p_row_id;
  end if;

  if v_row.purchase_price is null then
    raise exception 'Kan regel % niet toepassen: prijs ontbreekt.', p_row_id;
  end if;

  select * into v_batch from public.price_import_batches where id = v_row.batch_id;

  -- Bestaande actieve prijs voor deze leverancier + product (+ bedrijf)?
  select * into v_existing
  from public.supplier_products
  where supplier_id = v_batch.supplier_id
    and product_id = v_row.matched_product_id
    and company_id is not distinct from v_batch.company_id
    and valid_to is null
  limit 1;

  -- Inkomende verpakkingshoeveelheid omrekenen naar de basiseenheid van
  -- het gekoppelde product (indien mogelijk en dimensioneel kloppend).
  if v_row.packaging_unit_count is not null and v_row.packaging_unit_count > 0 then
    v_incoming_count := v_row.packaging_unit_count;
    v_incoming_valid := true;

    if v_row.packaging_unit_key is not null then
      select base_unit_id into v_product_base_unit_id
      from public.products where id = v_row.matched_product_id;

      select factor_to_base, dimension into v_packaging_factor, v_packaging_dim
      from public.units where key = v_row.packaging_unit_key;

      select factor_to_base, dimension into v_product_factor, v_product_dim
      from public.units where id = v_product_base_unit_id;

      if v_packaging_factor is not null and v_product_factor is not null then
        if v_packaging_dim is distinct from v_product_dim then
          v_incoming_valid := false; -- bv. "stuk" bij een ml-product
        else
          v_incoming_count := v_row.packaging_unit_count * v_packaging_factor / v_product_factor;
        end if;
      end if;
    end if;
  end if;

  if v_existing.id is not null then
    -- BESTAAND PRODUCT MET BESTAANDE PRIJS: alleen de prijs mag wijzigen.
    -- Verpakkingseenheid en -omschrijving blijven zoals ze zijn.
    if abs(v_existing.purchase_price - v_row.purchase_price) < 0.0001 then
      update public.price_import_rows
      set status = 'ongewijzigd',
          resulting_supplier_product_id = v_existing.id,
          reopened_supplier_product_id = null
      where id = p_row_id;
      return;
    end if;

    v_final_count := v_existing.packaging_unit_count;
    v_final_description := v_existing.packaging_description;

    -- Het bestand suggereert een (geldig omgerekende) andere verpakking
    -- dan wat er staat — prijs gewoon doorvoeren met de bestaande
    -- verpakking, maar markeren zodat dit nagelopen kan worden.
    if v_incoming_valid and abs(v_incoming_count - v_existing.packaging_unit_count) > 0.0001 then
      v_flag_review := true;
    end if;
    if not v_incoming_valid then
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

  -- NIEUW: geen bestaande prijs — hier is de verpakking uit het bestand
  -- wél leidend, en een dimensie-mismatch blijft een harde stop.
  if v_row.packaging_unit_count is null or v_row.packaging_unit_count <= 0 then
    raise exception 'Kan regel % niet toepassen: verpakkingshoeveelheid ontbreekt.', p_row_id;
  end if;
  if not v_incoming_valid then
    raise exception
      'Kan regel % niet toepassen: de verpakkingseenheid (%) past niet bij de eenheid van het gekoppelde product (verschillende dimensie — bv. gewicht vs. inhoud). Controleer de productkoppeling.',
      p_row_id, v_row.packaging_unit_key;
  end if;

  insert into public.supplier_products (
    supplier_id, product_id, company_id, supplier_article_code,
    packaging_description, packaging_unit_count, purchase_price,
    is_contract_price, valid_from
  ) values (
    v_batch.supplier_id, v_row.matched_product_id, v_batch.company_id, v_row.article_number,
    v_row.packaging_description, v_incoming_count, v_row.purchase_price,
    false, current_date
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
  'Past één prijsimport-regel toe volgens het "alleen prijswijzigingen"-principe: bestaande prijsregels behouden hun verpakking, identieke prijzen worden overgeslagen (status ongewijzigd), en de volledige prijshistorie blijft bewaard via valid_from/valid_to.';

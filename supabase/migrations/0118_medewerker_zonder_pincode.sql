-- 0118_medewerker_zonder_pincode.sql
--
-- Collegiale werkplek: medewerker kiezen uit een keuzelijst, zonder pincode.
-- Geldt voor HACCP-schoonmaak én stickers.
--
-- * haccp_start_staff_session(): pincode wordt niet meer gecontroleerd
--   (parameter blijft bestaan voor compatibiliteit). Ook toegestaan voor wie
--   stickers mag afdrukken.
-- * sticker_print(): goedkeuring langere houdbaarheid = leidinggevende kiezen,
--   zonder pincode. Onderbouwing blijft verplicht.
-- * Bestaande pincodes (user_profiles.staff_pin_hash) blijven ongemoeid maar
--   worden nergens meer gevraagd.
-- * Additief: er wordt niets verwijderd.

create or replace function public.haccp_start_staff_session(
  p_company_id uuid, p_staff_id uuid, p_pin text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not (public.has_module_permission(p_company_id, 'haccp', 'create')
          or public.has_module_permission(p_company_id, 'stickers', 'create')) then
    raise exception 'Geen recht om registraties vast te leggen';
  end if;
  if not exists (select 1 from public.haccp_staff(p_company_id) s where s.id = p_staff_id) then
    raise exception 'Onbekende medewerker';
  end if;
  insert into public.haccp_staff_sessions (company_id, staff_id)
  values (p_company_id, p_staff_id)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.haccp_start_staff_session(uuid, uuid, text) is
  'Kiest wie er werkt op dit apparaat (keuzelijst, zonder pincode). Registraties worden daarna op naam van deze medewerker vastgelegd; het ingelogde account wordt apart bewaard.';

create or replace function public.sticker_print(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_company_id uuid := (p->>'company_id')::uuid;
  v_session uuid := nullif(p->>'session_id', '')::uuid;
  v_type text := p->>'sticker_type';
  v_recipe_id uuid := nullif(p->>'recipe_id', '')::uuid;
  v_product_id uuid := nullif(p->>'product_id', '')::uuid;
  v_cat_id uuid := nullif(p->>'freezer_category_id', '')::uuid;
  v_name text := trim(coalesce(p->>'product_name', ''));
  v_prod_date date := nullif(p->>'production_date', '')::date;
  v_expiry date := nullif(p->>'expiry_date', '')::date;
  v_orig date := nullif(p->>'original_expiry', '')::date;
  v_orig_kind text := nullif(p->>'original_expiry_kind', '');
  v_orig_source text := nullif(p->>'original_source', '');
  v_label_id uuid := nullif(p->>'source_label_id', '')::uuid;
  v_reason text := nullif(trim(coalesce(p->>'change_reason', '')), '');
  v_approver uuid := nullif(p->>'approver_id', '')::uuid;
  v_existing public.sticker_prints%rowtype;
  v_company public.companies%rowtype;
  v_performer uuid;
  v_performer_name text;
  v_std record;
  v_expected date;
  v_applied smallint;
  v_needs_approval boolean := false;
  v_needs_reason boolean := false;
  v_cat public.sticker_freezer_categories%rowtype;
  v_set_id uuid;
  v_set_cat uuid;
begin
  if v_id is null then raise exception 'Geen registratie-id'; end if;

  -- Dubbel klikken / opnieuw verzonden: zelfde id = al geregistreerd.
  select * into v_existing from public.sticker_prints where id = v_id;
  if found then
    return jsonb_build_object('status', 'al_geregistreerd', 'id', v_existing.id);
  end if;

  select * into v_company from public.companies where id = v_company_id;
  if not found or not public.has_company_access(v_company_id) then
    raise exception 'Geen toegang tot dit bedrijf';
  end if;
  if not public.has_module_permission(v_company_id, 'stickers', 'create') then
    raise exception 'Geen recht om stickers af te drukken';
  end if;

  -- Medewerker: gekozen in de keuzelijst (sessie) of het eigen (persoonlijke) account.
  v_performer := public.haccp_resolve_performer(v_company_id, v_session);
  if v_performer is null then
    raise exception 'Kies eerst de medewerker';
  end if;
  if not exists (select 1 from public.sticker_staff(v_company_id) s where s.id = v_performer) then
    raise exception 'Kies eerst de medewerker — een gedeeld keukenaccount kan geen sticker ondertekenen';
  end if;
  select full_name into v_performer_name from public.user_profiles where id = v_performer;

  if v_type not in ('productie', 'vers', 'diepvries') then
    raise exception 'Onbekend stickertype';
  end if;
  if v_name = '' then raise exception 'Productnaam is verplicht'; end if;
  if v_prod_date is null then raise exception 'Datum is verplicht'; end if;
  if v_type <> 'productie' and v_expiry is null then
    raise exception 'Houdbaarheidsdatum is verplicht';
  end if;
  if v_expiry is not null and v_expiry < v_prod_date then
    raise exception 'Houdbaarheidsdatum ligt vóór de productie-/invriesdatum';
  end if;

  if v_cat_id is not null then
    select * into v_cat from public.sticker_freezer_categories
    where id = v_cat_id and group_id = public.current_user_group_id();
    if not found then raise exception 'Onbekende productgroep'; end if;
  end if;
  if v_type = 'diepvries' and v_cat_id is null then
    raise exception 'Kies een productgroep';
  end if;

  -- Termijncontrole
  select * into v_std from public.sticker_standard_term(v_type, v_recipe_id, v_product_id, v_cat_id);
  if v_type <> 'productie' then
    if v_std.term is not null then
      v_expected := case v_std.unit
        when 'maanden' then (v_prod_date + make_interval(months => v_std.term))::date
        else v_prod_date + v_std.term end;
      if v_expiry > v_expected then
        v_needs_approval := true;  -- korter mag altijd, langer alleen met goedkeuring
      end if;
      v_applied := case when v_expiry = v_expected then v_std.term else null end;
    else
      v_needs_reason := true;  -- geen goedgekeurde termijn: handmatige datum met onderbouwing
    end if;
  end if;

  -- Bestaande THT/TGT: nooit stilzwijgend verlengen.
  if v_orig is not null then
    if v_type = 'diepvries' then
      if v_prod_date >= v_orig and v_orig_kind = 'TGT' then
        raise exception 'Invriesdatum ligt op of na de oorspronkelijke TGT — dit product mag niet meer worden ingevroren';
      end if;
      if v_prod_date > v_orig then
        raise exception 'Invriesdatum ligt na de oorspronkelijke THT — dit product mag niet meer worden ingevroren';
      end if;
    end if;
    if v_expiry > v_orig then
      if v_type = 'diepvries' and v_orig_source = 'batch' and v_label_id is not null then
        null;  -- eigen productie, ingevroren vóór TGT: volgens procedure (Hygiënecode)
      else
        v_needs_approval := true;
      end if;
    end if;
  end if;

  if v_needs_reason and v_reason is null then
    raise exception 'Geef een onderbouwing voor de handmatige datum';
  end if;

  if v_needs_approval then
    if v_reason is null then
      raise exception 'Een langere houdbaarheid vereist een onderbouwing';
    end if;
    if v_approver is null then
      raise exception 'Een langere houdbaarheid vereist goedkeuring van een leidinggevende';
    end if;
    if not public.user_has_module_permission(v_approver, v_company_id, 'stickers_beheer', 'edit') then
      raise exception 'Deze persoon mag geen langere houdbaarheid goedkeuren';
    end if;
  else
    v_approver := null;
  end if;

  insert into public.sticker_prints (
    id, group_id, company_id, company_name, recipe_id, product_id, product_name,
    sticker_type, freezer_category_id, product_group, production_date, production_time,
    original_expiry, original_expiry_kind, original_source, source_label_id,
    standard_term, term_unit, applied_term, expiry_date, term_source, term_changed,
    change_reason, approved_by, approved_by_name, storage_temp, batch_number, quantity,
    note, employee_id, employee_name, printed_by_id, printed_by_name, recorded_by,
    staff_session_id, sticker_count, sticker_format
  ) values (
    v_id, v_company.group_id, v_company_id, coalesce(nullif(v_company.trade_name, ''), v_company.name),
    v_recipe_id, v_product_id, v_name,
    v_type, v_cat_id, case when v_cat.id is not null then v_cat.name else nullif(p->>'product_group', '') end,
    v_prod_date, nullif(p->>'production_time', '')::time,
    v_orig, v_orig_kind, v_orig_source, v_label_id,
    v_std.term, v_std.unit, v_applied, v_expiry,
    case when v_type = 'productie' then null
         when v_std.term is null then 'handmatig'
         when v_applied is null then 'aangepast'
         else v_std.source end,
    v_type <> 'productie' and (v_std.term is null or v_applied is null),
    v_reason, v_approver, (select full_name from public.user_profiles where id = v_approver),
    nullif(p->>'storage_temp', ''), nullif(trim(coalesce(p->>'batch_number', '')), ''),
    nullif(trim(coalesce(p->>'quantity', '')), ''), nullif(trim(coalesce(p->>'note', '')), ''),
    v_performer, v_performer_name, v_performer, v_performer_name, auth.uid(),
    v_session, greatest(1, least(200, coalesce((p->>'sticker_count')::int, 1))),
    nullif(p->>'sticker_format', '')
  );

  -- Gekozen productgroep onthouden voor dit product (eerste keer), of
  -- bijwerken als een leidinggevende een andere kiest.
  if v_cat_id is not null and (v_recipe_id is not null or v_product_id is not null) then
    if v_recipe_id is not null then
      select id, freezer_category_id into v_set_id, v_set_cat
      from public.sticker_product_settings where recipe_id = v_recipe_id;
    else
      select id, freezer_category_id into v_set_id, v_set_cat
      from public.sticker_product_settings
      where product_id = v_product_id and group_id = v_company.group_id;
    end if;
    if v_set_id is null then
      insert into public.sticker_product_settings (group_id, recipe_id, product_id, freezer_category_id, category_set_by)
      values (v_company.group_id, v_recipe_id, v_product_id, v_cat_id, v_performer);
    elsif v_set_cat is null
       or (v_set_cat <> v_cat_id
           and public.user_has_module_permission(v_performer, v_company_id, 'stickers_beheer', 'edit')) then
      update public.sticker_product_settings
      set freezer_category_id = v_cat_id, category_set_by = v_performer
      where id = v_set_id;
    end if;
  end if;

  return jsonb_build_object('status', 'geregistreerd', 'id', v_id,
                            'employee_name', v_performer_name);
end;
$$;

comment on function public.sticker_print(jsonb) is
  'Registreert een sticker. Controleert medewerker, termijnen, bestaande THT/TGT en goedkeuring (leidinggevende kiezen, geen pincode). Dubbel klikken levert geen dubbele registratie op.';

-- 0093_iban_vergelijken_zonder_spaties.sql
-- Een IBAN met spaties ("NL80 RABO 0138 4685 40") en zonder ("NL80RABO0138468540")
-- gaf ten onrechte een IBAN-afwijking. Vergelijk voortaan zonder spaties/hoofdletters.

create or replace function public.match_supplier_from_invoice(
  p_group_id uuid,
  p_vat_number text,
  p_kvk_number text,
  p_iban text,
  p_name text
)
returns table (
  supplier_id uuid,
  supplier_name text,
  match_method text,
  iban_mismatch boolean
)
language plpgsql
stable
as $$
declare
  v_iban text := nullif(upper(regexp_replace(coalesce(p_iban, ''), '\s+', '', 'g')), '');
begin
  if p_vat_number is not null then
    return query
    select s.id, s.name, 'btw_nummer'::text,
      (s.iban is not null and v_iban is not null
        and upper(regexp_replace(s.iban, '\s+', '', 'g')) <> v_iban)
    from public.suppliers s
    where s.group_id = p_group_id and s.vat_number = p_vat_number;
    if found then return; end if;
  end if;

  if p_kvk_number is not null then
    return query
    select s.id, s.name, 'kvk_nummer'::text,
      (s.iban is not null and v_iban is not null
        and upper(regexp_replace(s.iban, '\s+', '', 'g')) <> v_iban)
    from public.suppliers s
    where s.group_id = p_group_id and s.kvk_number = p_kvk_number;
    if found then return; end if;
  end if;

  if v_iban is not null then
    return query
    select s.id, s.name, 'iban'::text, false
    from public.suppliers s
    where s.group_id = p_group_id
      and upper(regexp_replace(coalesce(s.iban, ''), '\s+', '', 'g')) = v_iban;
    if found then return; end if;
  end if;

  if p_name is not null then
    return query
    select s.id, s.name, 'bevestigde_naam'::text, false
    from public.supplier_name_aliases a
    join public.suppliers s on s.id = a.supplier_id
    where a.group_id = p_group_id
      and a.alias_key = trim(regexp_replace(lower(p_name), '[^a-z0-9]+', ' ', 'g'));
    if found then return; end if;

    return query
    select s.id, s.name, 'naam_gelijkenis'::text, false
    from public.suppliers s
    where s.group_id = p_group_id
      and similarity(lower(s.name), lower(p_name)) > 0.4
    order by similarity(lower(s.name), lower(p_name)) desc
    limit 3;
  end if;
end;
$$;

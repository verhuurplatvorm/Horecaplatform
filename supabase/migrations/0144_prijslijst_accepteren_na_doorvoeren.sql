-- 0144: Accepteren pas na doorvoeren.
--
-- Fout in 0142: het overzicht toonde ook de ongewijzigde regels, dus de knop
-- "Accepteren als nieuwe standaard" stond al aan vóór het doorvoeren. Wie
-- dan accepteerde, handelde niets af (er waren nog geen nieuwe prijzen) en
-- zag daarna toch "geaccepteerd".
--
-- * price_import_batch_changes geeft per regel ook: is hij doorgevoerd
--   (applied) en is het alarm afgehandeld (acknowledged). Zo kan het scherm
--   de knop tonen zolang er doorgevoerde prijzen openstaan.
-- * accept_price_import_batch weigert als er nog niets is doorgevoerd.

drop function if exists public.price_import_batch_changes(uuid);
create function public.price_import_batch_changes(p_batch_id uuid)
returns table(
  row_id uuid, product_id uuid, product_name text, article_number text,
  old_price numeric, new_price numeric, diff numeric, diff_pct numeric,
  change_kind text, valid_from date, applied boolean, acknowledged boolean
)
language sql
stable
set search_path to 'public'
as $$
  select
    r.id,
    r.matched_product_id,
    coalesce(nullif(p.custom_name, ''), p.name, r.description),
    r.article_number,
    coalesce(oud.purchase_price, case when r.status = 'ongewijzigd' then r.purchase_price end),
    coalesce(nieuw.purchase_price, r.purchase_price),
    case when oud.purchase_price is not null and nieuw.purchase_price is not null
         then round(nieuw.purchase_price - oud.purchase_price, 4) end,
    case when oud.purchase_price > 0 and nieuw.purchase_price is not null
         then round((nieuw.purchase_price - oud.purchase_price) / oud.purchase_price * 100, 2) end,
    case
      when r.status = 'ongewijzigd' then 'gelijk'
      when oud.purchase_price is null then 'nieuw'
      when nieuw.purchase_price > oud.purchase_price then 'hoger'
      when nieuw.purchase_price < oud.purchase_price then 'lager'
      else 'gelijk'
    end,
    nieuw.valid_from,
    (r.status = 'toegepast'),
    exists (select 1 from public.dismissed_price_alerts d where d.supplier_product_id = r.resulting_supplier_product_id)
  from public.price_import_rows r
  left join public.products p on p.id = r.matched_product_id
  left join public.supplier_products nieuw on nieuw.id = r.resulting_supplier_product_id
  left join public.supplier_products oud on oud.id = r.reopened_supplier_product_id
  where r.batch_id = p_batch_id
    and r.matched_product_id is not null
    and (r.status = 'ongewijzigd' or (r.status = 'toegepast' and r.resulting_supplier_product_id is not null));
$$;
grant execute on function public.price_import_batch_changes(uuid) to authenticated;

create or replace function public.accept_price_import_batch(p_batch_id uuid)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  v_batch record;
  v_count integer;
begin
  select id, group_id, supplier_id, company_id, source_kind
  into v_batch
  from public.price_import_batches
  where id = p_batch_id;
  if not found then
    raise exception 'Prijslijst niet gevonden.';
  end if;

  if not exists (select 1 from public.price_import_rows r
                  where r.batch_id = p_batch_id and r.status = 'toegepast'
                    and r.resulting_supplier_product_id is not null) then
    raise exception 'Voer eerst de prijzen door; daarna kun je de lijst accepteren.';
  end if;

  with nieuw as (
    select sp.id, sp.product_id, sp.valid_from
    from public.price_import_rows r
    join public.supplier_products sp on sp.id = r.resulting_supplier_product_id
    where r.batch_id = p_batch_id and r.status = 'toegepast'
  ),
  te_accepteren as (
    select n.id from nieuw n
    union
    select sp.id
    from nieuw n
    join public.supplier_products sp
      on sp.product_id = n.product_id
     and sp.supplier_id = v_batch.supplier_id
     and sp.company_id is not distinct from v_batch.company_id
     and sp.valid_from <= n.valid_from
  ),
  ins as (
    insert into public.dismissed_price_alerts (supplier_product_id, group_id, reason, batch_id)
    select t.id, v_batch.group_id, 'prijslijst_geaccepteerd', p_batch_id
    from te_accepteren t
    on conflict (supplier_product_id) do nothing
    returning 1
  )
  select count(*) into v_count from ins;

  update public.price_import_batches
     set accepted_at = now(), accepted_by = auth.uid()
   where id = p_batch_id;

  return v_count;
end;
$$;
grant execute on function public.accept_price_import_batch(uuid) to authenticated;

-- Een factuur waarvan alle regels verwerkt zijn (toegepast, ongewijzigd of
-- overgeslagen) bleef op "wacht op controle" staan als de laatste regel los
-- werd afgehandeld (bv. handmatig gekoppeld en doorgevoerd). Het scherm
-- toonde dan "0 prijzen doorvoeren" zonder iets te controleren.
-- Nu rondt de database zo'n factuur zelf af. Prijzen veranderen hierdoor
-- niet: alleen de status van de factuur.
create or replace function public.close_invoice_batch_when_done(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.price_import_batches b
     set status = 'toegepast',
         completed_at = coalesce(b.completed_at, now()),
         applied_rows = (select count(*) from public.price_import_rows r
                          where r.batch_id = b.id and r.status in ('toegepast', 'ongewijzigd'))
   where b.id = p_batch_id
     and b.status = 'wacht_op_controle'
     and exists (select 1 from public.price_import_rows r where r.batch_id = b.id)
     and not exists (select 1 from public.price_import_rows r
                      where r.batch_id = b.id
                        and r.status in ('gematcht', 'niet_gematcht', 'fout'));
end;
$$;

create or replace function public.trg_close_invoice_batch_when_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.close_invoice_batch_when_done(coalesce(new.batch_id, old.batch_id));
  return null;
end;
$$;

drop trigger if exists price_import_rows_close_batch on public.price_import_rows;
create trigger price_import_rows_close_batch
  after update of status or delete on public.price_import_rows
  for each row execute function public.trg_close_invoice_batch_when_done();

-- Bestaande facturen die al helemaal verwerkt zijn, nu afronden.
select public.close_invoice_batch_when_done(b.id)
  from public.price_import_batches b
 where b.status = 'wacht_op_controle';

-- 0094_prijsimport_tellers_actueel.sql
-- De tellers total_rows / matched_rows / unmatched_rows van een importbatch
-- werden alleen bij het aanmaken gezet. Na het verwijderen of koppelen van
-- regels bleef de lijst "x van y niet gekoppeld" dus oud. Nu houdt een trigger
-- ze bij.

create or replace function public.refresh_price_import_batch_counts(p_batch_id uuid)
returns void
language sql
as $$
  update public.price_import_batches b
  set total_rows = c.total,
      matched_rows = c.matched,
      unmatched_rows = c.total - c.matched
  from (
    select count(*)::int as total,
           count(*) filter (where matched_product_id is not null)::int as matched
    from public.price_import_rows
    where batch_id = p_batch_id
  ) c
  where b.id = p_batch_id;
$$;

create or replace function public.trg_price_import_rows_counts()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_price_import_batch_counts(new.batch_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.batch_id is distinct from new.batch_id) then
    perform public.refresh_price_import_batch_counts(old.batch_id);
  end if;
  return null;
end;
$$;

drop trigger if exists price_import_rows_counts on public.price_import_rows;
create trigger price_import_rows_counts
after insert or update of matched_product_id, batch_id or delete on public.price_import_rows
for each row execute function public.trg_price_import_rows_counts();

-- Bestaande batches in één keer rechtzetten.
update public.price_import_batches b
set total_rows = c.total,
    matched_rows = c.matched,
    unmatched_rows = c.total - c.matched
from (
  select batch_id, count(*)::int as total,
         count(*) filter (where matched_product_id is not null)::int as matched
  from public.price_import_rows group by batch_id
) c
where b.id = c.batch_id;

-- 0010_rls_price_imports.sql
-- Row Level Security voor de prijsimport-tabellen: alleen zichtbaar/
-- muteerbaar voor gebruikers met toegang tot het betrokken bedrijf (of
-- de groep, voor groepsbrede leveranciersprijzen).

alter table public.supplier_price_sources enable row level security;
alter table public.price_import_batches enable row level security;
alter table public.price_import_rows enable row level security;

-- Prijsbronnen volgen de leverancier: groepsbrede leverancier (company_id
-- null) -> zichtbaar voor iedereen in de groep; lokale leverancier ->
-- alleen voor dat bedrijf.
create policy supplier_price_sources_select on public.supplier_price_sources
  for select using (
    exists (
      select 1 from public.suppliers s
      where s.id = supplier_price_sources.supplier_id
        and (
          (s.company_id is null and s.group_id = public.current_user_group_id())
          or public.has_company_access(s.company_id)
        )
    )
  );

create policy supplier_price_sources_write on public.supplier_price_sources
  for all using (
    exists (
      select 1 from public.suppliers s
      where s.id = supplier_price_sources.supplier_id
        and (
          (s.company_id is null and public.is_group_admin())
          or public.has_company_access(s.company_id)
        )
    )
  )
  with check (
    exists (
      select 1 from public.suppliers s
      where s.id = supplier_price_sources.supplier_id
        and (
          (s.company_id is null and public.is_group_admin())
          or public.has_company_access(s.company_id)
        )
    )
  );

create policy price_import_batches_select on public.price_import_batches
  for select using (
    (company_id is null and group_id = public.current_user_group_id())
    or public.has_company_access(company_id)
  );

create policy price_import_batches_write on public.price_import_batches
  for all using (
    (company_id is null and public.is_group_admin())
    or public.has_company_access(company_id)
  )
  with check (
    (company_id is null and public.is_group_admin())
    or public.has_company_access(company_id)
  );

create policy price_import_rows_select on public.price_import_rows
  for select using (
    exists (
      select 1 from public.price_import_batches b
      where b.id = price_import_rows.batch_id
        and (
          (b.company_id is null and b.group_id = public.current_user_group_id())
          or public.has_company_access(b.company_id)
        )
    )
  );

create policy price_import_rows_write on public.price_import_rows
  for all using (
    exists (
      select 1 from public.price_import_batches b
      where b.id = price_import_rows.batch_id
        and (
          (b.company_id is null and public.is_group_admin())
          or public.has_company_access(b.company_id)
        )
    )
  )
  with check (
    exists (
      select 1 from public.price_import_batches b
      where b.id = price_import_rows.batch_id
        and (
          (b.company_id is null and public.is_group_admin())
          or public.has_company_access(b.company_id)
        )
    )
  );

-- Auditlog ook op prijsimport-batches, zodat te herleiden is wie welke
-- prijzen wanneer heeft binnengehaald (spec §32).
create trigger trg_audit_price_import_batches
  after insert or update or delete on public.price_import_batches
  for each row execute function public.audit_row_change();

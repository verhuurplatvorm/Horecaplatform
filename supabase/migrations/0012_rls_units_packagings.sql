-- 0012_rls_units_packagings.sql

-- Units zijn systeembrede referentiedata (net als een vaste enum-lijst),
-- niet per-groep data. Iedere ingelogde gebruiker mag ze lezen; wijzigen
-- gebeurt alleen via migraties, niet via de applicatie.
alter table public.units enable row level security;

create policy units_select_authenticated on public.units
  for select using (auth.role() = 'authenticated');

-- product_packagings volgt dezelfde zichtbaarheid als het product zelf
-- (groepsbreed, net als products_select in 0007_rls_policies.sql).
alter table public.product_packagings enable row level security;

create policy product_packagings_select on public.product_packagings
  for select using (
    exists (
      select 1 from public.products p
      where p.id = product_packagings.product_id
        and p.group_id = public.current_user_group_id()
        and (
          public.is_group_admin()
          or exists (
            select 1 from public.user_company_access uca
            join public.companies c on c.id = uca.company_id
            where uca.user_id = auth.uid() and c.group_id = p.group_id
          )
        )
    )
  );

create policy product_packagings_write on public.product_packagings
  for all using (
    exists (
      select 1 from public.products p
      where p.id = product_packagings.product_id
        and p.group_id = public.current_user_group_id()
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = product_packagings.product_id
        and p.group_id = public.current_user_group_id()
    )
  );

create trigger trg_audit_products
  after insert or update or delete on public.products
  for each row execute function public.audit_row_change();

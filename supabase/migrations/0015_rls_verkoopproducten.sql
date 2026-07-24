-- 0015_rls_verkoopproducten.sql

alter table public.sales_products enable row level security;
alter table public.sales_product_components enable row level security;

create policy sales_products_select on public.sales_products
  for select using (public.has_company_access(company_id));

create policy sales_products_write on public.sales_products
  for all using (public.has_company_access(company_id))
  with check (public.has_company_access(company_id));

create policy sales_product_components_select on public.sales_product_components
  for select using (
    exists (
      select 1 from public.sales_products sp
      where sp.id = sales_product_components.sales_product_id
        and public.has_company_access(sp.company_id)
    )
  );

create policy sales_product_components_write on public.sales_product_components
  for all using (
    exists (
      select 1 from public.sales_products sp
      where sp.id = sales_product_components.sales_product_id
        and public.has_company_access(sp.company_id)
    )
  )
  with check (
    exists (
      select 1 from public.sales_products sp
      where sp.id = sales_product_components.sales_product_id
        and public.has_company_access(sp.company_id)
    )
  );

create trigger trg_audit_sales_products
  after insert or update or delete on public.sales_products
  for each row execute function public.audit_row_change();

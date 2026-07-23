-- 0006_audit_log.sql
-- Auditlogging (spec §32, §36-14): gebruiker, datum/tijd, oude/nieuwe
-- waarde, betrokken bedrijf worden vastgelegd bij belangrijke wijzigingen.

create table public.audit_log (
  id           bigint generated always as identity primary key,
  group_id     uuid,
  company_id   uuid,
  table_name   text not null,
  record_id    uuid,
  action       text not null check (action in ('insert', 'update', 'delete')),
  old_data     jsonb,
  new_data     jsonb,
  changed_by   uuid references public.user_profiles(id),
  changed_at   timestamptz not null default now()
);

create index idx_audit_log_table_record on public.audit_log(table_name, record_id);
create index idx_audit_log_company on public.audit_log(company_id);
create index idx_audit_log_changed_at on public.audit_log(changed_at);

-- Generieke audit-trigger. Wordt per gevoelige tabel gekoppeld
-- (kostprijzen, verkoopprijzen, contracten, gebruikersrechten, ...).
-- Verwacht dat de tabel een company_id kolom heeft; indien niet
-- aanwezig wordt company_id als null gelogd.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_record_id uuid;
begin
  begin
    v_company_id := (case when TG_OP = 'DELETE' then old else new end).company_id;
  exception when undefined_column then
    v_company_id := null;
  end;

  begin
    v_record_id := (case when TG_OP = 'DELETE' then old else new end).id;
  exception when undefined_column then
    v_record_id := null;
  end;

  insert into public.audit_log (
    group_id, company_id, table_name, record_id, action,
    old_data, new_data, changed_by
  ) values (
    public.current_user_group_id(),
    v_company_id,
    TG_TABLE_NAME,
    v_record_id,
    lower(TG_OP),
    case when TG_OP in ('update','delete') then to_jsonb(old) else null end,
    case when TG_OP in ('update','insert') then to_jsonb(new) else null end,
    auth.uid()
  );

  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;

comment on function public.audit_row_change() is
  'Generieke auditlog-trigger; koppel per tabel die auditbaar moet zijn (bv. supplier_products, recipes, role_permissions, user_company_access).';

-- Koppel auditlogging aan de gevoeligste tabellen uit fase 1.
create trigger trg_audit_supplier_products
  after insert or update or delete on public.supplier_products
  for each row execute function public.audit_row_change();

create trigger trg_audit_recipes
  after insert or update or delete on public.recipes
  for each row execute function public.audit_row_change();

create trigger trg_audit_role_permissions
  after insert or update or delete on public.role_permissions
  for each row execute function public.audit_row_change();

create trigger trg_audit_user_company_access
  after insert or update or delete on public.user_company_access
  for each row execute function public.audit_row_change();

create trigger trg_audit_companies
  after insert or update or delete on public.companies
  for each row execute function public.audit_row_change();

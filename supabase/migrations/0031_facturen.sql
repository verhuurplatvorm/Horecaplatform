-- 0031_facturen.sql
-- Facturen hergebruiken bewust de bestaande prijsimport-machine
-- (price_import_batches/price_import_rows, matching, controlescherm,
-- impact-preview) in plaats van een evenwijdig systeem te bouwen — een
-- factuur is voor de kostprijsberekening in essentie een prijslijst met
-- een paar extra factuurvelden.

alter table public.suppliers
  add column vat_number text,
  add column kvk_number text,
  add column iban text,
  add column iban_verified_at timestamptz;

comment on column public.suppliers.iban is
  'Laatst bekende/geverifieerde IBAN van deze leverancier — gebruikt om te waarschuwen wanneer een nieuwe factuur een ANDER rekeningnummer vermeldt (spec §20: bekend fraudepatroon, nooit automatisch accepteren).';

create index idx_suppliers_vat_number on public.suppliers(vat_number) where vat_number is not null;
create index idx_suppliers_kvk_number on public.suppliers(kvk_number) where kvk_number is not null;

alter table public.price_import_batches
  add column source_kind text not null default 'prijslijst',
  add column invoice_number text,
  add column invoice_date date,
  add column due_date date,
  add column supplier_vat_number_on_invoice text,
  add column supplier_kvk_number_on_invoice text,
  add column supplier_iban_on_invoice text,
  add column iban_mismatch boolean not null default false,
  add column total_incl_vat numeric(12,2),
  add column original_file_path text;

comment on column public.price_import_batches.iban_mismatch is
  'True wanneer het IBAN op deze factuur afwijkt van het laatst bekende IBAN van de leverancier. Moet expliciet bevestigd worden vóór verwerking.';

create extension if not exists pg_trgm;

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
begin
  if p_vat_number is not null then
    return query
    select s.id, s.name, 'btw_nummer'::text, (s.iban is not null and p_iban is not null and s.iban is distinct from p_iban)
    from public.suppliers s
    where s.group_id = p_group_id and s.vat_number = p_vat_number;
    if found then return; end if;
  end if;

  if p_kvk_number is not null then
    return query
    select s.id, s.name, 'kvk_nummer'::text, (s.iban is not null and p_iban is not null and s.iban is distinct from p_iban)
    from public.suppliers s
    where s.group_id = p_group_id and s.kvk_number = p_kvk_number;
    if found then return; end if;
  end if;

  if p_iban is not null then
    return query
    select s.id, s.name, 'iban'::text, false
    from public.suppliers s
    where s.group_id = p_group_id and s.iban = p_iban;
    if found then return; end if;
  end if;

  if p_name is not null then
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

comment on function public.match_supplier_from_invoice(uuid, text, text, text, text) is
  'Herkent een leverancier op een factuur (spec §3). Geeft bij twijfel meerdere kandidaten terug i.p.v. automatisch te kiezen.';

insert into storage.buckets (id, name, public)
values ('facturen', 'facturen', false)
on conflict (id) do nothing;

create policy "facturen_select_eigen_groep"
  on storage.objects for select
  using (
    bucket_id = 'facturen'
    and (storage.foldername(name))[1] = public.current_user_group_id()::text
  );

create policy "facturen_insert_eigen_groep"
  on storage.objects for insert
  with check (
    bucket_id = 'facturen'
    and (storage.foldername(name))[1] = public.current_user_group_id()::text
  );

-- ---------------------------------------------------------------------
-- Postvak-in voor inkomende e-mailfacturen (spec §1). Eén of meerdere
-- mailboxen per groep, elk met een geheim webhook-token — dat token
-- (niet een gewoon wachtwoord) is de enige beveiliging van het
-- webhook-endpoint, dus geheimhouden zoals een API-sleutel.
-- ---------------------------------------------------------------------
create table public.invoice_mailboxes (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  company_id    uuid references public.companies(id) on delete cascade, -- null = groepsbreed
  label         text not null,
  webhook_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table public.invoice_mailboxes enable row level security;

create policy invoice_mailboxes_select on public.invoice_mailboxes
  for select using (
    (company_id is null and group_id = public.current_user_group_id())
    or public.has_company_access(company_id)
  );

create policy invoice_mailboxes_write on public.invoice_mailboxes
  for all using (public.is_group_admin())
  with check (public.is_group_admin());

-- E-mailbijlagen waarvan de leverancier niet met zekerheid herkend kon
-- worden, komen hier terecht i.p.v. direct een prijsimport-batch aan te
-- maken (die vereist een bekende supplier_id) — een gebruiker rondt de
-- verwerking af via dezelfde "leverancier bevestigen"-stap als bij
-- handmatig uploaden.
create table public.inbound_invoice_queue (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.groups(id) on delete cascade,
  mailbox_id        uuid references public.invoice_mailboxes(id) on delete set null,
  company_id        uuid references public.companies(id) on delete set null,
  sender_email      text,
  original_filename text not null,
  storage_path      text not null,
  file_kind         text not null, -- 'ubl' | 'pdf' | 'onbekend'
  parsed_header     jsonb,
  parsed_lines      jsonb,
  supplier_candidates jsonb not null default '[]'::jsonb,
  status            text not null default 'wacht_op_leverancier', -- wacht_op_leverancier | verwerkt | afgewezen
  resulting_batch_id uuid references public.price_import_batches(id) on delete set null,
  received_at       timestamptz not null default now()
);

alter table public.inbound_invoice_queue enable row level security;

create policy inbound_invoice_queue_select on public.inbound_invoice_queue
  for select using (
    (company_id is null and group_id = public.current_user_group_id())
    or public.has_company_access(company_id)
  );

create policy inbound_invoice_queue_write on public.inbound_invoice_queue
  for all using (
    (company_id is null and group_id = public.current_user_group_id())
    or public.has_company_access(company_id)
  )
  with check (
    (company_id is null and group_id = public.current_user_group_id())
    or public.has_company_access(company_id)
  );

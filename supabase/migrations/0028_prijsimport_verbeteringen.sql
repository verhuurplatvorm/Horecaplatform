-- 0028_prijsimport_verbeteringen.sql
-- Ondersteunt twee verbeteringen aan de prijsimport:
-- 1. Opgeslagen kolomindeling per leverancier (spec §4/§19) — bij een
--    volgende import van dezelfde leverancier hoeft de gebruiker de
--    kolommen niet opnieuw te koppelen.
-- 2. Import ongedaan maken (spec §22) — daarvoor moet elke toegepaste
--    regel weten welke supplier_products-rij eruit is ontstaan, en welke
--    rij daarvoor "open" stond (om die weer te heropenen).

create table public.supplier_import_templates (
  supplier_id      uuid primary key references public.suppliers(id) on delete cascade,
  column_mapping   jsonb not null default '{}'::jsonb,
  decimal_separator text not null default ',',
  updated_at       timestamptz not null default now()
);

comment on table public.supplier_import_templates is
  'Onthouden kolomkoppeling per leverancier (spec §4/§19), automatisch voorgesteld bij de volgende import van dezelfde leverancier.';

alter table public.price_import_rows
  add column resulting_supplier_product_id uuid references public.supplier_products(id) on delete set null,
  add column reopened_supplier_product_id uuid references public.supplier_products(id) on delete set null,
  add column match_confidence text,
  add column suggested_product_ids uuid[] not null default '{}';

comment on column public.price_import_rows.match_confidence is
  'gekoppeld / waarschijnlijk / nieuw / mogelijk_dubbel (spec §7) — nooit automatisch gekoppeld tenzij "gekoppeld".';
comment on column public.price_import_rows.suggested_product_ids is
  'Tot 3 kandidaat-producten bij een onzekere match (spec §8), voor één-klikbevestiging door de gebruiker.';

comment on column public.price_import_rows.resulting_supplier_product_id is
  'De supplier_products-rij die is aangemaakt toen deze importregel werd toegepast — nodig om de import ongedaan te kunnen maken.';
comment on column public.price_import_rows.reopened_supplier_product_id is
  'De supplier_products-rij die vóór deze toepassing "open" stond en werd afgesloten — wordt bij een rollback weer heropend.';

create or replace function public.apply_price_import_row(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.price_import_rows%rowtype;
  v_batch public.price_import_batches%rowtype;
  v_reopened_id uuid;
  v_new_id uuid;
begin
  select * into v_row from public.price_import_rows where id = p_row_id;
  if v_row.matched_product_id is null then
    raise exception 'Kan regel % niet toepassen: geen gekoppeld product', p_row_id;
  end if;

  if v_row.packaging_unit_count is null or v_row.packaging_unit_count <= 0 then
    raise exception 'Kan regel % niet toepassen: verpakkingshoeveelheid ontbreekt.', p_row_id;
  end if;

  select * into v_batch from public.price_import_batches where id = v_row.batch_id;

  select id into v_reopened_id
  from public.supplier_products
  where supplier_id = v_batch.supplier_id
    and product_id = v_row.matched_product_id
    and company_id is not distinct from v_batch.company_id
    and valid_to is null;

  if v_reopened_id is not null then
    update public.supplier_products
    set valid_to = current_date - interval '1 day'
    where id = v_reopened_id;
  end if;

  insert into public.supplier_products (
    supplier_id, product_id, company_id, supplier_article_code,
    packaging_description, packaging_unit_count, purchase_price,
    is_contract_price, valid_from
  ) values (
    v_batch.supplier_id, v_row.matched_product_id, v_batch.company_id, v_row.article_number,
    v_row.packaging_description, v_row.packaging_unit_count, v_row.purchase_price,
    false, current_date
  )
  returning id into v_new_id;

  update public.price_import_rows
  set status = 'toegepast',
      resulting_supplier_product_id = v_new_id,
      reopened_supplier_product_id = v_reopened_id
  where id = p_row_id;
end;
$$;

create or replace function public.rollback_price_import_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  for v_row in
    select id, resulting_supplier_product_id, reopened_supplier_product_id
    from public.price_import_rows
    where batch_id = p_batch_id and status = 'toegepast'
  loop
    if v_row.resulting_supplier_product_id is not null then
      delete from public.supplier_products where id = v_row.resulting_supplier_product_id;
    end if;
    if v_row.reopened_supplier_product_id is not null then
      update public.supplier_products
      set valid_to = null
      where id = v_row.reopened_supplier_product_id;
    end if;

    update public.price_import_rows
    set status = 'gematcht',
        resulting_supplier_product_id = null,
        reopened_supplier_product_id = null
    where id = v_row.id;
  end loop;

  update public.price_import_batches
  set status = 'wacht_op_controle', applied_rows = 0, completed_at = null
  where id = p_batch_id;
end;
$$;

comment on function public.rollback_price_import_batch(uuid) is
  'Maakt een toegepaste prijsimport-batch ongedaan: verwijdert de nieuw aangemaakte prijzen en heropent de prijzen die de import had afgesloten. Historische data van vóór de import blijft altijd bewaard.';

alter table public.supplier_import_templates enable row level security;

create policy supplier_import_templates_select on public.supplier_import_templates
  for select using (
    exists (
      select 1 from public.suppliers s
      where s.id = supplier_import_templates.supplier_id
        and (
          (s.company_id is null and s.group_id = public.current_user_group_id())
          or public.has_company_access(s.company_id)
        )
    )
  );

create policy supplier_import_templates_write on public.supplier_import_templates
  for all using (
    exists (
      select 1 from public.suppliers s
      where s.id = supplier_import_templates.supplier_id
        and (
          (s.company_id is null and public.is_group_admin())
          or public.has_company_access(s.company_id)
        )
    )
  )
  with check (
    exists (
      select 1 from public.suppliers s
      where s.id = supplier_import_templates.supplier_id
        and (
          (s.company_id is null and public.is_group_admin())
          or public.has_company_access(s.company_id)
        )
    )
  );

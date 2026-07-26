-- 0024_productiestickers.sql
-- Productiestickers voor halfproducten (spec §14). Een sticker-afdruk is
-- altijd gekoppeld aan een productieboeking (stock_movements met
-- movement_type = 'productie', al aanwezig sinds 0022). Een herdruk
-- maakt geen nieuwe productieboeking aan, maar een nieuwe
-- production_labels-rij die naar dezelfde stock_movement èn naar de
-- vorige label-rij verwijst (spec §14.12/§14.13).

create table public.label_settings (
  group_id       uuid primary key references public.groups(id) on delete cascade,
  default_format text not null default '62x100mm',
  font_scale     numeric(3,2) not null default 1.0,
  show_logo      boolean not null default false,
  show_qr        boolean not null default true,
  visible_fields jsonb not null default '["naam","geproduceerd_door","productiedatum","houdbaar_tot","bewaren","allergenen","hoeveelheid","batchnummer","extra_tekst"]'::jsonb,
  updated_at     timestamptz not null default now()
);

comment on table public.label_settings is
  'Eén rij per groep met standaardinstellingen voor productiestickers (spec §14.9). Locatie-specifieke afwijkingen kunnen later als aparte rijen per company_id worden toegevoegd.';

create table public.production_labels (
  id                    uuid primary key default gen_random_uuid(),
  stock_movement_id     uuid not null references public.stock_movements(id) on delete cascade,
  produced_by_user_ids  uuid[] not null default '{}',
  produced_by_manual_names text[] not null default '{}',
  production_at         timestamptz not null default now(),
  expiry_at             date,
  expiry_manually_set    boolean not null default false,
  extra_text            text,
  sticker_format        text not null default '62x100mm',
  sticker_count          integer not null default 1,
  printed_by            uuid references public.user_profiles(id),
  printed_at            timestamptz not null default now(),
  reprint_of            uuid references public.production_labels(id) on delete set null,
  reprint_reason        text,
  created_at            timestamptz not null default now(),
  constraint chk_reprint_reason check (
    reprint_of is null or reprint_reason is not null
  )
);

create index idx_production_labels_movement on public.production_labels(stock_movement_id);
create index idx_production_labels_reprint_of on public.production_labels(reprint_of);

comment on table public.production_labels is
  'Eén rij per stickerafdruk (spec §14.12/§14.13). De eerste afdruk van een productie heeft reprint_of = null; iedere volgende afdruk van dezelfde batch is een herdruk met verplichte reden, gekoppeld aan dezelfde stock_movement.';
comment on column public.production_labels.expiry_manually_set is
  'True als de houdbaarheidsdatum handmatig is overschreven i.p.v. automatisch berekend (spec §14.5) — zichtbaar in de auditlog via de generieke trigger.';

alter table public.label_settings enable row level security;
alter table public.production_labels enable row level security;

create policy label_settings_select on public.label_settings
  for select using (group_id = public.current_user_group_id());

create policy label_settings_write on public.label_settings
  for all using (public.is_group_admin())
  with check (public.is_group_admin());

create policy production_labels_select on public.production_labels
  for select using (
    exists (
      select 1 from public.stock_movements sm
      where sm.id = production_labels.stock_movement_id
        and public.has_company_access(sm.company_id)
    )
  );

create policy production_labels_write on public.production_labels
  for all using (
    exists (
      select 1 from public.stock_movements sm
      where sm.id = production_labels.stock_movement_id
        and public.has_company_access(sm.company_id)
    )
  )
  with check (
    exists (
      select 1 from public.stock_movements sm
      where sm.id = production_labels.stock_movement_id
        and public.has_company_access(sm.company_id)
    )
  );

create trigger trg_audit_production_labels
  after insert or update or delete on public.production_labels
  for each row execute function public.audit_row_change();

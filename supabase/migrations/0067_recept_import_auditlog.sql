-- 0067_recept_import_auditlog.sql
--
-- Vastleggen wat een recepten-import precies gedaan heeft, zodat een
-- foutieve import in zijn geheel teruggedraaid kan worden.
--
-- Hergebruikt het bestaande import-patroon (zoals price_import_batches)
-- en de bestaande tabellen: er worden geen recepten of ingrediënten
-- gedupliceerd, alleen vastgelegd wélke records door welke import zijn
-- aangemaakt of bijgewerkt.

create type public.recipe_import_status as enum ('voorbereid', 'uitgevoerd', 'teruggedraaid');

create table public.recipe_import_batches (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.groups(id) on delete cascade,
  company_id        uuid references public.companies(id) on delete set null,
  file_name         text not null,
  -- Het originele bestand, zodat altijd te herleiden is wat er ingelezen is.
  file_content      bytea,
  file_size         integer,
  status            public.recipe_import_status not null default 'voorbereid',
  rows_total        integer not null default 0,
  rows_imported     integer not null default 0,
  rows_skipped      integer not null default 0,
  rows_failed       integer not null default 0,
  -- Foutmeldingen en de gemaakte koppelingen (welke brontekst aan welk
  -- ingrediënt is gekoppeld), als leesbaar overzicht achteraf.
  errors            jsonb not null default '[]'::jsonb,
  mappings          jsonb not null default '[]'::jsonb,
  imported_by       uuid references public.user_profiles(id),
  imported_at       timestamptz not null default now(),
  rolled_back_at    timestamptz,
  rolled_back_by    uuid references public.user_profiles(id)
);

create index idx_recipe_import_batches_group on public.recipe_import_batches(group_id);

-- Welke recepten deze import heeft aangemaakt of bijgewerkt. Alleen
-- aangemaakte recepten worden bij terugdraaien verwijderd; bijgewerkte
-- recepten bestonden al en blijven staan.
create table public.recipe_import_records (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references public.recipe_import_batches(id) on delete cascade,
  recipe_id       uuid references public.recipes(id) on delete set null,
  source_row      integer,
  source_external_id text,
  source_name     text,
  action          text not null check (action in ('aangemaakt', 'bijgewerkt', 'overgeslagen')),
  -- Brondata uit het Excel-bestand, ter vergelijking bewaard. Onze eigen
  -- kostprijsberekening blijft leidend en gebruikt dit nooit.
  source_data     jsonb
);

create index idx_recipe_import_records_batch on public.recipe_import_records(batch_id);
create index idx_recipe_import_records_recipe on public.recipe_import_records(recipe_id);

-- ---------------------------------------------------------------------
-- Terugdraaien: verwijdert alleen wat deze import zelf heeft aangemaakt.
-- ---------------------------------------------------------------------
create or replace function public.rollback_recipe_import(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.recipe_import_status;
  v_deleted integer := 0;
  v_blocked integer := 0;
  v_rec record;
begin
  select status into v_status from public.recipe_import_batches where id = p_batch_id;
  if v_status is null then
    raise exception 'Import % bestaat niet.', p_batch_id;
  end if;
  if v_status = 'teruggedraaid' then
    raise exception 'Deze import is al teruggedraaid.';
  end if;

  for v_rec in
    select r.id as record_id, r.recipe_id
    from public.recipe_import_records r
    where r.batch_id = p_batch_id and r.action = 'aangemaakt' and r.recipe_id is not null
  loop
    -- Recepten die inmiddels ergens gebruikt worden niet weggooien; dat
    -- zou een gerecht onder een menukaart vandaan trekken.
    if exists (select 1 from public.menu_items where recipe_id = v_rec.recipe_id)
       or exists (select 1 from public.recipe_ingredients where sub_recipe_id = v_rec.recipe_id)
       or exists (select 1 from public.sales_product_components where recipe_id = v_rec.recipe_id)
    then
      v_blocked := v_blocked + 1;
      continue;
    end if;

    delete from public.recipes where id = v_rec.recipe_id;
    v_deleted := v_deleted + 1;
  end loop;

  update public.recipe_import_batches
  set status = 'teruggedraaid',
      rolled_back_at = now(),
      errors = errors || jsonb_build_object(
        'rollback',
        format('%s recept(en) verwijderd, %s overgeslagen omdat ze inmiddels in gebruik zijn.',
               v_deleted, v_blocked)
      )
  where id = p_batch_id;

  return v_deleted;
end;
$$;

comment on function public.rollback_recipe_import(uuid) is
  'Draait een recepten-import terug: verwijdert de recepten die deze import zelf heeft aangemaakt. Bijgewerkte recepten en recepten die inmiddels ergens gebruikt worden blijven staan. Geeft het aantal verwijderde recepten terug.';

alter table public.recipe_import_batches enable row level security;
alter table public.recipe_import_records enable row level security;

create policy recipe_import_batches_all on public.recipe_import_batches
  for all using (group_id = public.current_user_group_id())
  with check (group_id = public.current_user_group_id());

create policy recipe_import_records_all on public.recipe_import_records
  for all using (
    exists (
      select 1 from public.recipe_import_batches b
      where b.id = batch_id and b.group_id = public.current_user_group_id()
    )
  )
  with check (
    exists (
      select 1 from public.recipe_import_batches b
      where b.id = batch_id and b.group_id = public.current_user_group_id()
    )
  );

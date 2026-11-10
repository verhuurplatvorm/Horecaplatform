-- 0114_haccp_controle_afwijkingen.sql
--
-- HACCP → Schoonmaak & Controle, stap 3.
-- * Controle door leidinggevende: akkoord / afgekeurd per afgemelde taak
--   (alleen voor taken met requires_check). Afkeuren maakt een afwijking.
-- * Afwijkingen met corrigerende maatregelen:
--   gemeld → maatregel (+ verantwoordelijke) → opgelost → afgesloten.
--   Elke stap is een aparte registratie (alleen toevoegen).
-- * Foto's (optioneel) bij een taak of afwijking, in privé-bucket "haccp".
--   Foto's kunnen niet worden vervangen of verwijderd.
-- Volledig additief.

-- 1. Controle-status op het moment (afgeleid van haccp_events)
alter table public.haccp_occurrences
  add column if not exists check_status text check (check_status in ('akkoord', 'afgekeurd')),
  add column if not exists checked_at timestamptz,
  add column if not exists checked_by uuid references public.user_profiles(id);

-- 2. Afwijkingen
create table if not exists public.haccp_deviations (
  id                 uuid primary key,
  group_id           uuid not null references public.groups(id) on delete restrict,
  company_id         uuid not null references public.companies(id) on delete restrict,
  occurrence_id      uuid references public.haccp_occurrences(id) on delete restrict,
  task_id            uuid references public.haccp_tasks(id) on delete restrict,
  area_id            uuid references public.haccp_areas(id) on delete restrict,
  description        text not null check (length(trim(description)) > 0),
  status             text not null default 'open'
                       check (status in ('open', 'in_behandeling', 'opgelost', 'afgesloten')),
  reported_by        uuid references public.user_profiles(id),
  reported_at        timestamptz not null default now(),
  corrective_action  text,
  responsible_id     uuid references public.user_profiles(id),
  resolution         text,
  resolved_by        uuid references public.user_profiles(id),
  resolved_at        timestamptz,
  closed_by          uuid references public.user_profiles(id),
  closed_at          timestamptz,
  updated_at         timestamptz not null default now()
);

create index if not exists haccp_deviations_company_status_idx
  on public.haccp_deviations (company_id, status, reported_at desc);

comment on table public.haccp_deviations is
  'Afwijkingen bij schoonmaak (probleem gemeld of controle afgekeurd). Velden zijn een samenvatting; de volledige geschiedenis staat in haccp_deviation_events. Wijzigen alleen via de haccp_deviation_*-functies.';

create table if not exists public.haccp_deviation_events (
  id            uuid primary key,
  deviation_id  uuid not null references public.haccp_deviations(id) on delete restrict,
  company_id    uuid not null references public.companies(id) on delete restrict,
  event_type    text not null check (event_type in (
                  'gemeld', 'maatregel', 'opgelost', 'afgesloten', 'heropend', 'opmerking')),
  performed_by  uuid references public.user_profiles(id),
  recorded_by   uuid default auth.uid() references public.user_profiles(id),
  recorded_at   timestamptz not null default now(),
  note          text,
  details       jsonb
);

create index if not exists haccp_deviation_events_dev_idx
  on public.haccp_deviation_events (deviation_id, recorded_at);

create or replace trigger trg_haccp_deviation_events_block
  before update or delete on public.haccp_deviation_events
  for each row execute function public.haccp_block_change();

-- 3. Foto's
create table if not exists public.haccp_photos (
  id             uuid primary key,
  company_id     uuid not null references public.companies(id) on delete restrict,
  occurrence_id  uuid references public.haccp_occurrences(id) on delete restrict,
  deviation_id   uuid references public.haccp_deviations(id) on delete restrict,
  storage_path   text not null unique,
  taken_by       uuid references public.user_profiles(id),
  recorded_by    uuid default auth.uid() references public.user_profiles(id),
  recorded_at    timestamptz not null default now(),
  note           text,
  check (occurrence_id is not null or deviation_id is not null)
);

create index if not exists haccp_photos_occ_idx on public.haccp_photos (occurrence_id);
create index if not exists haccp_photos_dev_idx on public.haccp_photos (deviation_id);

create or replace trigger trg_haccp_photos_block
  before update or delete on public.haccp_photos
  for each row execute function public.haccp_block_change();

-- 4. Rechten (lezen; schrijven alleen via functies)
alter table public.haccp_deviations enable row level security;
alter table public.haccp_deviation_events enable row level security;
alter table public.haccp_photos enable row level security;

do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_deviations_select') then
    create policy haccp_deviations_select on public.haccp_deviations
      for select using (public.has_company_access(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_deviation_events_select') then
    create policy haccp_deviation_events_select on public.haccp_deviation_events
      for select using (public.has_company_access(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_photos_select') then
    create policy haccp_photos_select on public.haccp_photos
      for select using (public.has_company_access(company_id));
  end if;
end $p$;

-- 5. Opslag voor foto's: privé, map = bedrijf, alleen toevoegen en lezen
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('haccp', 'haccp', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'haccp_foto_select') then
    create policy haccp_foto_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'haccp'
        and (storage.foldername(name))[1] in (
          select c.id::text from public.companies c where public.has_company_access(c.id))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'haccp_foto_insert') then
    create policy haccp_foto_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'haccp'
        and (storage.foldername(name))[1] in (
          select c.id::text from public.companies c where public.has_company_access(c.id))
      );
  end if;
end $p$;

-- 6. Controle
create or replace function public.haccp_check(
  p_event_id uuid, p_occurrence_id uuid, p_result text, p_note text default null
)
returns uuid  -- id van de aangemaakte afwijking bij afkeuren, anders null
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ public.haccp_occurrences%rowtype;
  v_task public.haccp_tasks%rowtype;
  v_dev uuid;
begin
  if exists (select 1 from public.haccp_events where id = p_event_id) then
    return null;
  end if;
  select * into v_occ from public.haccp_occurrences where id = p_occurrence_id for update;
  if not found then raise exception 'Taak niet gevonden'; end if;
  if not public.has_module_permission(v_occ.company_id, 'haccp_controle', 'edit') then
    raise exception 'Alleen een leidinggevende kan controleren';
  end if;
  if v_occ.status <> 'uitgevoerd' then
    raise exception 'Alleen afgemelde taken kunnen worden gecontroleerd';
  end if;
  if p_result not in ('akkoord', 'afgekeurd') then
    raise exception 'Onbekend resultaat';
  end if;
  if p_result = 'afgekeurd' and coalesce(trim(p_note), '') = '' then
    raise exception 'Geef aan wat er niet goed is';
  end if;

  insert into public.haccp_events (id, group_id, company_id, occurrence_id, task_id, version_id, event_type,
    performed_by, recorded_by, note)
  values (p_event_id, v_occ.group_id, v_occ.company_id, v_occ.id, v_occ.task_id, v_occ.version_id,
    case when p_result = 'akkoord' then 'gecontroleerd_akkoord' else 'gecontroleerd_afgekeurd' end,
    auth.uid(), auth.uid(), nullif(trim(p_note), ''));

  update public.haccp_occurrences
  set check_status = p_result, checked_at = now(), checked_by = auth.uid()
  where id = v_occ.id;

  if p_result = 'afgekeurd' then
    select * into v_task from public.haccp_tasks where id = v_occ.task_id;
    v_dev := gen_random_uuid();
    insert into public.haccp_deviations (id, group_id, company_id, occurrence_id, task_id, area_id,
      description, reported_by)
    values (v_dev, v_occ.group_id, v_occ.company_id, v_occ.id, v_occ.task_id, v_task.area_id,
      'Controle afgekeurd: ' || trim(p_note), auth.uid());
    insert into public.haccp_deviation_events (id, deviation_id, company_id, event_type, performed_by, note, details)
    values (gen_random_uuid(), v_dev, v_occ.company_id, 'gemeld', auth.uid(), trim(p_note),
      jsonb_build_object('bron', 'controle'));
  end if;
  return v_dev;
end;
$$;

-- Meerdere taken tegelijk akkoord (bv. "alles akkoord" voor een ruimte).
create or replace function public.haccp_check_many(p_occurrence_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n integer := 0;
  v_occ public.haccp_occurrences%rowtype;
begin
  foreach v_id in array p_occurrence_ids loop
    select * into v_occ from public.haccp_occurrences where id = v_id for update;
    continue when not found or v_occ.status <> 'uitgevoerd' or v_occ.check_status is not null;
    perform public.haccp_check(gen_random_uuid(), v_id, 'akkoord', null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Afgemelde taken die nog gecontroleerd moeten worden (laatste 14 dagen).
create or replace function public.haccp_to_check(p_company_id uuid)
returns table (
  occurrence_id  uuid,
  due_date       date,
  slot           smallint,
  slots_total    smallint,
  title          text,
  area_id        uuid,
  area_name      text,
  area_sort      integer,
  completed_at   timestamptz,
  completed_by   text,
  photo_count    integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.has_module_permission(p_company_id, 'haccp_controle', 'view') then
    raise exception 'Geen toegang';
  end if;
  return query
  select o.id, o.due_date, o.slot,
         (case when v.frequency = 'meerdere_per_dag' then v.times_per_day else 1 end)::smallint,
         v.title, a.id, a.name, a.sort_order, o.completed_at, up.full_name,
         (select count(*)::integer from public.haccp_photos p where p.occurrence_id = o.id)
  from public.haccp_occurrences o
  join public.haccp_tasks t on t.id = o.task_id
  join public.haccp_task_versions v on v.id = o.version_id
  join public.haccp_areas a on a.id = t.area_id
  left join public.user_profiles up on up.id = o.completed_by
  where o.company_id = p_company_id
    and t.requires_check
    and o.status = 'uitgevoerd'
    and o.check_status is null
    and o.due_date >= public.haccp_company_today(p_company_id) - 14
  order by o.due_date desc, a.sort_order, a.name, v.title, o.slot;
end;
$$;

-- 7. Probleem melden (iedereen die mag afmelden)
create or replace function public.haccp_report_problem(
  p_deviation_id uuid,
  p_company_id uuid,
  p_description text,
  p_occurrence_id uuid default null,
  p_task_id uuid default null,
  p_area_id uuid default null,
  p_session_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_performer uuid;
  v_task public.haccp_tasks%rowtype;
  v_occ public.haccp_occurrences%rowtype;
  v_group uuid;
  v_area uuid := p_area_id;
begin
  if exists (select 1 from public.haccp_deviations where id = p_deviation_id) then
    return p_deviation_id;
  end if;
  if not public.has_module_permission(p_company_id, 'haccp', 'create') then
    raise exception 'Geen recht om problemen te melden';
  end if;
  if coalesce(trim(p_description), '') = '' then
    raise exception 'Beschrijf het probleem';
  end if;
  v_performer := public.haccp_resolve_performer(p_company_id, p_session_id);

  if p_occurrence_id is not null then
    select * into v_occ from public.haccp_occurrences where id = p_occurrence_id;
    if not found or v_occ.company_id <> p_company_id then raise exception 'Taak niet gevonden'; end if;
    p_task_id := v_occ.task_id;
  end if;
  if p_task_id is not null then
    select * into v_task from public.haccp_tasks where id = p_task_id;
    if not found or v_task.company_id <> p_company_id then raise exception 'Taak niet gevonden'; end if;
    v_area := v_task.area_id;
  end if;
  if v_area is not null and not exists (
    select 1 from public.haccp_areas where id = v_area and company_id = p_company_id
  ) then
    raise exception 'Ruimte niet gevonden';
  end if;

  select group_id into v_group from public.companies where id = p_company_id;

  insert into public.haccp_deviations (id, group_id, company_id, occurrence_id, task_id, area_id, description, reported_by)
  values (p_deviation_id, v_group, p_company_id, p_occurrence_id, p_task_id, v_area, trim(p_description), v_performer);

  insert into public.haccp_deviation_events (id, deviation_id, company_id, event_type, performed_by, note, details)
  values (gen_random_uuid(), p_deviation_id, p_company_id, 'gemeld', v_performer, trim(p_description),
    jsonb_build_object('bron', 'melding', 'sessie', p_session_id));

  -- Ook zichtbaar in de tijdlijn van de taak.
  if p_occurrence_id is not null then
    insert into public.haccp_events (id, group_id, company_id, occurrence_id, task_id, version_id, event_type,
      performed_by, recorded_by, staff_session_id, note, details)
    values (gen_random_uuid(), v_occ.group_id, p_company_id, v_occ.id, v_occ.task_id, v_occ.version_id, 'probleem',
      v_performer, auth.uid(), p_session_id, trim(p_description), jsonb_build_object('afwijking', p_deviation_id));
  end if;

  return p_deviation_id;
end;
$$;

-- 8. Afwijking afhandelen
--   maatregel / afgesloten / heropend : leidinggevende (haccp_controle edit)
--   opgelost / opmerking               : iedereen die mag afmelden
create or replace function public.haccp_deviation_action(
  p_event_id uuid,
  p_deviation_id uuid,
  p_action text,
  p_note text default null,
  p_responsible uuid default null,
  p_session_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dev public.haccp_deviations%rowtype;
  v_performer uuid;
  v_lead boolean;
begin
  if exists (select 1 from public.haccp_deviation_events where id = p_event_id) then
    return;
  end if;
  select * into v_dev from public.haccp_deviations where id = p_deviation_id for update;
  if not found then raise exception 'Afwijking niet gevonden'; end if;
  if not public.has_module_permission(v_dev.company_id, 'haccp', 'create')
     and not public.has_module_permission(v_dev.company_id, 'haccp_controle', 'edit') then
    raise exception 'Geen toegang';
  end if;
  v_lead := public.has_module_permission(v_dev.company_id, 'haccp_controle', 'edit');
  v_performer := public.haccp_resolve_performer(v_dev.company_id, p_session_id);

  if p_action in ('maatregel', 'afgesloten', 'heropend') and not v_lead then
    raise exception 'Alleen een leidinggevende kan dit doen';
  end if;
  if p_action in ('maatregel', 'opgelost', 'heropend', 'opmerking') and coalesce(trim(p_note), '') = '' then
    raise exception 'Vul een toelichting in';
  end if;
  if p_responsible is not null
     and not exists (select 1 from public.haccp_staff(v_dev.company_id) s where s.id = p_responsible) then
    raise exception 'Onbekende verantwoordelijke';
  end if;

  if p_action = 'maatregel' then
    if v_dev.status = 'afgesloten' then raise exception 'Afwijking is al afgesloten'; end if;
    update public.haccp_deviations
    set corrective_action = trim(p_note),
        responsible_id = coalesce(p_responsible, responsible_id),
        status = case when status = 'open' then 'in_behandeling' else status end,
        updated_at = now()
    where id = v_dev.id;
  elsif p_action = 'opgelost' then
    if v_dev.status not in ('open', 'in_behandeling') then raise exception 'Afwijking staat niet open'; end if;
    update public.haccp_deviations
    set resolution = trim(p_note), resolved_by = v_performer, resolved_at = now(),
        status = 'opgelost', updated_at = now()
    where id = v_dev.id;
  elsif p_action = 'afgesloten' then
    if v_dev.status <> 'opgelost' then raise exception 'Eerst moet de oplossing worden geregistreerd'; end if;
    update public.haccp_deviations
    set status = 'afgesloten', closed_by = auth.uid(), closed_at = now(), updated_at = now()
    where id = v_dev.id;
  elsif p_action = 'heropend' then
    if v_dev.status not in ('opgelost', 'afgesloten') then raise exception 'Afwijking staat nog open'; end if;
    update public.haccp_deviations
    set status = 'in_behandeling', closed_by = null, closed_at = null, updated_at = now()
    where id = v_dev.id;
  elsif p_action = 'opmerking' then
    update public.haccp_deviations set updated_at = now() where id = v_dev.id;
  else
    raise exception 'Onbekende actie';
  end if;

  insert into public.haccp_deviation_events (id, deviation_id, company_id, event_type, performed_by, note, details)
  values (p_event_id, v_dev.id, v_dev.company_id, p_action,
    case when p_action in ('afgesloten', 'heropend', 'maatregel') then auth.uid() else v_performer end,
    nullif(trim(p_note), ''),
    case when p_responsible is not null then jsonb_build_object('verantwoordelijke', p_responsible) end);
end;
$$;

-- Lijst van afwijkingen met namen.
create or replace function public.haccp_deviation_list(p_company_id uuid, p_include_closed boolean default false)
returns table (
  id                 uuid,
  description        text,
  status             text,
  area_name          text,
  task_title         text,
  due_date           date,
  occurrence_id      uuid,
  reported_by        text,
  reported_at        timestamptz,
  corrective_action  text,
  responsible_id     uuid,
  responsible        text,
  resolution         text,
  resolved_by        text,
  resolved_at        timestamptz,
  closed_by          text,
  closed_at          timestamptz,
  photo_count        integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.has_module_permission(p_company_id, 'haccp', 'view') then
    raise exception 'Geen toegang';
  end if;
  return query
  select d.id, d.description, d.status, a.name, t.title, o.due_date, d.occurrence_id,
         rp.full_name, d.reported_at, d.corrective_action, d.responsible_id, rs.full_name,
         d.resolution, rv.full_name, d.resolved_at, cl.full_name, d.closed_at,
         (select count(*)::integer from public.haccp_photos p where p.deviation_id = d.id)
  from public.haccp_deviations d
  left join public.haccp_areas a on a.id = d.area_id
  left join public.haccp_tasks t on t.id = d.task_id
  left join public.haccp_occurrences o on o.id = d.occurrence_id
  left join public.user_profiles rp on rp.id = d.reported_by
  left join public.user_profiles rs on rs.id = d.responsible_id
  left join public.user_profiles rv on rv.id = d.resolved_by
  left join public.user_profiles cl on cl.id = d.closed_by
  where d.company_id = p_company_id
    and (p_include_closed or d.status <> 'afgesloten')
  order by case d.status when 'open' then 0 when 'in_behandeling' then 1 when 'opgelost' then 2 else 3 end,
           d.reported_at desc
  limit 500;
end;
$$;

create or replace function public.haccp_deviation_events_list(p_deviation_id uuid)
returns table (
  id            uuid,
  event_type    text,
  performed_by  text,
  recorded_by   text,
  recorded_at   timestamptz,
  note          text,
  responsible   text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_company uuid;
begin
  select company_id into v_company from public.haccp_deviations where id = p_deviation_id;
  if v_company is null or not public.has_module_permission(v_company, 'haccp', 'view') then
    raise exception 'Geen toegang';
  end if;
  return query
  select e.id, e.event_type, pb.full_name, rb.full_name, e.recorded_at, e.note, rs.full_name
  from public.haccp_deviation_events e
  left join public.user_profiles pb on pb.id = e.performed_by
  left join public.user_profiles rb on rb.id = e.recorded_by
  left join public.user_profiles rs on rs.id = (e.details ->> 'verantwoordelijke')::uuid
  where e.deviation_id = p_deviation_id
  order by e.recorded_at;
end;
$$;

-- 9. Foto vastleggen (na upload naar bucket "haccp")
create or replace function public.haccp_add_photo(
  p_photo_id uuid,
  p_company_id uuid,
  p_storage_path text,
  p_occurrence_id uuid default null,
  p_deviation_id uuid default null,
  p_session_id uuid default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.haccp_photos where id = p_photo_id) then
    return;
  end if;
  if not public.has_module_permission(p_company_id, 'haccp', 'create')
     and not public.has_module_permission(p_company_id, 'haccp_controle', 'edit') then
    raise exception 'Geen recht om foto''s toe te voegen';
  end if;
  if split_part(p_storage_path, '/', 1) <> p_company_id::text then
    raise exception 'Foto hoort niet bij dit bedrijf';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'haccp' and name = p_storage_path) then
    raise exception 'Foto is niet gevonden in de opslag';
  end if;
  if p_occurrence_id is null and p_deviation_id is null then
    raise exception 'Foto moet bij een taak of afwijking horen';
  end if;
  if p_occurrence_id is not null and not exists (
    select 1 from public.haccp_occurrences where id = p_occurrence_id and company_id = p_company_id) then
    raise exception 'Taak niet gevonden';
  end if;
  if p_deviation_id is not null and not exists (
    select 1 from public.haccp_deviations where id = p_deviation_id and company_id = p_company_id) then
    raise exception 'Afwijking niet gevonden';
  end if;

  insert into public.haccp_photos (id, company_id, occurrence_id, deviation_id, storage_path, taken_by, note)
  values (p_photo_id, p_company_id, p_occurrence_id, p_deviation_id, p_storage_path,
    public.haccp_resolve_performer(p_company_id, p_session_id), nullif(trim(p_note), ''));
end;
$$;

create or replace function public.haccp_photo_list(p_occurrence_id uuid default null, p_deviation_id uuid default null)
returns table (id uuid, storage_path text, taken_by text, recorded_at timestamptz, note text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  select p.id, p.storage_path, up.full_name, p.recorded_at, p.note
  from public.haccp_photos p
  left join public.user_profiles up on up.id = p.taken_by
  where public.has_company_access(p.company_id)
    and ((p_occurrence_id is not null and p.occurrence_id = p_occurrence_id)
      or (p_deviation_id is not null and p.deviation_id = p_deviation_id))
  order by p.recorded_at;
end;
$$;

grant execute on function public.haccp_check(uuid, uuid, text, text) to authenticated;
grant execute on function public.haccp_check_many(uuid[]) to authenticated;
grant execute on function public.haccp_to_check(uuid) to authenticated;
grant execute on function public.haccp_report_problem(uuid, uuid, text, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.haccp_deviation_action(uuid, uuid, text, text, uuid, uuid) to authenticated;
grant execute on function public.haccp_deviation_list(uuid, boolean) to authenticated;
grant execute on function public.haccp_deviation_events_list(uuid) to authenticated;
grant execute on function public.haccp_add_photo(uuid, uuid, text, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.haccp_photo_list(uuid, uuid) to authenticated;

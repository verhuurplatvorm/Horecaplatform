-- 0112_haccp_schoonmaak_basis.sql
--
-- HACCP → Schoonmaak & Controle, stap 1 (basis + fundament borging).
--
-- Uitgangspunten
-- * Volledig additief: er wordt niets bestaands gewijzigd of verwijderd.
-- * Alles per bedrijf (company_id) en afgeschermd met has_company_access().
-- * Verantwoordelijke = bestaande afdeling (public.departments), geen nieuwe lijst.
-- * Medewerkers = bestaande gebruikers (public.user_profiles).
-- * Elke taak heeft versies: een registratie blijft gekoppeld aan de
--   omschrijving die op dat moment gold.
-- * Registraties (haccp_events) zijn alleen-toevoegen: wijzigen of wissen
--   wordt door de database geweigerd. Correcties zijn nieuwe regels.
-- * Afmelden loopt uitsluitend via de functie haccp_complete(), met
--   servertijd en bescherming tegen dubbel tikken.

-- ---------------------------------------------------------------------
-- 0. Hulpfunctie: rechten per module voor één bedrijf.
-- ---------------------------------------------------------------------
create or replace function public.has_module_permission(
  p_company_id uuid,
  p_module_key text,
  p_action text  -- 'view' | 'create' | 'edit' | 'delete'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_group_admin()
    or exists (
      select 1
      from public.user_company_access uca
      join public.role_permissions rp on rp.role_id = uca.role_id
      where uca.user_id = auth.uid()
        and uca.company_id = p_company_id
        and rp.module_key = p_module_key
        and case p_action
              when 'view' then rp.can_view
              when 'create' then rp.can_create
              when 'edit' then rp.can_edit
              when 'delete' then rp.can_delete
              else false
            end
    );
$$;

comment on function public.has_module_permission(uuid, text, text) is
  'True als de ingelogde gebruiker voor dit bedrijf via zijn rol het gevraagde recht op de module heeft (groepsbeheerders altijd).';

-- Generieke blokkade voor alleen-toevoegen-tabellen.
create or replace function public.haccp_block_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'HACCP-registraties kunnen niet worden gewijzigd of verwijderd. Leg een correctie vast als nieuwe registratie.'
    using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Ruimtes
-- ---------------------------------------------------------------------
create table if not exists public.haccp_areas (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null default public.current_user_group_id()
                references public.groups(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete restrict,
  name        text not null check (length(trim(name)) > 0),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists haccp_areas_company_name_uq
  on public.haccp_areas (company_id, lower(trim(name)));

create or replace trigger trg_haccp_areas_updated_at
  before update on public.haccp_areas
  for each row execute function public.set_updated_at();

comment on table public.haccp_areas is
  'Ruimtes voor het schoonmaakplan (warme keuken, koelcel, bar, toiletten, ...), per bedrijf.';

-- ---------------------------------------------------------------------
-- 2. Taakversies (onveranderlijk) en taken
-- ---------------------------------------------------------------------
create table if not exists public.haccp_task_versions (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null,
  version_no      integer not null,
  company_id      uuid not null,
  area_id         uuid not null,
  department_id   uuid,
  title           text not null,
  instruction     text,
  cleaning_agent  text,
  frequency       text not null,
  times_per_day   smallint,
  weekday         smallint,
  month_day       smallint,
  month           smallint,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (task_id, version_no)
);

create table if not exists public.haccp_tasks (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null default public.current_user_group_id()
                        references public.groups(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete restrict,
  area_id             uuid not null references public.haccp_areas(id) on delete restrict,
  department_id       uuid references public.departments(id) on delete set null,
  title               text not null check (length(trim(title)) > 0),
  instruction         text,
  cleaning_agent      text,
  frequency           text not null default 'dagelijks' check (frequency in (
                        'na_gebruik', 'meerdere_per_dag', 'dagelijks', 'wekelijks',
                        'maandelijks', 'kwartaal', 'jaarlijks', 'handmatig')),
  times_per_day       smallint not null default 1 check (times_per_day between 1 and 24),
  weekday             smallint check (weekday between 1 and 7),       -- ISO: 1 = maandag
  month_day           smallint check (month_day between 1 and 31),
  month               smallint check (month between 1 and 12),
  requires_check      boolean not null default false,
  is_active           boolean not null default true,
  sort_order          integer not null default 0,
  version_no          integer not null default 0,
  current_version_id  uuid references public.haccp_task_versions(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists haccp_tasks_company_idx on public.haccp_tasks (company_id, is_active);
create index if not exists haccp_tasks_area_idx on public.haccp_tasks (area_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'haccp_task_versions_task_fk'
  ) then
    alter table public.haccp_task_versions
      add constraint haccp_task_versions_task_fk
      foreign key (task_id) references public.haccp_tasks(id)
      on delete restrict deferrable initially deferred;
  end if;
end $$;

comment on table public.haccp_tasks is
  'Schoonmaaktaken per ruimte. Bij elke inhoudelijke wijziging ontstaat automatisch een nieuwe versie in haccp_task_versions.';
comment on table public.haccp_task_versions is
  'Onveranderlijke versies van schoonmaaktaken; registraties verwijzen naar de versie die toen gold.';

-- Nieuwe versie bij aanmaken of inhoudelijk wijzigen van een taak.
create or replace function public.haccp_task_versioning()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if tg_op = 'INSERT'
     or (old.title, old.instruction, old.cleaning_agent, old.frequency, old.times_per_day,
         old.weekday, old.month_day, old.month, old.department_id, old.area_id)
        is distinct from
        (new.title, new.instruction, new.cleaning_agent, new.frequency, new.times_per_day,
         new.weekday, new.month_day, new.month, new.department_id, new.area_id)
  then
    new.version_no := coalesce(case when tg_op = 'UPDATE' then old.version_no end, 0) + 1;
    v_id := gen_random_uuid();
    insert into public.haccp_task_versions (
      id, task_id, version_no, company_id, area_id, department_id, title,
      instruction, cleaning_agent, frequency, times_per_day, weekday, month_day, month
    ) values (
      v_id, new.id, new.version_no, new.company_id, new.area_id, new.department_id, new.title,
      new.instruction, new.cleaning_agent, new.frequency, new.times_per_day, new.weekday,
      new.month_day, new.month
    );
    new.current_version_id := v_id;
  end if;
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;  -- een taak verhuist nooit naar een ander bedrijf
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace trigger trg_haccp_task_versioning
  before insert or update on public.haccp_tasks
  for each row execute function public.haccp_task_versioning();

create or replace trigger trg_haccp_task_versions_block
  before update or delete on public.haccp_task_versions
  for each row execute function public.haccp_block_change();

-- ---------------------------------------------------------------------
-- 3. Geplande momenten (occurrences)
-- ---------------------------------------------------------------------
create table if not exists public.haccp_occurrences (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete restrict,
  task_id       uuid not null references public.haccp_tasks(id) on delete restrict,
  version_id    uuid not null references public.haccp_task_versions(id),
  due_date      date not null,
  slot          smallint not null default 1,
  is_on_demand  boolean not null default false,   -- na gebruik / handmatig
  status        text not null default 'open' check (status in (
                  'open', 'uitgevoerd', 'niet_uitgevoerd', 'vervallen')),
  completed_at  timestamptz,
  completed_by  uuid references public.user_profiles(id),
  created_at    timestamptz not null default now(),
  unique (task_id, due_date, slot)
);

create index if not exists haccp_occurrences_company_date_idx
  on public.haccp_occurrences (company_id, due_date);
create index if not exists haccp_occurrences_open_idx
  on public.haccp_occurrences (company_id, due_date) where status = 'open';

comment on table public.haccp_occurrences is
  'Geplande schoonmaakmomenten. De oorspronkelijke datum blijft altijd bewaard; open + datum in het verleden = te laat. Status is een afgeleide van haccp_events.';

-- ---------------------------------------------------------------------
-- 4. Registraties (alleen toevoegen)
-- ---------------------------------------------------------------------
create table if not exists public.haccp_events (
  id                 uuid primary key,  -- door de app gegenereerd: dubbel tikken = zelfde id
  group_id           uuid not null references public.groups(id) on delete restrict,
  company_id         uuid not null references public.companies(id) on delete restrict,
  occurrence_id      uuid references public.haccp_occurrences(id) on delete restrict,
  task_id            uuid references public.haccp_tasks(id) on delete restrict,
  version_id         uuid references public.haccp_task_versions(id),
  event_type         text not null check (event_type in (
                       'uitgevoerd', 'ingetrokken', 'correctie', 'niet_uitgevoerd',
                       'gecontroleerd_akkoord', 'gecontroleerd_afgekeurd', 'probleem')),
  performed_by       uuid references public.user_profiles(id),
  recorded_by        uuid default auth.uid() references public.user_profiles(id),
  staff_session_id   uuid,
  recorded_at        timestamptz not null default now(),
  client_at          timestamptz,
  note               text,
  corrects_event_id  uuid references public.haccp_events(id)
);

create index if not exists haccp_events_occurrence_idx on public.haccp_events (occurrence_id);
create index if not exists haccp_events_company_time_idx on public.haccp_events (company_id, recorded_at desc);

create or replace trigger trg_haccp_events_block
  before update or delete on public.haccp_events
  for each row execute function public.haccp_block_change();

comment on table public.haccp_events is
  'Alle HACCP-schoonmaakregistraties. Alleen toevoegen: wijzigen/verwijderen wordt geweigerd. recorded_at = servertijd; client_at = tijd van het apparaat (alleen ter info).';

-- ---------------------------------------------------------------------
-- 5. Medewerker op een gedeelde tablet: pincode + korte sessie
-- ---------------------------------------------------------------------
alter table public.user_profiles
  add column if not exists staff_pin_hash text;

comment on column public.user_profiles.staff_pin_hash is
  'Versleutelde (bcrypt) personeelscode voor het wisselen van medewerker op een gedeelde tablet. Nooit leesbaar opgeslagen.';

create table if not exists public.haccp_staff_sessions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete restrict,
  staff_id     uuid not null references public.user_profiles(id) on delete restrict,
  device_user  uuid not null default auth.uid() references public.user_profiles(id),
  started_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '12 hours'
);

create or replace trigger trg_haccp_staff_sessions_block
  before update or delete on public.haccp_staff_sessions
  for each row execute function public.haccp_block_change();

comment on table public.haccp_staff_sessions is
  'Wie werkt er op welk apparaat (na pincode). Registraties verwijzen hiernaar; alleen toevoegen.';

-- ---------------------------------------------------------------------
-- 6. Rechten (RLS)
-- ---------------------------------------------------------------------
alter table public.haccp_areas enable row level security;
alter table public.haccp_tasks enable row level security;
alter table public.haccp_task_versions enable row level security;
alter table public.haccp_occurrences enable row level security;
alter table public.haccp_events enable row level security;
alter table public.haccp_staff_sessions enable row level security;

do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_areas_select') then
    create policy haccp_areas_select on public.haccp_areas
  for select using (public.has_company_access(company_id));
  end if;
end $p$;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_areas_write') then
    create policy haccp_areas_write on public.haccp_areas
  for all using (public.has_module_permission(company_id, 'haccp_plan', 'edit'))
  with check (public.has_module_permission(company_id, 'haccp_plan', 'edit'));
  end if;
end $p$;

do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_tasks_select') then
    create policy haccp_tasks_select on public.haccp_tasks
  for select using (public.has_company_access(company_id));
  end if;
end $p$;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_tasks_write') then
    create policy haccp_tasks_write on public.haccp_tasks
  for all using (public.has_module_permission(company_id, 'haccp_plan', 'edit'))
  with check (public.has_module_permission(company_id, 'haccp_plan', 'edit'));
  end if;
end $p$;

do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_task_versions_select') then
    create policy haccp_task_versions_select on public.haccp_task_versions
  for select using (public.has_company_access(company_id));
  end if;
end $p$;

-- Momenten, registraties en sessies: alleen lezen via RLS; schrijven
-- uitsluitend via de functies hieronder (security definer).
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_occurrences_select') then
    create policy haccp_occurrences_select on public.haccp_occurrences
  for select using (public.has_company_access(company_id));
  end if;
end $p$;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_events_select') then
    create policy haccp_events_select on public.haccp_events
  for select using (public.has_company_access(company_id));
  end if;
end $p$;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_staff_sessions_select') then
    create policy haccp_staff_sessions_select on public.haccp_staff_sessions
  for select using (public.has_company_access(company_id));
  end if;
end $p$;

-- Wijzigingen aan het plan in de bestaande wijzigingslog.
create or replace trigger trg_audit_haccp_areas
  after insert or update or delete on public.haccp_areas
  for each row execute function public.audit_row_change();
create or replace trigger trg_audit_haccp_tasks
  after insert or update or delete on public.haccp_tasks
  for each row execute function public.audit_row_change();

-- Standaardrechten voor bestaande rollen (bestaande rijen blijven ongemoeid).
insert into public.role_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_view_financial)
select r.id, m.module_key,
  true,
  case when m.module_key = 'haccp' then true else r.key in ('chef', 'directie') end,
  r.key in ('chef', 'directie'),
  false,
  false
from public.roles r
cross join (values ('haccp'), ('haccp_plan')) as m(module_key)
where not (r.key not in ('chef', 'directie') and m.module_key = 'haccp_plan')
on conflict (role_id, module_key) do nothing;

-- ---------------------------------------------------------------------
-- 7. Planning: geplande momenten aanmaken (idempotent)
-- ---------------------------------------------------------------------
create or replace function public.haccp_company_today(p_company_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone coalesce(
    (select timezone from public.companies where id = p_company_id), 'Europe/Amsterdam'))::date;
$$;

create or replace function public.haccp_ensure_occurrences(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date;
  v_count integer;
  v_company record;
begin
  if not public.has_company_access(p_company_id) then
    raise exception 'Geen toegang tot dit bedrijf';
  end if;

  select * into v_company from public.companies where id = p_company_id;
  v_today := public.haccp_company_today(p_company_id);

  insert into public.haccp_occurrences (group_id, company_id, task_id, version_id, due_date, slot)
  select t.group_id, t.company_id, t.id, t.current_version_id, d::date, s
  from public.haccp_tasks t
  join public.haccp_areas a on a.id = t.area_id and a.is_active
  cross join lateral generate_series(
    greatest(
      (t.created_at at time zone coalesce(v_company.timezone, 'Europe/Amsterdam'))::date,
      v_today - 14
    )::timestamp,
    v_today::timestamp,
    interval '1 day'
  ) as d
  cross join lateral generate_series(
    1, case when t.frequency = 'meerdere_per_dag' then t.times_per_day else 1 end
  ) as s
  where t.company_id = p_company_id
    and t.is_active
    and t.current_version_id is not null
    and t.frequency in ('meerdere_per_dag', 'dagelijks', 'wekelijks', 'maandelijks', 'kwartaal', 'jaarlijks')
    -- seizoensbedrijf: alleen binnen het seizoen (op maand-dag)
    and (
      not coalesce(v_company.is_seasonal, false)
      or v_company.season_start is null
      or v_company.season_end is null
      or to_char(d, 'MMDD') between to_char(v_company.season_start, 'MMDD')
                               and to_char(v_company.season_end, 'MMDD')
    )
    and case t.frequency
      when 'wekelijks' then extract(isodow from d) = coalesce(t.weekday, 1)
      when 'maandelijks' then extract(day from d) = least(
        coalesce(t.month_day, 1),
        extract(day from (date_trunc('month', d) + interval '1 month - 1 day')))
      when 'kwartaal' then
        mod((extract(month from d)::int - coalesce(t.month, 1) + 12), 3) = 0
        and extract(day from d) = least(
          coalesce(t.month_day, 1),
          extract(day from (date_trunc('month', d) + interval '1 month - 1 day')))
      when 'jaarlijks' then
        extract(month from d) = coalesce(t.month, 1)
        and extract(day from d) = least(
          coalesce(t.month_day, 1),
          extract(day from (date_trunc('month', d) + interval '1 month - 1 day')))
      else true
    end
  on conflict (task_id, due_date, slot) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.haccp_ensure_occurrences(uuid) is
  'Maakt de geplande schoonmaakmomenten aan t/m vandaag (max. 14 dagen terug, niet vóór aanmaken van de taak). Veilig om vaak aan te roepen.';

-- Wordt een taak uit het plan gehaald of verandert de frequentie, dan
-- vervallen open momenten van vandaag (verleden blijft zichtbaar als te laat).
create or replace function public.haccp_task_schedule_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.is_active and not new.is_active)
     or (old.frequency, old.times_per_day, old.weekday, old.month_day, old.month)
        is distinct from
        (new.frequency, new.times_per_day, new.weekday, new.month_day, new.month)
  then
    update public.haccp_occurrences o
    set status = 'vervallen'
    where o.task_id = new.id
      and o.status = 'open'
      and not o.is_on_demand
      and o.due_date >= public.haccp_company_today(new.company_id)
      and not exists (select 1 from public.haccp_events e where e.occurrence_id = o.id);
  end if;
  return new;
end;
$$;

create or replace trigger trg_haccp_task_schedule_changed
  after update on public.haccp_tasks
  for each row execute function public.haccp_task_schedule_changed();

-- ---------------------------------------------------------------------
-- 8. Medewerkers en pincode
-- ---------------------------------------------------------------------
create or replace function public.haccp_staff(p_company_id uuid)
returns table (id uuid, full_name text, has_pin boolean)
language sql
stable
security definer
set search_path = public
as $$
  select up.id, up.full_name, up.staff_pin_hash is not null
  from public.user_profiles up
  where public.has_company_access(p_company_id)
    and up.is_active
    and up.group_id = public.current_user_group_id()
    and (
      up.is_group_admin
      or exists (select 1 from public.user_company_access uca
                 where uca.user_id = up.id and uca.company_id = p_company_id)
    )
  order by up.full_name;
$$;

create or replace function public.haccp_set_pin(p_company_id uuid, p_user_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.has_module_permission(p_company_id, 'haccp_plan', 'edit') then
    raise exception 'Alleen een beheerder kan pincodes instellen';
  end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4}$' then
    raise exception 'Pincode moet uit 4 cijfers bestaan';
  end if;
  if not exists (
    select 1 from public.haccp_staff(p_company_id) s where s.id = p_user_id
  ) then
    raise exception 'Deze medewerker hoort niet bij dit bedrijf';
  end if;
  update public.user_profiles
  set staff_pin_hash = case when p_pin is null then null
                            else extensions.crypt(p_pin, extensions.gen_salt('bf')) end
  where id = p_user_id;
end;
$$;

-- Start een medewerkersessie op dit apparaat. Geeft het sessie-id terug.
create or replace function public.haccp_start_staff_session(
  p_company_id uuid, p_staff_id uuid, p_pin text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_id uuid;
begin
  if not public.has_module_permission(p_company_id, 'haccp', 'create') then
    raise exception 'Geen recht om schoonmaaktaken af te melden';
  end if;
  if not exists (select 1 from public.haccp_staff(p_company_id) s where s.id = p_staff_id) then
    raise exception 'Onbekende medewerker';
  end if;
  select staff_pin_hash into v_hash from public.user_profiles where id = p_staff_id;
  if v_hash is null then
    raise exception 'Voor deze medewerker is nog geen pincode ingesteld';
  end if;
  if p_pin is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    raise exception 'Pincode klopt niet';
  end if;
  insert into public.haccp_staff_sessions (company_id, staff_id)
  values (p_company_id, p_staff_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Afmelden en intrekken
-- ---------------------------------------------------------------------
create or replace function public.haccp_resolve_performer(p_company_id uuid, p_session_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_staff uuid;
begin
  if p_session_id is null then
    return auth.uid();
  end if;
  select s.staff_id into v_staff
  from public.haccp_staff_sessions s
  where s.id = p_session_id
    and s.company_id = p_company_id
    and s.device_user = auth.uid()
    and s.expires_at > now();
  if v_staff is null then
    raise exception 'Medewerkersessie verlopen — kies opnieuw wie er werkt';
  end if;
  return v_staff;
end;
$$;

create or replace function public.haccp_complete(
  p_event_id uuid,
  p_occurrence_id uuid,
  p_task_id uuid,
  p_session_id uuid default null,
  p_client_at timestamptz default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ public.haccp_occurrences%rowtype;
  v_task public.haccp_tasks%rowtype;
  v_existing public.haccp_events%rowtype;
  v_performer uuid;
  v_today date;
  v_slot smallint;
begin
  -- Dubbel tikken / opnieuw verzonden: zelfde id = al geregistreerd.
  select * into v_existing from public.haccp_events where id = p_event_id;
  if found then
    return jsonb_build_object('status', 'al_geregistreerd', 'event_id', v_existing.id,
                              'occurrence_id', v_existing.occurrence_id,
                              'recorded_at', v_existing.recorded_at);
  end if;

  if p_occurrence_id is not null then
    select * into v_occ from public.haccp_occurrences where id = p_occurrence_id for update;
    if not found then raise exception 'Taak niet gevonden'; end if;
    select * into v_task from public.haccp_tasks where id = v_occ.task_id;
  elsif p_task_id is not null then
    select * into v_task from public.haccp_tasks where id = p_task_id;
    if not found then raise exception 'Taak niet gevonden'; end if;
    if v_task.frequency not in ('na_gebruik', 'handmatig') then
      raise exception 'Deze taak is gepland; meld het geplande moment af';
    end if;
  else
    raise exception 'Geen taak opgegeven';
  end if;

  if not public.has_module_permission(v_task.company_id, 'haccp', 'create') then
    raise exception 'Geen recht om schoonmaaktaken af te melden';
  end if;

  v_performer := public.haccp_resolve_performer(v_task.company_id, p_session_id);

  if p_occurrence_id is not null then
    if v_occ.status <> 'open' then
      return jsonb_build_object('status', 'al_afgerond', 'occurrence_id', v_occ.id,
                                'completed_at', v_occ.completed_at);
    end if;
  else
    -- Na gebruik / handmatig: elk afmelden is een eigen moment vandaag.
    perform pg_advisory_xact_lock(hashtext(v_task.id::text));
    v_today := public.haccp_company_today(v_task.company_id);
    select coalesce(max(slot), 0) + 1 into v_slot
    from public.haccp_occurrences where task_id = v_task.id and due_date = v_today;
    insert into public.haccp_occurrences (group_id, company_id, task_id, version_id, due_date, slot, is_on_demand)
    values (v_task.group_id, v_task.company_id, v_task.id, v_task.current_version_id, v_today, v_slot, true)
    returning * into v_occ;
  end if;

  insert into public.haccp_events (
    id, group_id, company_id, occurrence_id, task_id, version_id, event_type,
    performed_by, recorded_by, staff_session_id, client_at, note
  ) values (
    p_event_id, v_occ.group_id, v_occ.company_id, v_occ.id, v_occ.task_id, v_occ.version_id,
    'uitgevoerd', v_performer, auth.uid(), p_session_id, p_client_at, nullif(trim(p_note), '')
  );

  update public.haccp_occurrences
  set status = 'uitgevoerd', completed_at = now(), completed_by = v_performer
  where id = v_occ.id;

  return jsonb_build_object('status', 'uitgevoerd', 'event_id', p_event_id,
                            'occurrence_id', v_occ.id, 'recorded_at', now());
end;
$$;

comment on function public.haccp_complete(uuid, uuid, uuid, uuid, timestamptz, text) is
  'Meldt een schoonmaaktaak af. Registreert servertijd, medewerker (via sessie of ingelogde gebruiker) en het account dat klikte. Dubbel tikken levert geen dubbele registratie op.';

-- Intrekken direct na afmelden (vergissing). Wordt zelf als registratie vastgelegd.
create or replace function public.haccp_undo(p_event_id uuid, p_undo_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev public.haccp_events%rowtype;
  v_occ public.haccp_occurrences%rowtype;
begin
  if exists (select 1 from public.haccp_events where id = p_undo_event_id) then
    return;  -- al ingetrokken (dubbel tikken)
  end if;
  select * into v_ev from public.haccp_events where id = p_event_id;
  if not found or v_ev.event_type <> 'uitgevoerd' then
    raise exception 'Registratie niet gevonden';
  end if;
  if v_ev.recorded_by is distinct from auth.uid() or v_ev.recorded_at < now() - interval '2 minutes' then
    raise exception 'Intrekken kan alleen direct na afmelden, op hetzelfde apparaat. Vraag een leidinggevende om een correctie.';
  end if;
  select * into v_occ from public.haccp_occurrences where id = v_ev.occurrence_id for update;
  if exists (select 1 from public.haccp_events where corrects_event_id = p_event_id) then
    return;
  end if;

  insert into public.haccp_events (
    id, group_id, company_id, occurrence_id, task_id, version_id, event_type,
    performed_by, recorded_by, staff_session_id, note, corrects_event_id
  ) values (
    p_undo_event_id, v_ev.group_id, v_ev.company_id, v_ev.occurrence_id, v_ev.task_id, v_ev.version_id,
    'ingetrokken', v_ev.performed_by, auth.uid(), v_ev.staff_session_id, 'Direct ingetrokken', p_event_id
  );

  update public.haccp_occurrences
  set status = case when v_occ.is_on_demand then 'vervallen' else 'open' end,
      completed_at = null, completed_by = null
  where id = v_occ.id;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Vandaag-overzicht (één aanroep voor het tabletscherm)
-- ---------------------------------------------------------------------
create or replace function public.haccp_today(p_company_id uuid)
returns table (
  kind            text,      -- 'gepland' | 'op_aanvraag'
  occurrence_id   uuid,
  task_id         uuid,
  title           text,
  instruction     text,
  cleaning_agent  text,
  frequency       text,
  area_id         uuid,
  area_name       text,
  area_sort       integer,
  task_sort       integer,
  department_id   uuid,
  department_name text,
  due_date        date,
  slot            smallint,
  slots_total     smallint,
  status          text,
  is_late         boolean,
  completed_at    timestamptz,
  completed_by    text,
  last_event_id   uuid,
  done_today      integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_today date;
begin
  if not public.has_company_access(p_company_id) then
    raise exception 'Geen toegang tot dit bedrijf';
  end if;
  perform public.haccp_ensure_occurrences(p_company_id);
  v_today := public.haccp_company_today(p_company_id);

  return query
  -- Geplande momenten: alles van vandaag + open momenten uit het verleden.
  select 'gepland'::text, o.id, t.id, v.title, v.instruction, v.cleaning_agent, v.frequency,
         a.id, a.name, a.sort_order, t.sort_order, d.id, d.name, o.due_date, o.slot,
         (case when v.frequency = 'meerdere_per_dag' then v.times_per_day else 1 end)::smallint,
         o.status, (o.status = 'open' and o.due_date < v_today), o.completed_at, up.full_name,
         (select e.id from public.haccp_events e
          where e.occurrence_id = o.id and e.event_type = 'uitgevoerd'
          order by e.recorded_at desc limit 1),
         null::integer
  from public.haccp_occurrences o
  join public.haccp_tasks t on t.id = o.task_id
  join public.haccp_task_versions v on v.id = o.version_id
  join public.haccp_areas a on a.id = t.area_id
  left join public.departments d on d.id = t.department_id
  left join public.user_profiles up on up.id = o.completed_by
  where o.company_id = p_company_id
    and not o.is_on_demand
    and o.status <> 'vervallen'
    and (o.due_date = v_today or (o.status = 'open' and o.due_date < v_today))

  union all

  -- Na gebruik / handmatig: altijd beschikbaar, met teller van vandaag.
  select 'op_aanvraag'::text, null::uuid, t.id, t.title, t.instruction, t.cleaning_agent, t.frequency,
         a.id, a.name, a.sort_order, t.sort_order, d.id, d.name, v_today, null::smallint, null::smallint,
         'open'::text, false, last_o.completed_at, up.full_name,
         (select e.id from public.haccp_events e
          where e.occurrence_id = last_o.id and e.event_type = 'uitgevoerd'
          order by e.recorded_at desc limit 1),
         (select count(*)::integer from public.haccp_occurrences o2
          where o2.task_id = t.id and o2.due_date = v_today and o2.status = 'uitgevoerd')
  from public.haccp_tasks t
  join public.haccp_areas a on a.id = t.area_id and a.is_active
  left join public.departments d on d.id = t.department_id
  left join lateral (
    select o3.* from public.haccp_occurrences o3
    where o3.task_id = t.id and o3.due_date = v_today and o3.status = 'uitgevoerd'
    order by o3.completed_at desc limit 1
  ) last_o on true
  left join public.user_profiles up on up.id = last_o.completed_by
  where t.company_id = p_company_id
    and t.is_active
    and t.frequency in ('na_gebruik', 'handmatig');
end;
$$;

comment on function public.haccp_today(uuid) is
  'Alles voor het scherm Vandaag: geplande taken van vandaag, te late open taken en taken na gebruik/handmatig.';

grant execute on function public.has_module_permission(uuid, text, text) to authenticated;
grant execute on function public.haccp_company_today(uuid) to authenticated;
grant execute on function public.haccp_ensure_occurrences(uuid) to authenticated;
grant execute on function public.haccp_staff(uuid) to authenticated;
grant execute on function public.haccp_set_pin(uuid, uuid, text) to authenticated;
grant execute on function public.haccp_start_staff_session(uuid, uuid, text) to authenticated;
grant execute on function public.haccp_complete(uuid, uuid, uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.haccp_undo(uuid, uuid) to authenticated;
grant execute on function public.haccp_today(uuid) to authenticated;
revoke execute on function public.haccp_resolve_performer(uuid, uuid) from public, anon, authenticated;

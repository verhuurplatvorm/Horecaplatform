-- 0113_haccp_historie_correcties.sql
--
-- HACCP → Schoonmaak & Controle, stap 2 (digitale borging).
-- * Rechtenmodule haccp_controle (leidinggevenden): historie bekijken,
--   correcties vastleggen, te late taken afsluiten als niet uitgevoerd.
-- * Correcties zijn nieuwe registraties (haccp_events); het origineel blijft.
-- * Gesloten dagen: geen planning, open momenten van die dag vervallen.
-- * Bewaartermijn per bedrijf (standaard 24 maanden). Er wordt nooit
--   automatisch iets verwijderd.
-- Volledig additief.

-- 1. Extra velden
alter table public.haccp_events add column if not exists details jsonb;
alter table public.haccp_occurrences add column if not exists void_reason text;

comment on column public.haccp_events.details is
  'Aanvullende gegevens bij een correctie, bv. {"soort":"andere_medewerker","vorige_uitvoerder":"…"}.';
comment on column public.haccp_occurrences.void_reason is
  'Waarom een moment is vervallen: gesloten (gesloten dag) of planwijziging.';

-- 2. Gesloten dagen
create table if not exists public.haccp_closed_days (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  day         date not null,
  reason      text,
  created_by  uuid default auth.uid() references public.user_profiles(id),
  created_at  timestamptz not null default now(),
  unique (company_id, day)
);

alter table public.haccp_closed_days enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_closed_days_select') then
    create policy haccp_closed_days_select on public.haccp_closed_days
      for select using (public.has_company_access(company_id));
  end if;
end $p$;

create or replace trigger trg_audit_haccp_closed_days
  after insert or update or delete on public.haccp_closed_days
  for each row execute function public.audit_row_change();

comment on table public.haccp_closed_days is
  'Dagen waarop een bedrijf dicht is: daar worden geen schoonmaakmomenten gepland. Wijzigen alleen via haccp_set_closed_day().';

-- 3. Instellingen per bedrijf
create table if not exists public.haccp_settings (
  company_id        uuid primary key references public.companies(id) on delete restrict,
  retention_months  smallint not null default 24 check (retention_months between 6 and 120),
  updated_by        uuid default auth.uid() references public.user_profiles(id),
  updated_at        timestamptz not null default now()
);

alter table public.haccp_settings enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_settings_select') then
    create policy haccp_settings_select on public.haccp_settings
      for select using (public.has_company_access(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'haccp_settings_write') then
    create policy haccp_settings_write on public.haccp_settings
      for all using (public.has_module_permission(company_id, 'haccp_plan', 'edit'))
      with check (public.has_module_permission(company_id, 'haccp_plan', 'edit'));
  end if;
end $p$;

create or replace trigger trg_audit_haccp_settings
  after insert or update or delete on public.haccp_settings
  for each row execute function public.audit_row_change();

comment on table public.haccp_settings is
  'HACCP-instellingen per bedrijf. Bewaartermijn: registraties worden minstens zo lang bewaard; er wordt nooit automatisch verwijderd.';

-- 4. Rechten voor leidinggevenden (bestaande rijen blijven ongemoeid)
insert into public.role_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_view_financial)
select r.id, 'haccp_controle', true, true, true, false, false
from public.roles r
where r.key in ('chef', 'directie')
on conflict (role_id, module_key) do nothing;

-- 5. Planning: gesloten dagen overslaan
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
    greatest((t.created_at at time zone coalesce(v_company.timezone, 'Europe/Amsterdam'))::date, v_today - 14)::timestamp,
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
    and not exists (
      select 1 from public.haccp_closed_days cd
      where cd.company_id = p_company_id and cd.day = d::date
    )
    and (
      not coalesce(v_company.is_seasonal, false)
      or v_company.season_start is null
      or v_company.season_end is null
      or to_char(d, 'MMDD') between to_char(v_company.season_start, 'MMDD') and to_char(v_company.season_end, 'MMDD')
    )
    and case t.frequency
      when 'wekelijks' then extract(isodow from d) = coalesce(t.weekday, 1)
      when 'maandelijks' then extract(day from d) = least(
        coalesce(t.month_day, 1), extract(day from (date_trunc('month', d) + interval '1 month - 1 day')))
      when 'kwartaal' then
        mod((extract(month from d)::int - coalesce(t.month, 1) + 12), 3) = 0
        and extract(day from d) = least(
          coalesce(t.month_day, 1), extract(day from (date_trunc('month', d) + interval '1 month - 1 day')))
      when 'jaarlijks' then
        extract(month from d) = coalesce(t.month, 1)
        and extract(day from d) = least(
          coalesce(t.month_day, 1), extract(day from (date_trunc('month', d) + interval '1 month - 1 day')))
      else true
    end
  on conflict (task_id, due_date, slot) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Planwijziging: reden vastleggen bij vervallen momenten.
create or replace function public.haccp_task_schedule_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.is_active and not new.is_active)
     or (old.frequency, old.times_per_day, old.weekday, old.month_day, old.month)
        is distinct from (new.frequency, new.times_per_day, new.weekday, new.month_day, new.month)
  then
    update public.haccp_occurrences o
    set status = 'vervallen', void_reason = 'planwijziging'
    where o.task_id = new.id
      and o.status = 'open'
      and not o.is_on_demand
      and o.due_date >= public.haccp_company_today(new.company_id)
      and not exists (select 1 from public.haccp_events e where e.occurrence_id = o.id);
  end if;
  return new;
end;
$$;

-- 6. Gesloten dag aan/uit
create or replace function public.haccp_set_closed_day(
  p_company_id uuid, p_day date, p_closed boolean, p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_module_permission(p_company_id, 'haccp_controle', 'edit') then
    raise exception 'Alleen een leidinggevende kan gesloten dagen instellen';
  end if;
  if p_closed then
    insert into public.haccp_closed_days (company_id, day, reason)
    values (p_company_id, p_day, nullif(trim(p_reason), ''))
    on conflict (company_id, day) do update set reason = excluded.reason;
    update public.haccp_occurrences
    set status = 'vervallen', void_reason = 'gesloten'
    where company_id = p_company_id and due_date = p_day and status = 'open' and not is_on_demand;
  else
    delete from public.haccp_closed_days where company_id = p_company_id and day = p_day;
    update public.haccp_occurrences
    set status = 'open', void_reason = null
    where company_id = p_company_id and due_date = p_day and status = 'vervallen' and void_reason = 'gesloten';
  end if;
end;
$$;

-- 7. Te late taak afsluiten als niet uitgevoerd
create or replace function public.haccp_mark_not_done(
  p_event_id uuid, p_occurrence_id uuid, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ public.haccp_occurrences%rowtype;
begin
  if exists (select 1 from public.haccp_events where id = p_event_id) then
    return;
  end if;
  select * into v_occ from public.haccp_occurrences where id = p_occurrence_id for update;
  if not found then raise exception 'Taak niet gevonden'; end if;
  if not public.has_module_permission(v_occ.company_id, 'haccp_controle', 'edit') then
    raise exception 'Alleen een leidinggevende kan een taak afsluiten als niet uitgevoerd';
  end if;
  if v_occ.status <> 'open' then
    raise exception 'Deze taak staat niet meer open';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Geef een reden op';
  end if;

  insert into public.haccp_events (
    id, group_id, company_id, occurrence_id, task_id, version_id, event_type,
    performed_by, recorded_by, note
  ) values (
    p_event_id, v_occ.group_id, v_occ.company_id, v_occ.id, v_occ.task_id, v_occ.version_id,
    'niet_uitgevoerd', null, auth.uid(), trim(p_reason)
  );
  update public.haccp_occurrences set status = 'niet_uitgevoerd' where id = v_occ.id;
end;
$$;

-- 8. Correctie door leidinggevende
--   soort 'ongeldig'           : afmelding was onterecht → taak weer open (of vervallen bij na gebruik)
--   soort 'andere_medewerker'  : uitgevoerd door iemand anders dan geregistreerd
--   soort 'heropenen'          : 'niet uitgevoerd' terugdraaien → weer open
create or replace function public.haccp_correct(
  p_event_id uuid, p_occurrence_id uuid, p_kind text, p_reason text, p_new_performer uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ public.haccp_occurrences%rowtype;
  v_last uuid;
begin
  if exists (select 1 from public.haccp_events where id = p_event_id) then
    return;
  end if;
  select * into v_occ from public.haccp_occurrences where id = p_occurrence_id for update;
  if not found then raise exception 'Taak niet gevonden'; end if;
  if not public.has_module_permission(v_occ.company_id, 'haccp_controle', 'edit') then
    raise exception 'Alleen een leidinggevende kan een correctie vastleggen';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Geef een reden op voor de correctie';
  end if;

  select e.id into v_last from public.haccp_events e
  where e.occurrence_id = v_occ.id and e.event_type in ('uitgevoerd', 'niet_uitgevoerd')
  order by e.recorded_at desc limit 1;

  if p_kind = 'ongeldig' then
    if v_occ.status <> 'uitgevoerd' then raise exception 'Deze taak is niet afgemeld'; end if;
    insert into public.haccp_events (id, group_id, company_id, occurrence_id, task_id, version_id, event_type,
      performed_by, recorded_by, note, corrects_event_id, details)
    values (p_event_id, v_occ.group_id, v_occ.company_id, v_occ.id, v_occ.task_id, v_occ.version_id, 'correctie',
      null, auth.uid(), trim(p_reason), v_last,
      jsonb_build_object('soort', 'ongeldig', 'vorige_uitvoerder', v_occ.completed_by, 'vorige_tijd', v_occ.completed_at));
    update public.haccp_occurrences
    set status = case when is_on_demand then 'vervallen' else 'open' end,
        void_reason = case when is_on_demand then 'correctie' else null end,
        completed_at = null, completed_by = null
    where id = v_occ.id;

  elsif p_kind = 'andere_medewerker' then
    if v_occ.status <> 'uitgevoerd' then raise exception 'Deze taak is niet afgemeld'; end if;
    if p_new_performer is null
       or not exists (select 1 from public.haccp_staff(v_occ.company_id) s where s.id = p_new_performer) then
      raise exception 'Kies de medewerker die de taak wel heeft uitgevoerd';
    end if;
    insert into public.haccp_events (id, group_id, company_id, occurrence_id, task_id, version_id, event_type,
      performed_by, recorded_by, note, corrects_event_id, details)
    values (p_event_id, v_occ.group_id, v_occ.company_id, v_occ.id, v_occ.task_id, v_occ.version_id, 'correctie',
      p_new_performer, auth.uid(), trim(p_reason), v_last,
      jsonb_build_object('soort', 'andere_medewerker', 'vorige_uitvoerder', v_occ.completed_by));
    update public.haccp_occurrences set completed_by = p_new_performer where id = v_occ.id;

  elsif p_kind = 'heropenen' then
    if v_occ.status <> 'niet_uitgevoerd' then raise exception 'Alleen een niet-uitgevoerde taak kan worden heropend'; end if;
    insert into public.haccp_events (id, group_id, company_id, occurrence_id, task_id, version_id, event_type,
      performed_by, recorded_by, note, corrects_event_id, details)
    values (p_event_id, v_occ.group_id, v_occ.company_id, v_occ.id, v_occ.task_id, v_occ.version_id, 'correctie',
      null, auth.uid(), trim(p_reason), v_last, jsonb_build_object('soort', 'heropenen'));
    update public.haccp_occurrences set status = 'open' where id = v_occ.id;

  else
    raise exception 'Onbekende correctie';
  end if;
end;
$$;

-- 9. Historie (alleen lezen)
create or replace function public.haccp_history(p_company_id uuid, p_from date, p_to date)
returns table (
  occurrence_id     uuid,
  due_date          date,
  slot              smallint,
  slots_total       smallint,
  is_on_demand      boolean,
  task_id           uuid,
  title             text,
  version_no        integer,
  frequency         text,
  area_id           uuid,
  area_name         text,
  department_name   text,
  status            text,
  void_reason       text,
  completed_at      timestamptz,
  completed_by_id   uuid,
  completed_by      text,
  clicked_by        text,
  done_late         boolean,
  has_corrections   boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz text;
begin
  if not public.has_module_permission(p_company_id, 'haccp_controle', 'view') then
    raise exception 'Geen toegang tot de HACCP-historie';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Kies een periode van maximaal ruim een jaar';
  end if;
  select coalesce(timezone, 'Europe/Amsterdam') into v_tz from public.companies where id = p_company_id;

  return query
  select o.id, o.due_date, o.slot,
         (case when v.frequency = 'meerdere_per_dag' then v.times_per_day else 1 end)::smallint,
         o.is_on_demand, o.task_id, v.title, v.version_no, v.frequency,
         a.id, a.name, d.name, o.status, o.void_reason, o.completed_at, o.completed_by, up.full_name,
         (select rb.full_name from public.haccp_events e
          join public.user_profiles rb on rb.id = e.recorded_by
          where e.occurrence_id = o.id and e.event_type = 'uitgevoerd'
          order by e.recorded_at desc limit 1),
         (o.completed_at is not null and (o.completed_at at time zone v_tz)::date > o.due_date),
         exists (select 1 from public.haccp_events e2
                 where e2.occurrence_id = o.id and e2.event_type in ('correctie', 'ingetrokken'))
  from public.haccp_occurrences o
  join public.haccp_task_versions v on v.id = o.version_id
  join public.haccp_tasks t on t.id = o.task_id
  join public.haccp_areas a on a.id = t.area_id
  left join public.departments d on d.id = v.department_id
  left join public.user_profiles up on up.id = o.completed_by
  where o.company_id = p_company_id
    and o.due_date between p_from and p_to
    and not (o.is_on_demand and o.status = 'vervallen' and o.void_reason is null)
  order by o.due_date desc, a.sort_order, a.name, v.title, o.slot;
end;
$$;

-- Tijdlijn van één moment: alle registraties met namen.
create or replace function public.haccp_occurrence_events(p_occurrence_id uuid)
returns table (
  id                uuid,
  event_type        text,
  performed_by      text,
  recorded_by       text,
  recorded_at       timestamptz,
  client_at         timestamptz,
  note              text,
  details           jsonb,
  corrects_event_id uuid,
  version_no        integer
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
  select company_id into v_company from public.haccp_occurrences where id = p_occurrence_id;
  if v_company is null or not public.has_module_permission(v_company, 'haccp_controle', 'view') then
    raise exception 'Geen toegang';
  end if;
  return query
  select e.id, e.event_type, pb.full_name, rb.full_name, e.recorded_at, e.client_at, e.note,
         e.details, e.corrects_event_id, v.version_no
  from public.haccp_events e
  left join public.user_profiles pb on pb.id = e.performed_by
  left join public.user_profiles rb on rb.id = e.recorded_by
  left join public.haccp_task_versions v on v.id = e.version_id
  where e.occurrence_id = p_occurrence_id
  order by e.recorded_at;
end;
$$;

grant execute on function public.haccp_set_closed_day(uuid, date, boolean, text) to authenticated;
grant execute on function public.haccp_mark_not_done(uuid, uuid, text) to authenticated;
grant execute on function public.haccp_correct(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.haccp_history(uuid, date, date) to authenticated;
grant execute on function public.haccp_occurrence_events(uuid) to authenticated;

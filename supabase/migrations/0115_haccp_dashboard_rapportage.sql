-- 0115_haccp_dashboard_rapportage.sql
--
-- HACCP → Schoonmaak & Controle, stap 4: dashboard en rapportage.
-- Alleen leesfuncties (plus het aanmaken van geplande momenten t/m vandaag,
-- zoals Vandaag dat ook doet). Volledig additief.

-- 1. Dashboard: per bedrijf en ruimte de stand van vandaag.
create or replace function public.haccp_dashboard(p_company_ids uuid[])
returns table (
  company_id       uuid,
  company_name     text,
  area_id          uuid,
  area_name        text,
  area_sort        integer,
  planned          integer,
  done             integer,
  late             integer,
  to_check         integer,
  deviations_open  integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_company uuid;
  v_today date;
begin
  foreach v_company in array coalesce(p_company_ids, array[]::uuid[]) loop
    continue when not public.has_module_permission(v_company, 'haccp_controle', 'view');
    perform public.haccp_ensure_occurrences(v_company);
    v_today := public.haccp_company_today(v_company);

    return query
    with occ as (
      select t.area_id, o.*
      from public.haccp_occurrences o
      join public.haccp_tasks t on t.id = o.task_id
      where o.company_id = v_company
        and not o.is_on_demand
        and o.status <> 'vervallen'
        and o.due_date >= v_today - 60
    ),
    per_area as (
      select a.id as aid, a.name as aname, a.sort_order as asort,
        (select count(*)::integer from occ where occ.area_id = a.id and occ.due_date = v_today) as p,
        (select count(*)::integer from occ where occ.area_id = a.id and occ.due_date = v_today and occ.status = 'uitgevoerd') as d,
        (select count(*)::integer from occ where occ.area_id = a.id and occ.due_date < v_today and occ.status = 'open') as l,
        (select count(*)::integer from public.haccp_occurrences o2
           join public.haccp_tasks t2 on t2.id = o2.task_id
          where o2.company_id = v_company and t2.area_id = a.id and t2.requires_check
            and o2.status = 'uitgevoerd' and o2.check_status is null and o2.due_date >= v_today - 14) as c,
        (select count(*)::integer from public.haccp_deviations dv
          where dv.company_id = v_company and dv.area_id = a.id and dv.status <> 'afgesloten') as dv
      from public.haccp_areas a
      where a.company_id = v_company and a.is_active
    )
    select v_company, c.name, pa.aid, pa.aname, pa.asort, pa.p, pa.d, pa.l, pa.c, pa.dv
    from per_area pa
    cross join public.companies c
    where c.id = v_company
    union all
    -- afwijkingen zonder ruimte
    select v_company, c.name, null::uuid, null::text, 999999, 0, 0, 0, 0,
      (select count(*)::integer from public.haccp_deviations dv
        where dv.company_id = v_company and dv.area_id is null and dv.status <> 'afgesloten')
    from public.companies c
    where c.id = v_company;
  end loop;
end;
$$;

comment on function public.haccp_dashboard(uuid[]) is
  'Dashboard HACCP Schoonmaak: per bedrijf en ruimte gepland/uitgevoerd vandaag, te laat, te controleren en open afwijkingen.';

-- 2. Rapportage: alle momenten in een periode, inclusief controle.
create or replace function public.haccp_report(p_company_id uuid, p_from date, p_to date)
returns table (
  occurrence_id    uuid,
  due_date         date,
  slot             smallint,
  slots_total      smallint,
  is_on_demand     boolean,
  title            text,
  version_no       integer,
  area_name        text,
  area_sort        integer,
  department_name  text,
  status           text,
  void_reason      text,
  completed_at     timestamptz,
  completed_by     text,
  clicked_by       text,
  done_late        boolean,
  check_status     text,
  checked_by       text,
  checked_at       timestamptz,
  has_corrections  boolean,
  problem_count    integer,
  photo_count      integer
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
    raise exception 'Geen toegang tot de HACCP-rapportage';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Kies een periode van maximaal ruim een jaar';
  end if;
  select coalesce(timezone, 'Europe/Amsterdam') into v_tz from public.companies where id = p_company_id;

  return query
  select o.id, o.due_date, o.slot,
         (case when v.frequency = 'meerdere_per_dag' then v.times_per_day else 1 end)::smallint,
         o.is_on_demand, v.title, v.version_no, a.name, a.sort_order, d.name,
         o.status, o.void_reason, o.completed_at, up.full_name,
         (select rb.full_name from public.haccp_events e join public.user_profiles rb on rb.id = e.recorded_by
          where e.occurrence_id = o.id and e.event_type = 'uitgevoerd' order by e.recorded_at desc limit 1),
         (o.completed_at is not null and (o.completed_at at time zone v_tz)::date > o.due_date),
         o.check_status, cb.full_name, o.checked_at,
         exists (select 1 from public.haccp_events e2 where e2.occurrence_id = o.id and e2.event_type in ('correctie', 'ingetrokken')),
         (select count(*)::integer from public.haccp_events e3 where e3.occurrence_id = o.id and e3.event_type = 'probleem'),
         (select count(*)::integer from public.haccp_photos p where p.occurrence_id = o.id)
  from public.haccp_occurrences o
  join public.haccp_task_versions v on v.id = o.version_id
  join public.haccp_tasks t on t.id = o.task_id
  join public.haccp_areas a on a.id = t.area_id
  left join public.departments d on d.id = v.department_id
  left join public.user_profiles up on up.id = o.completed_by
  left join public.user_profiles cb on cb.id = o.checked_by
  where o.company_id = p_company_id
    and o.due_date between p_from and p_to
    and not (o.is_on_demand and o.status = 'vervallen' and o.void_reason is null)
  order by o.due_date, a.sort_order, a.name, v.title, o.slot;
end;
$$;

-- 3. Bijzondere registraties in een periode (correcties, niet uitgevoerd,
--    ingetrokken, problemen, afkeuringen) met wie, wanneer en waarom.
create or replace function public.haccp_report_events(p_company_id uuid, p_from date, p_to date)
returns table (
  due_date      date,
  title         text,
  area_name     text,
  event_type    text,
  kind          text,
  performed_by  text,
  recorded_by   text,
  recorded_at   timestamptz,
  note          text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.has_module_permission(p_company_id, 'haccp_controle', 'view') then
    raise exception 'Geen toegang tot de HACCP-rapportage';
  end if;
  return query
  select o.due_date, v.title, a.name, e.event_type, e.details ->> 'soort',
         pb.full_name, rb.full_name, e.recorded_at, e.note
  from public.haccp_events e
  join public.haccp_occurrences o on o.id = e.occurrence_id
  join public.haccp_task_versions v on v.id = o.version_id
  join public.haccp_tasks t on t.id = o.task_id
  join public.haccp_areas a on a.id = t.area_id
  left join public.user_profiles pb on pb.id = e.performed_by
  left join public.user_profiles rb on rb.id = e.recorded_by
  where e.company_id = p_company_id
    and o.due_date between p_from and p_to
    and e.event_type in ('correctie', 'niet_uitgevoerd', 'ingetrokken', 'probleem', 'gecontroleerd_afgekeurd')
  order by e.recorded_at;
end;
$$;

-- 4. Het schoonmaakplan zoals het in de periode gold (taakversies).
create or replace function public.haccp_plan_versions(p_company_id uuid, p_from date, p_to date)
returns table (
  task_id          uuid,
  version_no       integer,
  title            text,
  area_name        text,
  area_sort        integer,
  department_name  text,
  frequency        text,
  times_per_day    smallint,
  weekday          smallint,
  month_day        smallint,
  month            smallint,
  instruction      text,
  cleaning_agent   text,
  valid_from       timestamptz,
  valid_to         timestamptz,
  task_active      boolean,
  requires_check   boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
begin
  if not public.has_module_permission(p_company_id, 'haccp_controle', 'view') then
    raise exception 'Geen toegang tot de HACCP-rapportage';
  end if;
  select coalesce(timezone, 'Europe/Amsterdam') into v_tz from public.companies where id = p_company_id;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;

  return query
  with vv as (
    select v.*, lead(v.created_at) over (partition by v.task_id order by v.version_no) as next_at
    from public.haccp_task_versions v
    where v.company_id = p_company_id
  )
  select vv.task_id, vv.version_no, vv.title, a.name, a.sort_order, d.name, vv.frequency,
         vv.times_per_day, vv.weekday, vv.month_day, vv.month, vv.instruction, vv.cleaning_agent,
         vv.created_at, vv.next_at, t.is_active, t.requires_check
  from vv
  join public.haccp_tasks t on t.id = vv.task_id
  join public.haccp_areas a on a.id = vv.area_id
  left join public.departments d on d.id = vv.department_id
  where vv.created_at < v_end
    and (vv.next_at is null or vv.next_at > v_start)
    and (t.is_active or exists (
      select 1 from public.haccp_occurrences o
      where o.task_id = t.id and o.version_id = vv.id and o.due_date between p_from and p_to))
  order by a.sort_order, a.name, vv.title, vv.version_no;
end;
$$;

grant execute on function public.haccp_dashboard(uuid[]) to authenticated;
grant execute on function public.haccp_report(uuid, date, date) to authenticated;
grant execute on function public.haccp_report_events(uuid, date, date) to authenticated;
grant execute on function public.haccp_plan_versions(uuid, date, date) to authenticated;

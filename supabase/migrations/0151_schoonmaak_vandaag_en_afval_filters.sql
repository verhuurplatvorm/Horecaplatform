-- 0151: Schoonmaak vandaag (tablet) en Afval & personeelsmaaltijden.
--
-- Alleen nieuwe leesfuncties; bestaande registraties, events en functies
-- blijven ongewijzigd (historie blijft volledig bewaard).
--
-- 1. haccp_board: de taken van vandaag (zelfde bron als haccp_today) met
--    daarbij of de taak controle door een leidinggevende vraagt en wat de
--    stand van die controle is. Afvinken (medewerker) en controle
--    (leidinggevende) blijven twee aparte registraties.
-- 2. haccp_overdue: apart overzicht achterstallige taken — oorspronkelijke
--    datum, taak en opvolging (alsnog gedaan, niet gedaan + reden,
--    gemelde problemen en maatregel). Nog openstaande taken altijd,
--    afgehandelde achterstand van de laatste p_days dagen.
-- 3. waste_overview: één bron voor het afvaloverzicht én het dashboardblok,
--    met dezelfde filters voor bedrijf(en) en periode. De periode telt in
--    de tijdzone van het bedrijf (Europe/Amsterdam), niet in UTC.

-- ---------------------------------------------------------------------
-- 1. Taken van vandaag + controle-informatie
-- ---------------------------------------------------------------------
create or replace function public.haccp_board(p_company_id uuid)
returns table(kind text, occurrence_id uuid, task_id uuid, title text, instruction text, cleaning_agent text,
              frequency text, area_id uuid, area_name text, area_sort integer, task_sort integer,
              department_id uuid, department_name text, due_date date, slot smallint, slots_total smallint,
              status text, is_late boolean, completed_at timestamptz, completed_by text, last_event_id uuid,
              done_today integer, requires_check boolean, check_status text, checked_at timestamptz,
              checked_by text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select t.kind, t.occurrence_id, t.task_id, t.title, t.instruction, t.cleaning_agent, t.frequency,
         t.area_id, t.area_name, t.area_sort, t.task_sort, t.department_id, t.department_name,
         t.due_date, t.slot, t.slots_total, t.status, t.is_late, t.completed_at, t.completed_by,
         t.last_event_id, t.done_today,
         coalesce(tk.requires_check, false), o.check_status, o.checked_at, cp.full_name
    from public.haccp_today(p_company_id) t        -- controleert ook de toegang tot het bedrijf
    join public.haccp_tasks tk on tk.id = t.task_id
    left join public.haccp_occurrences o on o.id = t.occurrence_id
    left join public.user_profiles cp on cp.id = o.checked_by
   where not t.is_late;
$$;

-- ---------------------------------------------------------------------
-- 2. Achterstallige taken met opvolging
-- ---------------------------------------------------------------------
create or replace function public.haccp_overdue(p_company_id uuid, p_days integer default 14)
returns table(occurrence_id uuid, task_id uuid, title text, area_id uuid, area_name text, area_sort integer,
              department_id uuid, department_name text, due_date date, slot smallint, slots_total smallint,
              status text, completed_at timestamptz, completed_by text,
              requires_check boolean, check_status text, checked_by text,
              not_done_reason text, not_done_by text, not_done_at timestamptz,
              deviation_count integer, open_deviation_count integer,
              last_deviation_status text, last_corrective_action text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare v_today date; v_tz text;
begin
  if not public.has_company_access(p_company_id) then raise exception 'Geen toegang tot dit bedrijf'; end if;
  v_today := public.haccp_company_today(p_company_id);
  select coalesce(timezone, 'Europe/Amsterdam') into v_tz from public.companies where id = p_company_id;
  return query
  select o.id, t.id, v.title, a.id, a.name, a.sort_order, d.id, d.name, o.due_date, o.slot,
         (case when v.frequency = 'meerdere_per_dag' then v.times_per_day else 1 end)::smallint,
         o.status, o.completed_at, up.full_name,
         coalesce(t.requires_check, false), o.check_status, cp.full_name,
         nd.note, ndp.full_name, nd.recorded_at,
         coalesce(dv.n, 0), coalesce(dv.n_open, 0), dv.last_status, dv.last_action
    from public.haccp_occurrences o
    join public.haccp_tasks t on t.id = o.task_id
    join public.haccp_task_versions v on v.id = o.version_id
    join public.haccp_areas a on a.id = t.area_id
    left join public.departments d on d.id = t.department_id
    left join public.user_profiles up on up.id = o.completed_by
    left join public.user_profiles cp on cp.id = o.checked_by
    left join lateral (
      select e.note, e.recorded_by, e.recorded_at
        from public.haccp_events e
       where e.occurrence_id = o.id and e.event_type = 'niet_uitgevoerd'
       order by e.recorded_at desc limit 1
    ) nd on true
    left join public.user_profiles ndp on ndp.id = nd.recorded_by
    left join lateral (
      select count(*)::int as n,
             count(*) filter (where x.status not in ('opgelost', 'afgesloten'))::int as n_open,
             (array_agg(x.status order by x.reported_at desc))[1] as last_status,
             (array_agg(x.corrective_action order by x.reported_at desc))[1] as last_action
        from public.haccp_deviations x
       where x.occurrence_id = o.id
    ) dv on true
   where o.company_id = p_company_id
     and not o.is_on_demand
     and o.status <> 'vervallen'
     and o.due_date < v_today
     and (
       o.status = 'open'
       or (o.due_date >= v_today - greatest(p_days, 1) and (
             o.status = 'niet_uitgevoerd'
             or (o.status = 'uitgevoerd' and (o.completed_at at time zone v_tz)::date > o.due_date)
             or coalesce(dv.n, 0) > 0))
     );
end; $$;

-- ---------------------------------------------------------------------
-- 3. Afval & personeelsmaaltijden: één bron met bedrijf + periode
-- ---------------------------------------------------------------------
-- p_company_ids null = alle bedrijven (incl. registraties zonder bedrijf);
-- anders alleen de gekozen bedrijven. p_from/p_to zijn kalenderdagen in
-- Europe/Amsterdam (beide inclusief). Geannuleerde registraties tellen niet.
create or replace function public.waste_overview(
  p_company_ids uuid[],
  p_from date,
  p_to date,
  p_type text default 'afval'
)
returns table(id uuid, registered_at timestamptz, local_date date, company_id uuid, company_name text,
              registration_type text, product_id uuid, recipe_id uuid, item_name text, item_kind text,
              quantity numeric, unit_name text, unit_dimension text, factor_to_base numeric,
              reason_id uuid, reason_name text, note text, waste_value numeric,
              registered_by uuid, staff_name text)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select w.id, w.registered_at, (w.registered_at at time zone 'Europe/Amsterdam')::date,
         w.company_id, c.name, w.registration_type::text, w.product_id, w.recipe_id,
         coalesce(nullif(trim(p.custom_name), ''), p.name, r.name),
         case when w.product_id is not null then 'ingrediënt' else 'halfproduct' end,
         w.quantity, u.name, u.dimension::text, u.factor_to_base,
         w.reason_id, wr.name, w.note, w.waste_value, w.registered_by, sp.full_name
    from public.waste_registrations w
    left join public.companies c on c.id = w.company_id
    left join public.products p on p.id = w.product_id
    left join public.recipes r on r.id = w.recipe_id
    left join public.units u on u.id = w.unit_id
    left join public.waste_reasons wr on wr.id = w.reason_id
    left join public.user_profiles sp on sp.id = w.registered_by
   where not w.is_cancelled
     and w.registration_type::text = coalesce(p_type, 'afval')
     and (w.registered_at at time zone 'Europe/Amsterdam')::date between p_from and p_to
     and (p_company_ids is null or w.company_id = any(p_company_ids))
   order by w.registered_at desc;
$$;

grant execute on function public.haccp_board(uuid) to authenticated;
grant execute on function public.haccp_overdue(uuid, integer) to authenticated;
grant execute on function public.waste_overview(uuid[], date, date, text) to authenticated;

-- 0116_haccp_plan_kopieren.sql
--
-- HACCP schoonmaakplan kopiëren naar een ander bedrijf (bv. keukenplan van
-- Het Strand naar Zomers). Voegt alleen toe: bestaande ruimtes worden op
-- naam hergebruikt, taken die er al staan (zelfde ruimte + naam) worden
-- overgeslagen. Afdeling wordt op naam gekoppeld, anders "Iedereen".
-- Registraties en historie worden niet gekopieerd.

create or replace function public.haccp_copy_plan(p_from_company uuid, p_to_company uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_area record;
  v_task record;
  v_target_area uuid;
  v_areas integer := 0;
  v_tasks integer := 0;
  v_skipped integer := 0;
begin
  if p_from_company = p_to_company then
    raise exception 'Kies een ander bedrijf';
  end if;
  if not public.has_module_permission(p_from_company, 'haccp_plan', 'view')
     or not public.has_module_permission(p_to_company, 'haccp_plan', 'edit') then
    raise exception 'Geen recht om dit schoonmaakplan te kopiëren';
  end if;
  select group_id into v_group from public.companies where id = p_to_company;

  for v_area in
    select * from public.haccp_areas where company_id = p_from_company and is_active order by sort_order, name
  loop
    select id into v_target_area from public.haccp_areas
    where company_id = p_to_company and lower(trim(name)) = lower(trim(v_area.name));
    if v_target_area is null then
      insert into public.haccp_areas (group_id, company_id, name, sort_order)
      values (v_group, p_to_company, v_area.name, v_area.sort_order)
      returning id into v_target_area;
      v_areas := v_areas + 1;
    else
      update public.haccp_areas set is_active = true where id = v_target_area and not is_active;
    end if;

    for v_task in
      select t.*, d.name as dept_name
      from public.haccp_tasks t
      left join public.departments d on d.id = t.department_id
      where t.area_id = v_area.id and t.is_active
      order by t.sort_order, t.title
    loop
      if exists (
        select 1 from public.haccp_tasks x
        where x.area_id = v_target_area and x.is_active and lower(trim(x.title)) = lower(trim(v_task.title))
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      insert into public.haccp_tasks (
        group_id, company_id, area_id, department_id, title, instruction, cleaning_agent,
        frequency, times_per_day, weekday, month_day, month, requires_check, sort_order
      ) values (
        v_group, p_to_company, v_target_area,
        (select d2.id from public.departments d2
          where d2.company_id = p_to_company and d2.is_active
            and lower(trim(d2.name)) = lower(trim(v_task.dept_name)) limit 1),
        v_task.title, v_task.instruction, v_task.cleaning_agent,
        v_task.frequency, v_task.times_per_day, v_task.weekday, v_task.month_day, v_task.month,
        v_task.requires_check, v_task.sort_order
      );
      v_tasks := v_tasks + 1;
    end loop;
  end loop;

  return jsonb_build_object('ruimtes', v_areas, 'taken', v_tasks, 'overgeslagen', v_skipped);
end;
$$;

comment on function public.haccp_copy_plan(uuid, uuid) is
  'Kopieert het actieve schoonmaakplan (ruimtes + taken) naar een ander bedrijf. Alleen toevoegen; dubbele taken worden overgeslagen.';

grant execute on function public.haccp_copy_plan(uuid, uuid) to authenticated;

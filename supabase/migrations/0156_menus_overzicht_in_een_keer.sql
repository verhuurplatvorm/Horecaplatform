-- 0156: Menu's & buffetten — kostprijs en controle van alle menu's in één
-- verzoek (was twee verzoeken per menu; met de sjablonen ruim 40 stuks).
-- Zelfde functies als op het menu zelf, dus dezelfde uitkomst.

create or replace function public.event_menus_overview(p_company_id uuid)
returns table(menu_id uuid, total_cost numeric, is_complete boolean, issues jsonb)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select m.id, public.calculate_event_menu_cost(m.id, p_company_id), s.is_complete, s.issues
    from public.event_menus m
    cross join lateral public.event_menu_cost_status(m.id, p_company_id) s;
$$;

grant execute on function public.event_menus_overview(uuid) to authenticated;

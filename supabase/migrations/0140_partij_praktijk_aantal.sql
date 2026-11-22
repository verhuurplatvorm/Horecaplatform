-- Partijgerechten: praktijk boven theorie.
--
-- Op de werklijst vul je in hoeveel vormen het in werkelijkheid werden
-- (bv. de sucade was genoeg voor 4 schalen i.p.v. 5). Dan wordt:
--   nieuwe inhoud per vorm = wat er gemaakt is / werkelijk aantal vormen
-- en dat gaat direct in het recept (recipes.party_capacity), zodat dit
-- menu en alle volgende menu's met het praktijkgewicht rekenen.
--
-- De keuken mag dit doen (ook de Operator-rol, die verder niets aan
-- recepten mag wijzigen): het gaat alleen om dit ene getal, via deze
-- functie, en elke aanpassing wordt vastgelegd.

create table if not exists public.party_capacity_adjustments (
  id                   uuid primary key default gen_random_uuid(),
  menu_id              uuid references public.event_menus(id) on delete set null,
  line_id              uuid references public.event_menu_lines(id) on delete set null,
  recipe_id            uuid not null references public.recipes(id) on delete cascade,
  planned_containers   integer not null,
  actual_containers    integer not null check (actual_containers > 0),
  produced             numeric not null,
  old_capacity         numeric not null,
  new_capacity         numeric not null,
  capacity_unit_id     uuid references public.units(id),
  adjusted_by          uuid default auth.uid() references auth.users(id) on delete set null,
  adjusted_at          timestamptz not null default now()
);
create index if not exists idx_party_capacity_adj_line on public.party_capacity_adjustments(line_id, adjusted_at desc);
create index if not exists idx_party_capacity_adj_recipe on public.party_capacity_adjustments(recipe_id, adjusted_at desc);

alter table public.party_capacity_adjustments enable row level security;
-- Lezen: wie het recept mag zien. Schrijven alleen via de functie hieronder.
drop policy if exists party_capacity_adjustments_select on public.party_capacity_adjustments;
create policy party_capacity_adjustments_select on public.party_capacity_adjustments
  for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id));
grant select on public.party_capacity_adjustments to authenticated;

create or replace function public.set_party_actual_containers(p_line_id uuid, p_actual integer)
returns table(old_capacity numeric, new_capacity numeric, capacity_unit text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_line record;
  v_plan record;
  v_new numeric;
begin
  if p_actual is null or p_actual < 1 then
    raise exception 'Vul een aantal van minimaal 1 in.';
  end if;

  select l.id, l.menu_id, l.recipe_id, m.company_id, m.group_id,
         r.party_capacity, r.party_capacity_unit_id, u.key as unit_key
  into v_line
  from public.event_menu_lines l
  join public.event_menus m on m.id = l.menu_id
  join public.recipes r on r.id = l.recipe_id
  left join public.units u on u.id = r.party_capacity_unit_id
  where l.id = p_line_id;
  if not found then
    raise exception 'Menuregel niet gevonden.';
  end if;

  -- Zelfde toegang als het menu zelf (policy event_menus_select).
  if not (
    (v_line.company_id is null and v_line.group_id = (select public.current_user_group_id()))
    or (select public.is_group_admin())
    or v_line.company_id in (select unnest(public.current_user_company_ids()))
  ) then
    raise exception 'Geen toegang tot dit menu.';
  end if;

  select * into v_plan from public.event_line_plan(p_line_id);
  if v_plan.is_party is not true or coalesce(v_plan.produced, 0) <= 0 then
    raise exception 'Dit is geen partijgerecht met een berekende productie.';
  end if;

  -- Naar boven afronden (1 decimaal), zodat het aantal vormen bij het
  -- herberekenen niet alsnog één hoger uitkomt.
  v_new := ceil(v_plan.produced / p_actual * 10) / 10.0;

  insert into public.party_capacity_adjustments(
    menu_id, line_id, recipe_id, planned_containers, actual_containers,
    produced, old_capacity, new_capacity, capacity_unit_id)
  values (
    v_line.menu_id, p_line_id, v_line.recipe_id, v_plan.containers, p_actual,
    v_plan.produced, v_line.party_capacity, v_new, v_line.party_capacity_unit_id);

  update public.recipes set party_capacity = v_new where id = v_line.recipe_id;

  old_capacity := v_line.party_capacity;
  new_capacity := v_new;
  capacity_unit := v_line.unit_key;
  return next;
end;
$$;
grant execute on function public.set_party_actual_containers(uuid, integer) to authenticated;

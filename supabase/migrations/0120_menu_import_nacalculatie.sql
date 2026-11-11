-- 0120_menu_import_nacalculatie.sql
--
-- Menu's & buffetten:
--  1. Sheet importeren: regels uit een Excel/CSV/PDF koppelen aan bestaande
--     gerechten, halfproducten of ingrediënten (match_menu_items).
--  2. Nacalculatie: wat er werkelijk is gebruikt (per menuregel + extra's),
--     met dezelfde prijsbronnen als de voorcalculatie.
-- Alleen toevoegen; bestaande tabellen en functies blijven ongewijzigd.

-- ---------------------------------------------------------------------
-- 1. Koppelvoorstellen voor importregels
-- ---------------------------------------------------------------------
create or replace function public.match_menu_items(p_names text[])
returns table (
  name_index integer,
  item_kind text,          -- gerecht | halfproduct | ingrediënt
  item_id uuid,
  item_name text,
  company_id uuid,
  status text,
  category text,
  similarity_score real,
  is_exact boolean
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with input as (
    select n.ord::integer as name_index, public.normalize_dish_name(n.name) as norm
    from unnest(p_names) with ordinality as n(name, ord)
  ),
  existing as (
    select case when r.recipe_kind = 'halfproduct' then 'halfproduct' else 'gerecht' end as kind,
           r.id, r.name, r.company_id, r.status::text as status, r.category,
           public.normalize_dish_name(r.name) as norm
    from public.recipes r
    where r.group_id = public.current_user_group_id()
      and r.status::text <> 'vervallen'
      and ((r.company_id is null) or public.has_company_access(r.company_id))
    union all
    select 'ingrediënt', p.id, coalesce(nullif(p.custom_name, ''), p.name), null::uuid,
           null::text, p.product_group,
           public.normalize_dish_name(coalesce(nullif(p.custom_name, ''), p.name))
    from public.products p
    where p.group_id = public.current_user_group_id()
      and coalesce(p.is_active, true)
  ),
  scored as (
    select i.name_index, e.kind, e.id, e.name, e.company_id, e.status, e.category,
           case when e.norm = i.norm then 1.0::real else similarity(e.norm, i.norm) end as score,
           (e.norm = i.norm) as exact
    from input i
    join existing e on e.norm = i.norm or similarity(e.norm, i.norm) > 0.4
    where i.norm <> ''
  ),
  ranked as (
    select s.*, row_number() over (
      partition by s.name_index
      order by s.exact desc, s.score desc,
               case s.kind when 'gerecht' then 0 when 'halfproduct' then 1 else 2 end,
               (s.status = 'goedgekeurd') desc, s.name
    ) as rn
    from scored s
  )
  select name_index - 1, kind, id, name, company_id, status, category, score, exact
  from ranked
  where rn <= 6
  order by name_index, rn;
$$;

grant execute on function public.match_menu_items(text[]) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Nacalculatie
-- ---------------------------------------------------------------------
alter table public.event_menus
  add column if not exists actual_person_count integer check (actual_person_count is null or actual_person_count >= 0),
  add column if not exists actual_notes text,
  add column if not exists actual_recorded_at timestamptz,
  add column if not exists actual_recorded_by uuid references public.user_profiles(id);

create table if not exists public.event_menu_actuals (
  id              uuid primary key default gen_random_uuid(),
  menu_id         uuid not null references public.event_menus(id) on delete cascade,
  line_id         uuid references public.event_menu_lines(id) on delete set null,
  recipe_id       uuid references public.recipes(id) on delete restrict,
  product_id      uuid references public.products(id) on delete restrict,
  quantity_total  numeric(14,4) not null check (quantity_total >= 0),
  unit_id         uuid references public.units(id),
  note            text,
  sort_order      integer not null default 0,
  created_by      uuid default auth.uid() references public.user_profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint event_menu_actual_target check (
    (recipe_id is not null and product_id is null)
    or (recipe_id is null and product_id is not null)
  )
);

create index if not exists idx_event_menu_actuals_menu on public.event_menu_actuals(menu_id);
create unique index if not exists event_menu_actuals_line_uq
  on public.event_menu_actuals(line_id) where line_id is not null;

comment on table public.event_menu_actuals is
  'Nacalculatie: werkelijk gebruikte hoeveelheid (totaal, niet per persoon). line_id = bij een geplande menuregel; leeg = extra gebruikt.';

alter table public.event_menu_actuals enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'event_menu_actuals_all') then
    create policy event_menu_actuals_all on public.event_menu_actuals
      for all using (exists (
        select 1 from public.event_menus m
        where m.id = event_menu_actuals.menu_id
          and m.group_id = public.current_user_group_id()
          and (m.company_id is null or public.has_company_access(m.company_id))
      ))
      with check (exists (
        select 1 from public.event_menus m
        where m.id = event_menu_actuals.menu_id
          and m.group_id = public.current_user_group_id()
          and (m.company_id is null or public.has_company_access(m.company_id))
      ));
  end if;
end $p$;

create or replace trigger trg_audit_event_menu_actuals
  after insert or update or delete on public.event_menu_actuals
  for each row execute function public.audit_row_change();

-- Kostprijs van één eenheid van een gerecht/halfproduct/ingrediënt —
-- dezelfde regels als get_event_menu_breakdown.
create or replace function public.event_item_unit_cost(
  p_recipe_id uuid,
  p_product_id uuid,
  p_unit_id uuid,
  p_company_id uuid
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base uuid;
  v_price numeric;
  v_one numeric;
  v_yield numeric;
  v_kind text;
  v_cost numeric;
  v_unit_key text;
begin
  if p_product_id is not null then
    select p.base_unit_id into v_base from public.products p where p.id = p_product_id;
    select cpc.price_per_base_unit into v_price
    from public.current_product_cost cpc
    where cpc.product_id = p_product_id and cpc.company_id = p_company_id;
    if v_price is null then return null; end if;
    v_one := public.convert_quantity(p_product_id, 1, p_unit_id, v_base, true);
    return case when v_one is null then null else v_one * v_price end;
  end if;

  if p_recipe_id is null then return null; end if;
  select r.yield_quantity, r.base_unit_id, r.recipe_kind::text
  into v_yield, v_base, v_kind
  from public.recipes r where r.id = p_recipe_id;
  v_cost := public.calculate_recipe_cost(p_recipe_id, p_company_id);
  if v_cost is null then return null; end if;
  select u.key into v_unit_key from public.units u where u.id = p_unit_id;
  if (v_yield is null or v_yield <= 0) then
    return case when v_kind = 'gerecht' and v_unit_key = 'stuk' then v_cost else null end;
  end if;
  v_one := public.convert_quantity(null, 1, p_unit_id, v_base, false);
  return case when v_one is null then null else (v_one / v_yield) * v_cost end;
end;
$$;

create or replace function public.get_event_menu_actuals(p_menu_id uuid, p_company_id uuid)
returns table (
  actual_id uuid,
  line_id uuid,
  recipe_id uuid,
  product_id uuid,
  display_name text,
  line_type text,
  quantity_total numeric,
  unit_id uuid,
  unit_name text,
  unit_price numeric,
  total_cost numeric,
  note text,
  sort_order integer
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.line_id, a.recipe_id, a.product_id,
         coalesce(r.name, nullif(p.custom_name, ''), p.name),
         case when a.product_id is not null then 'ingrediënt'
              when r.recipe_kind::text = 'halfproduct' then 'halfproduct' else 'gerecht' end,
         a.quantity_total, a.unit_id, u.name,
         round(c.unit_cost, 4),
         round(c.unit_cost * a.quantity_total, 4),
         a.note, a.sort_order
  from public.event_menu_actuals a
  join public.event_menus m on m.id = a.menu_id
  left join public.recipes r on r.id = a.recipe_id
  left join public.products p on p.id = a.product_id
  left join public.units u on u.id = a.unit_id
  cross join lateral (
    select public.event_item_unit_cost(a.recipe_id, a.product_id, a.unit_id, p_company_id) as unit_cost
  ) c
  where a.menu_id = p_menu_id
    and m.group_id = public.current_user_group_id()
    and (m.company_id is null or public.has_company_access(m.company_id))
  order by a.line_id is null, a.sort_order, a.created_at;
$$;

grant execute on function public.event_item_unit_cost(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.get_event_menu_actuals(uuid, uuid) to authenticated;

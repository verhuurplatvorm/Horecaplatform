-- 0154: Arrangementen (BBQ, buffet, lunch, borrel, vergaderen) via Menu's & buffetten.
--
-- 1. Minimaal aantal personen: "Prijs t/m 25 personen: 937,50" = 25 × 37,50.
--    De verkoop rekent met max(gasten, minimum); de kostprijs met de echte gasten.
-- 2. Opties per onderdeel (sectie) met een eigen verkoopprijs p.p., aan/uit
--    per boeking (bv. "Extra op de BBQ: Gamba's 5,-", "Dessertbuffet 12,50").
--    Een niet-gekozen optie telt nergens mee: geen kostprijs, geen werklijst,
--    geen bestellijst (event_line_plan geeft dan 0 terug).
-- 3. Toeslagen buiten de foodcost: per persoon (drankenarrangement), vast
--    (tv-scherm, podium) of per staffel (kok bij de BBQ: t/m 40 → 150, …).
-- 4. Nieuwe boeking vanuit een sjabloon (kopie van menu, onderdelen,
--    regels en toeslagen).

alter table public.event_menus
  add column if not exists min_persons integer check (min_persons is null or min_persons > 0);

alter table public.event_menu_sections
  add column if not exists option_price_pp numeric check (option_price_pp is null or option_price_pp >= 0),
  add column if not exists is_selected boolean not null default true;

comment on column public.event_menus.min_persons is
  'Verkoop rekent met minimaal dit aantal personen (prijs t/m N personen).';
comment on column public.event_menu_sections.option_price_pp is
  'Gevuld = dit onderdeel is een optie met eigen verkoopprijs per persoon (incl. btw).';
comment on column public.event_menu_sections.is_selected is
  'Optie gekozen? Niet gekozen = telt niet mee in kostprijs, werklijst en bestellijst.';

-- ---------------------------------------------------------------------
-- Toeslagen
-- ---------------------------------------------------------------------
create table if not exists public.event_menu_charges (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.event_menus(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'per_persoon' check (kind in ('per_persoon', 'vast', 'staffel')),
  amount numeric not null default 0,
  -- staffel: [{"tot": 40, "bedrag": 150}, {"tot": 100, "bedrag": 250}, {"tot": null, "bedrag": 300}]
  tiers jsonb not null default '[]'::jsonb,
  vat_rate numeric not null default 21,
  is_selected boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists event_menu_charges_menu_idx on public.event_menu_charges (menu_id, sort_order);

alter table public.event_menu_charges enable row level security;

create policy event_menu_charges_all on public.event_menu_charges
  for all using (exists (select 1 from public.event_menus m where m.id = event_menu_charges.menu_id))
  with check (exists (select 1 from public.event_menus m where m.id = event_menu_charges.menu_id));
create policy operator_readonly_insert on public.event_menu_charges
  as restrictive for insert to authenticated with check (not (select public.current_user_is_operator()));
create policy operator_readonly_update on public.event_menu_charges
  as restrictive for update to authenticated using (not (select public.current_user_is_operator()));
create policy operator_readonly_delete on public.event_menu_charges
  as restrictive for delete to authenticated using (not (select public.current_user_is_operator()));

grant select, insert, update, delete on public.event_menu_charges to authenticated;

-- ---------------------------------------------------------------------
-- Schaalberekening: niet-gekozen optie = 0 nodig (verder ongewijzigd)
-- ---------------------------------------------------------------------
create or replace function public.event_line_plan(p_line_id uuid)
returns table(needed numeric, is_party boolean, needed_cap numeric, capacity numeric, containers_exact numeric,
              containers integer, full_containers boolean, produced numeric, last_container numeric,
              recipe_factor numeric, per_container numeric)
language plpgsql
stable
as $function$
declare
  v_line record;
  v_persons integer;
  v_cap_base numeric;
  v_yield_base numeric;
begin
  select l.quantity_per_person, l.unit_id, l.is_fixed, l.participation_pct, l.full_containers as line_full,
         l.recipe_id, m.person_count, coalesce(s.is_selected, true) as section_selected,
         r.party_capacity, r.party_capacity_unit_id, r.party_full_containers, r.yield_quantity,
         cu.dimension as cap_dim, cu.factor_to_base as cap_factor,
         bu.dimension as base_dim, bu.factor_to_base as base_factor
  into v_line
  from public.event_menu_lines l
  join public.event_menus m on m.id = l.menu_id
  left join public.event_menu_sections s on s.id = l.section_id
  left join public.recipes r on r.id = l.recipe_id
  left join public.units cu on cu.id = r.party_capacity_unit_id
  left join public.units bu on bu.id = r.base_unit_id
  where l.id = p_line_id;
  if not found then
    return;
  end if;

  v_persons := coalesce(v_line.person_count, 0);
  needed := v_line.quantity_per_person *
    (case when v_line.is_fixed then 1
          else v_persons * coalesce(v_line.participation_pct, 100) / 100.0 end);
  -- Optie niet gekozen: nergens meetellen.
  if not v_line.section_selected then
    needed := 0;
  end if;

  is_party := false;
  if v_line.recipe_id is not null and v_line.party_capacity is not null
     and v_line.party_capacity > 0 and v_line.party_capacity_unit_id is not null then
    needed_cap := public.convert_recipe_quantity(v_line.recipe_id, needed, v_line.unit_id, v_line.party_capacity_unit_id);
    if needed_cap is not null then
      is_party := true;
      capacity := v_line.party_capacity;

      per_container := 1;
      if v_line.cap_dim in ('gewicht', 'inhoud') and v_line.base_dim in ('gewicht', 'inhoud')
         and coalesce(v_line.yield_quantity, 0) > 0 then
        v_cap_base := v_line.party_capacity * v_line.cap_factor;
        v_yield_base := v_line.yield_quantity * v_line.base_factor;
        per_container := greatest(1, v_cap_base / v_yield_base);
      elsif v_line.cap_dim = 'aantal' then
        per_container := v_line.party_capacity / (case when v_line.base_dim = 'aantal' and coalesce(v_line.yield_quantity, 0) > 0 then v_line.yield_quantity * v_line.base_factor else 1 end);
      end if;

      containers_exact := needed_cap / capacity;
      containers := ceil(round(containers_exact, 6))::integer;
      full_containers := coalesce(v_line.line_full, v_line.party_full_containers, true);
      if containers = 0 then
        produced := 0; last_container := 0; recipe_factor := 0;
      elsif full_containers then
        produced := containers * capacity;
        last_container := capacity;
        recipe_factor := containers * per_container;
      else
        produced := needed_cap;
        last_container := needed_cap - (containers - 1) * capacity;
        recipe_factor := containers_exact * per_container;
      end if;
    end if;
  end if;
  return next;
end;
$function$;

-- ---------------------------------------------------------------------
-- Nieuwe boeking vanuit sjabloon
-- ---------------------------------------------------------------------
create or replace function public.event_menu_copy(
  p_source_id uuid,
  p_name text,
  p_person_count integer,
  p_service_date date default null,
  p_company_id uuid default null,
  p_as_template boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_src public.event_menus%rowtype;
  v_new uuid := gen_random_uuid();
  v_sec record;
  v_new_sec uuid;
begin
  select * into v_src from public.event_menus where id = p_source_id;   -- RLS: alleen zichtbare menu's
  if not found then raise exception 'Menu niet gevonden'; end if;
  if coalesce(p_person_count, 0) <= 0 then raise exception 'Vul het aantal personen in'; end if;

  insert into public.event_menus (
    id, group_id, company_id, name, description, category, menu_type, service_date, status,
    pos_reference, notes, person_count, fixed_costs, desired_foodcost_pct, sales_price_per_person,
    vat_rate, is_template, created_by, min_persons, folder_id)
  values (
    v_new, v_src.group_id, coalesce(p_company_id, v_src.company_id),
    coalesce(nullif(trim(p_name), ''), v_src.name), v_src.description, v_src.category, v_src.menu_type,
    p_service_date, 'concept', null, v_src.notes, p_person_count, v_src.fixed_costs,
    v_src.desired_foodcost_pct, v_src.sales_price_per_person, v_src.vat_rate, coalesce(p_as_template, false),
    auth.uid(), v_src.min_persons, case when p_as_template then v_src.folder_id end);

  for v_sec in select * from public.event_menu_sections where menu_id = p_source_id order by sort_order loop
    v_new_sec := gen_random_uuid();
    insert into public.event_menu_sections (id, menu_id, name, sort_order, option_price_pp, is_selected)
    values (v_new_sec, v_new, v_sec.name, v_sec.sort_order, v_sec.option_price_pp, v_sec.is_selected);
    insert into public.event_menu_lines (menu_id, section_id, recipe_id, product_id, quantity_per_person,
           unit_id, is_fixed, note, sort_order, participation_pct, full_containers)
    select v_new, v_new_sec, l.recipe_id, l.product_id, l.quantity_per_person, l.unit_id, l.is_fixed,
           l.note, l.sort_order, l.participation_pct, l.full_containers
      from public.event_menu_lines l where l.menu_id = p_source_id and l.section_id = v_sec.id;
  end loop;

  insert into public.event_menu_lines (menu_id, section_id, recipe_id, product_id, quantity_per_person,
         unit_id, is_fixed, note, sort_order, participation_pct, full_containers)
  select v_new, null, l.recipe_id, l.product_id, l.quantity_per_person, l.unit_id, l.is_fixed,
         l.note, l.sort_order, l.participation_pct, l.full_containers
    from public.event_menu_lines l where l.menu_id = p_source_id and l.section_id is null;

  insert into public.event_menu_charges (menu_id, name, kind, amount, tiers, vat_rate, is_selected, sort_order)
  select v_new, c.name, c.kind, c.amount, c.tiers, c.vat_rate, c.is_selected, c.sort_order
    from public.event_menu_charges c where c.menu_id = p_source_id;

  return v_new;
end;
$$;

grant execute on function public.event_menu_copy(uuid, text, integer, date, uuid, boolean) to authenticated;

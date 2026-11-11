-- 0119_keukenlijsten.sql
--
-- Keuken → Keukenlijsten & Besteloverzicht.
--
-- * Alleen toevoegen; niets bestaands wordt gewijzigd of verwijderd.
-- * Geen voorraad, geen kopieën van recepten: kitchen_list() leest altijd de
--   actuele menukaart- en receptgegevens.
-- * Partie-regels (zie claude/keukenlijsten-plan.md):
--     regelpartie (recipe_ingredients.station_id)
--   > eigen partie van het halfproduct (recipes.station_id)
--   > geërfd van bovenliggend halfproduct/gerecht
--   > hoofdpartie van het gerecht (recipes.station_id)
--   > niet ingedeeld.
--   Elke regel krijgt precies één partie: niets wordt dubbel geteld.

-- ---------------------------------------------------------------------
-- 1. Parties
-- ---------------------------------------------------------------------
create table if not exists public.kitchen_stations (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null default public.current_user_group_id()
                references public.groups(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  short_name  text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create unique index if not exists kitchen_stations_name_uq
  on public.kitchen_stations (group_id, lower(trim(name)));

comment on table public.kitchen_stations is
  'Keukenparties (Garde-manger, Entremetier, Pâtisserie, Roti). Per groep, aanvulbaar.';

insert into public.kitchen_stations (group_id, name, short_name, sort_order)
select g.id, v.name, v.short_name, v.sort_order
from public.groups g
cross join (values
  ('Garde-manger', 'Garde', 10),
  ('Entremetier', 'Entre', 20),
  ('Pâtisserie', 'Pâtis', 30),
  ('Roti', 'Roti', 40)
) as v(name, short_name, sort_order)
on conflict do nothing;

alter table public.kitchen_stations enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'kitchen_stations_select') then
    create policy kitchen_stations_select on public.kitchen_stations
      for select using (group_id = public.current_user_group_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'kitchen_stations_write') then
    create policy kitchen_stations_write on public.kitchen_stations
      for all using (group_id = public.current_user_group_id() and public.is_group_admin())
      with check (group_id = public.current_user_group_id() and public.is_group_admin());
  end if;
end $p$;

-- ---------------------------------------------------------------------
-- 2. Partie op recept en op receptregel
-- ---------------------------------------------------------------------
alter table public.recipes
  add column if not exists station_id uuid references public.kitchen_stations(id) on delete set null;
alter table public.recipe_ingredients
  add column if not exists station_id uuid references public.kitchen_stations(id) on delete set null;

comment on column public.recipes.station_id is
  'Gerecht: hoofdpartie. Halfproduct: partie die het maakt (leeg = erft van het gerecht dat het gebruikt).';
comment on column public.recipe_ingredients.station_id is
  'Optioneel: deze regel (ingrediënt of halfproduct) hoort bij een andere partie dan het recept, bv. garnituur door Entremetier.';

-- Wie recepten mag bewerken mag de partie zetten (ook voor groepsbrede recepten).
create or replace function public.kitchen_can_edit_recipes()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_group_admin()
    or exists (
      select 1 from public.user_company_access uca
      join public.role_permissions rp on rp.role_id = uca.role_id
      where uca.user_id = auth.uid()
        and rp.module_key in ('recepturen', 'halfproducten', 'menukaarten')
        and rp.can_edit
    );
$$;

create or replace function public.set_recipe_station(p_recipe_ids uuid[], p_station_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.kitchen_can_edit_recipes() then
    raise exception 'Geen recht om recepten aan te passen';
  end if;
  if p_station_id is not null and not exists (
    select 1 from public.kitchen_stations
    where id = p_station_id and group_id = public.current_user_group_id()
  ) then
    raise exception 'Onbekende partie';
  end if;
  update public.recipes r
  set station_id = p_station_id
  where r.id = any(p_recipe_ids)
    and r.group_id = public.current_user_group_id()
    and r.station_id is distinct from p_station_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.set_recipe_line_station(p_line_id uuid, p_station_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.kitchen_can_edit_recipes() then
    raise exception 'Geen recht om recepten aan te passen';
  end if;
  if p_station_id is not null and not exists (
    select 1 from public.kitchen_stations
    where id = p_station_id and group_id = public.current_user_group_id()
  ) then
    raise exception 'Onbekende partie';
  end if;
  update public.recipe_ingredients ri
  set station_id = p_station_id
  from public.recipes r
  where ri.id = p_line_id
    and r.id = ri.recipe_id
    and r.group_id = public.current_user_group_id();
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Bestelapp: handmatig afvinken (per bedrijf)
-- ---------------------------------------------------------------------
create table if not exists public.order_app_checks (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  supplier_id  uuid references public.suppliers(id) on delete cascade,
  status       text not null check (status in ('ja', 'nee', 'onbekend')),
  updated_by   uuid default auth.uid() references public.user_profiles(id),
  updated_at   timestamptz not null default now()
);

create unique index if not exists order_app_checks_uq
  on public.order_app_checks (company_id, product_id, coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid));

comment on table public.order_app_checks is
  'Handmatig afgevinkt: staat dit artikel in onze bestelapp (ja/nee/onbekend)? Geen voorraad.';

alter table public.order_app_checks enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'order_app_checks_all') then
    create policy order_app_checks_all on public.order_app_checks
      for all using (public.has_company_access(company_id))
      with check (public.has_company_access(company_id));
  end if;
end $p$;

create or replace trigger trg_audit_order_app_checks
  after insert or update or delete on public.order_app_checks
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------
-- 4. kitchen_list(): de hele receptboom van één of meer menukaarten
-- ---------------------------------------------------------------------
-- Eén regel per receptregel (ingrediënt, halfproduct of ongekoppeld), plus
-- een regel voor gerechten zonder receptuur en voor lussen. Hoeveelheden
-- alleen als p_portions (jsonb {recipe_id: porties}) is meegegeven.
create or replace function public.kitchen_list(
  p_card_ids uuid[],
  p_portions jsonb default null
)
returns table (
  dish_id          uuid,
  line_id          uuid,
  recipe_id        uuid,       -- recept waar de regel in staat
  path             uuid[],     -- gerecht → … → recipe_id
  depth            integer,
  kind             text,       -- product | halfproduct | ongekoppeld | geen_receptuur | lus
  product_id       uuid,
  sub_recipe_id    uuid,
  unmatched_name   text,
  line_quantity    numeric,
  line_unit        text,
  station_id       uuid,       -- partie van deze regel (wie het nodig heeft / maakt)
  station_source   text,       -- regel | halfproduct | geerfd | gerecht
  using_station_id uuid,       -- bij halfproduct: partie die het gebruikt
  quantity_base    numeric,    -- benodigde hoeveelheid in basiseenheid (product) of opbrengsteenheid (halfproduct)
  problem          text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.menu_cards mc
    where mc.id = any(p_card_ids)
      and not ((mc.company_id is null and mc.group_id = public.current_user_group_id())
               or public.has_company_access(mc.company_id))
  ) then
    raise exception 'Geen toegang tot deze menukaart';
  end if;

  return query
  with recursive dishes as (
    select distinct mi.recipe_id as dish_id
    from public.menu_items mi
    join public.menu_folders mf on mf.id = mi.folder_id
    where mf.menu_card_id = any(p_card_ids)
      and mi.recipe_id is not null
  ),
  -- t = "context": een recept dat wordt uitgeklapt, met de partie die
  -- voor zijn inhoud geldt en de schaalfactor (null = geen hoeveelheden).
  t(dish_id, recipe_id, path, depth, ctx_station, ctx_source, factor, factor_problem) as (
    select d.dish_id, d.dish_id, array[d.dish_id], 0,
           r.station_id, case when r.station_id is not null then 'gerecht' end,
           case when p_portions ? d.dish_id::text
                then nullif((p_portions ->> d.dish_id::text)::numeric, 0) end,
           null::text
    from dishes d
    join public.recipes r on r.id = d.dish_id
    union all
    select t.dish_id, ri.sub_recipe_id, t.path || ri.sub_recipe_id, t.depth + 1,
           coalesce(ri.station_id, sr.station_id, t.ctx_station),
           case when ri.station_id is not null then 'regel'
                when sr.station_id is not null then 'halfproduct'
                when t.ctx_station is not null then 'geerfd' end,
           case when t.factor is null then null
                when coalesce(sr.yield_quantity, 0) <= 0 then null
                else t.factor * public.convert_quantity(null, ri.quantity, ri.unit_id, sr.base_unit_id, false)
                     / sr.yield_quantity end,
           case when t.factor is null then t.factor_problem
                when coalesce(sr.yield_quantity, 0) <= 0 then 'halfproduct zonder opbrengst'
                when public.convert_quantity(null, ri.quantity, ri.unit_id, sr.base_unit_id, false) is null
                  then 'eenheid niet om te rekenen'
                else t.factor_problem end
    from t
    join public.recipe_ingredients ri on ri.recipe_id = t.recipe_id
    join public.recipes sr on sr.id = ri.sub_recipe_id
    where ri.sub_recipe_id is not null
      and not ri.sub_recipe_id = any(t.path)
      and t.depth < 15
  )
  -- Ingrediënten en ongekoppelde regels
  select t.dish_id, ri.id, t.recipe_id, t.path, t.depth,
         case when ri.product_id is not null then 'product' else 'ongekoppeld' end,
         ri.product_id, null::uuid, ri.unmatched_name, ri.quantity, ri.unit,
         coalesce(ri.station_id, t.ctx_station),
         case when ri.station_id is not null then 'regel' else t.ctx_source end,
         null::uuid,
         case when ri.product_id is null or t.factor is null then null
              else t.factor * public.convert_quantity(ri.product_id, ri.quantity, ri.unit_id, p.base_unit_id, false) end,
         case when ri.product_id is null then 'ongekoppelde regel'
              when coalesce(ri.quantity, 0) = 0 then 'hoeveelheid 0'
              when t.factor is not null and t.factor_problem is not null then t.factor_problem
              when t.factor is not null
                   and public.convert_quantity(ri.product_id, ri.quantity, ri.unit_id, p.base_unit_id, false) is null
                then 'eenheid niet om te rekenen'
              when p_portions is not null and t.factor is null and t.factor_problem is not null then t.factor_problem
         end
  from t
  join public.recipe_ingredients ri on ri.recipe_id = t.recipe_id
  left join public.products p on p.id = ri.product_id
  where ri.sub_recipe_id is null
  union all
  -- Halfproducten (de regel in het bovenliggende recept)
  select t.dish_id, ri.id, t.recipe_id, t.path, t.depth, 'halfproduct',
         null::uuid, ri.sub_recipe_id, null::text, ri.quantity, ri.unit,
         coalesce(ri.station_id, sr.station_id, t.ctx_station),
         case when ri.station_id is not null then 'regel'
              when sr.station_id is not null then 'halfproduct'
              else t.ctx_source end,
         t.ctx_station,
         case when t.factor is null then null
              else t.factor * public.convert_quantity(null, ri.quantity, ri.unit_id, sr.base_unit_id, false) end,
         case when coalesce(ri.quantity, 0) = 0 then 'hoeveelheid 0'
              when sr.id is not null and not exists (select 1 from public.recipe_ingredients x where x.recipe_id = sr.id)
                then 'halfproduct zonder ingrediënten'
              when coalesce(sr.yield_quantity, 0) <= 0 then 'halfproduct zonder opbrengst'
         end
  from t
  join public.recipe_ingredients ri on ri.recipe_id = t.recipe_id
  left join public.recipes sr on sr.id = ri.sub_recipe_id
  where ri.sub_recipe_id is not null
    and not ri.sub_recipe_id = any(t.path)
  union all
  -- Lussen (recept verwijst via halfproducten naar zichzelf)
  select t.dish_id, ri.id, t.recipe_id, t.path, t.depth, 'lus',
         null::uuid, ri.sub_recipe_id, null::text, ri.quantity, ri.unit,
         t.ctx_station, t.ctx_source, null::uuid, null::numeric,
         'recept verwijst naar zichzelf (lus)'
  from t
  join public.recipe_ingredients ri on ri.recipe_id = t.recipe_id
  where ri.sub_recipe_id is not null and ri.sub_recipe_id = any(t.path)
  union all
  -- Gerechten zonder receptuur
  select d.dish_id, null::uuid, d.dish_id, array[d.dish_id], 0, 'geen_receptuur',
         null::uuid, null::uuid, null::text, null::numeric, null::text,
         r.station_id, case when r.station_id is not null then 'gerecht' end,
         null::uuid, null::numeric, 'gerecht zonder receptuur'
  from dishes d
  join public.recipes r on r.id = d.dish_id
  where not exists (select 1 from public.recipe_ingredients x where x.recipe_id = d.dish_id);
end;
$$;

comment on function public.kitchen_list(uuid[], jsonb) is
  'Klapt alle gerechten van de gekozen menukaarten uit tot op ingrediëntniveau (alle lagen halfproducten), met partie per regel, optionele hoeveelheden en gemelde problemen. Alleen lezen.';

grant execute on function public.kitchen_list(uuid[], jsonb) to authenticated;
grant execute on function public.set_recipe_station(uuid[], uuid) to authenticated;
grant execute on function public.set_recipe_line_station(uuid, uuid) to authenticated;
grant execute on function public.kitchen_can_edit_recipes() to authenticated;

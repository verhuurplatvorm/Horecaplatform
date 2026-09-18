-- 0069_afvalregistratie.sql
--
-- Afvalregistratie: wat wordt weggegooid, waarom, hoeveel en wat is het
-- waard. Puur een analyse van verspilling en kosten.
--
-- LET OP: dit staat bewust volledig los van voorraad. Een afvalboeking
-- maakt geen voorraadmutatie aan en raakt de voorraadmodule niet.
--
-- Hergebruikt bestaande stamgegevens — geen dubbele lijsten:
--   ingrediënten   -> public.products
--   halfproducten  -> public.recipes (recipe_kind = 'halfproduct')
--   eenheden       -> public.units + public.convert_quantity
--   kostprijzen    -> public.current_product_cost / calculate_recipe_cost
--   medewerkers    -> public.user_profiles
--   locaties       -> public.companies

-- Snelle selectie op een keukentablet zonder volledig in te loggen.
alter table public.user_profiles
  add column if not exists staff_pin text;

comment on column public.user_profiles.staff_pin is
  'Korte personeelscode voor snelle selectie bij afvalregistratie op een gedeelde tablet. Geen wachtwoord: geeft geen toegang tot de rest van het systeem.';

-- ---------------------------------------------------------------------
-- Redenen: beheerbaar, geen vrije tekst als enige reden.
-- ---------------------------------------------------------------------
create table public.waste_reasons (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (group_id, name)
);

create index idx_waste_reasons_group on public.waste_reasons(group_id, is_active);

-- Standaardredenen voor elke bestaande groep.
insert into public.waste_reasons (group_id, name, sort_order)
select g.id, r.name, r.ord
from public.groups g
cross join (values
  ('Over datum', 1),
  ('Overgeproduceerd', 2),
  ('Aangebrand', 3),
  ('Gevallen', 4),
  ('Verkeerd bereid', 5),
  ('Kwaliteit onvoldoende', 6),
  ('Snijverlies', 7),
  ('Gebroken/beschadigd', 8),
  ('Retour keuken', 9),
  ('Productiefout', 10),
  ('Verkeerde bestelling', 11),
  ('Restant einde dag', 12),
  ('Anders', 99)
) as r(name, ord)
on conflict (group_id, name) do nothing;

-- ---------------------------------------------------------------------
-- De registraties zelf.
-- ---------------------------------------------------------------------
create table public.waste_registrations (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups(id) on delete cascade,
  company_id     uuid references public.companies(id) on delete set null,
  -- Precies één van beide: een ingrediënt of een halfproduct.
  product_id     uuid references public.products(id) on delete restrict,
  recipe_id      uuid references public.recipes(id) on delete restrict,
  quantity       numeric(12,4) not null check (quantity > 0),
  unit_id        uuid references public.units(id),
  reason_id      uuid references public.waste_reasons(id) on delete restrict,
  note           text,
  photo_url      text,
  -- Waarde op het moment van registreren. Bewust vastgelegd: een latere
  -- prijswijziging mag een boeking uit het verleden niet veranderen.
  unit_cost      numeric(12,6),
  waste_value    numeric(12,4),
  registered_by  uuid references public.user_profiles(id),
  registered_at  timestamptz not null default now(),
  -- Correcties blijven zichtbaar in plaats van te verdwijnen.
  corrected_at   timestamptz,
  corrected_by   uuid references public.user_profiles(id),
  is_cancelled   boolean not null default false,
  constraint waste_target check (
    (product_id is not null and recipe_id is null)
    or (product_id is null and recipe_id is not null)
  )
);

create index idx_waste_registrations_group_date
  on public.waste_registrations(group_id, registered_at desc);
create index idx_waste_registrations_company on public.waste_registrations(company_id);
create index idx_waste_registrations_product on public.waste_registrations(product_id);
create index idx_waste_registrations_recipe on public.waste_registrations(recipe_id);
create index idx_waste_registrations_reason on public.waste_registrations(reason_id);

comment on table public.waste_registrations is
  'Geregistreerd afval/derving. Staat los van voorraad: er worden geen voorraadmutaties uit afgeleid.';
comment on column public.waste_registrations.waste_value is
  'Berekende afvalwaarde op het moment van registreren, zodat historische cijfers niet meebewegen met latere prijswijzigingen.';

-- ---------------------------------------------------------------------
-- Waarde berekenen uit de bestaande kostprijzen.
-- ---------------------------------------------------------------------
create or replace function public.calculate_waste_value(
  p_product_id uuid,
  p_recipe_id uuid,
  p_quantity numeric,
  p_unit_id uuid,
  p_company_id uuid
)
returns table (unit_cost numeric, waste_value numeric)
language plpgsql
stable
as $$
declare
  v_base_unit_id uuid;
  v_price_per_base numeric;
  v_qty_in_base numeric;
  v_yield numeric;
  v_recipe_cost numeric;
begin
  if p_product_id is not null then
    select p.base_unit_id into v_base_unit_id
    from public.products p where p.id = p_product_id;

    select cpc.price_per_base_unit into v_price_per_base
    from public.current_product_cost cpc
    where cpc.product_id = p_product_id and cpc.company_id = p_company_id;

    -- Weggegooid product is verloren zoals het is: rekenen met netto
    -- bruikbaar, net als bij de receptkostprijs.
    v_qty_in_base := public.convert_quantity(
      p_product_id, p_quantity, p_unit_id, v_base_unit_id, true
    );
    if v_price_per_base is null or v_qty_in_base is null then
      return query select null::numeric, null::numeric;
      return;
    end if;
    return query select
      round(v_price_per_base, 6),
      round(v_qty_in_base * v_price_per_base, 4);

  elsif p_recipe_id is not null then
    select r.yield_quantity, r.base_unit_id
    into v_yield, v_base_unit_id
    from public.recipes r where r.id = p_recipe_id;

    v_recipe_cost := public.calculate_recipe_cost(p_recipe_id, p_company_id);
    v_qty_in_base := public.convert_quantity(
      null, p_quantity, p_unit_id, v_base_unit_id, false
    );
    if v_recipe_cost is null or v_yield is null or v_yield <= 0 or v_qty_in_base is null then
      return query select null::numeric, null::numeric;
      return;
    end if;
    return query select
      round(v_recipe_cost / v_yield, 6),
      round(v_qty_in_base / v_yield * v_recipe_cost, 4);
  end if;

  return query select null::numeric, null::numeric;
end;
$$;

comment on function public.calculate_waste_value(uuid, uuid, numeric, uuid, uuid) is
  'Afvalwaarde van een hoeveelheid ingrediënt of halfproduct, via de bestaande kostprijzen en eenheidsconversie. Geeft de prijs per basiseenheid en de totale waarde.';

-- ---------------------------------------------------------------------
-- Samenvatting voor het dashboardpaneel.
-- ---------------------------------------------------------------------
create or replace function public.waste_summary(
  p_company_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  total_value numeric,
  registration_count integer,
  total_kg numeric,
  total_liter numeric,
  total_pieces numeric,
  previous_value numeric,
  ingredient_value numeric,
  halfproduct_value numeric
)
language sql
stable
as $$
  with bounds as (
    select
      coalesce(p_from, date_trunc('month', current_date)::date) as d_from,
      coalesce(p_to, current_date) as d_to
  ),
  prev as (
    select
      (select d_from from bounds) - ((select d_to from bounds) - (select d_from from bounds) + 1) as p_from,
      (select d_from from bounds) - 1 as p_to
  ),
  rows_in_period as (
    select w.*, u.dimension, u.factor_to_base
    from public.waste_registrations w
    left join public.units u on u.id = w.unit_id
    where not w.is_cancelled
      and (p_company_id is null or w.company_id = p_company_id)
      and w.registered_at::date between (select d_from from bounds) and (select d_to from bounds)
  )
  select
    coalesce(sum(waste_value), 0),
    count(*)::integer,
    coalesce(sum(case when dimension = 'gewicht' then quantity * factor_to_base / 1000 end), 0),
    coalesce(sum(case when dimension = 'inhoud' then quantity * factor_to_base / 1000 end), 0),
    coalesce(sum(case when dimension = 'aantal' then quantity end), 0),
    (select coalesce(sum(w2.waste_value), 0)
     from public.waste_registrations w2, prev
     where not w2.is_cancelled
       and (p_company_id is null or w2.company_id = p_company_id)
       and w2.registered_at::date between prev.p_from and prev.p_to),
    coalesce(sum(case when product_id is not null then waste_value end), 0),
    coalesce(sum(case when recipe_id is not null then waste_value end), 0)
  from rows_in_period;
$$;

comment on function public.waste_summary(uuid, date, date) is
  'Totalen voor het afvaldashboard over een periode, met de waarde van de daarvoor liggende even lange periode ter vergelijking.';

-- ---------------------------------------------------------------------
-- Rechten en toegang
-- ---------------------------------------------------------------------
alter table public.waste_reasons enable row level security;
alter table public.waste_registrations enable row level security;

create policy waste_reasons_all on public.waste_reasons
  for all using (group_id = public.current_user_group_id())
  with check (group_id = public.current_user_group_id());

create policy waste_registrations_all on public.waste_registrations
  for all using (group_id = public.current_user_group_id())
  with check (group_id = public.current_user_group_id());

-- De rechtenmodule 'afval' staat in de code (src/lib/permission-modules.ts),
-- niet in een tabel; daar is hij toegevoegd.

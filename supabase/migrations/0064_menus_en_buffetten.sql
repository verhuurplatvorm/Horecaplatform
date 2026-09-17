-- 0064_menus_en_buffetten.sql
--
-- Menu's & buffetten: een menu/buffet/arrangement samenstellen uit
-- bestaande gerechten, halfproducten en losse ingrediënten, en dat
-- automatisch doorrekenen op aantal personen naar een productiewerklijst
-- en een bestellijst.
--
-- Hergebruikt volledig wat er al is — geen dubbele gegevens:
--   gerechten/halfproducten -> public.recipes
--   ingrediënten            -> public.products
--   prijzen/verpakkingen    -> public.supplier_products
--   eenheden en conversies  -> public.units + public.convert_quantity
--   kostprijs               -> public.calculate_recipe_cost
--
-- Let op: dit staat los van public.menu_cards. Die tabel is de gedrukte
-- menukaart voor de gast; dit is de calculatie van een evenement.
-- Voorraad speelt hier bewust geen rol.

create type public.event_menu_status as enum ('concept', 'definitief', 'uitgevoerd', 'vervallen');

create table public.event_menus (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references public.groups(id) on delete cascade,
  company_id          uuid references public.companies(id) on delete set null,
  name                text not null,
  description         text,
  category            text,                       -- map/categorie, bv. "BBQ"
  menu_type           text,                       -- buffet, arrangement, shared dining…
  service_date        date,                       -- ingangs-/uitvoerdatum
  status              public.event_menu_status not null default 'concept',
  pos_reference       text,                       -- kassakoppeling
  notes               text,
  person_count        integer not null default 1 check (person_count > 0),
  fixed_costs         numeric(12,2) not null default 0,   -- kosten die niet per persoon schalen
  desired_foodcost_pct numeric(5,2),
  sales_price_per_person numeric(12,2),
  vat_rate            numeric(5,2) not null default 21,
  is_template         boolean not null default false,
  created_by          uuid references public.user_profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_event_menus_group on public.event_menus(group_id);
create index idx_event_menus_date on public.event_menus(service_date);

create trigger trg_event_menus_updated_at
  before update on public.event_menus
  for each row execute function public.set_updated_at();

-- Onderdelen van het menu: "Koud buffet", "Warm buffet", "Dessert"…
create table public.event_menu_sections (
  id          uuid primary key default gen_random_uuid(),
  menu_id     uuid not null references public.event_menus(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0
);
create index idx_event_menu_sections_menu on public.event_menu_sections(menu_id);

-- Eén regel = één gerecht, halfproduct of los ingrediënt.
create table public.event_menu_lines (
  id                  uuid primary key default gen_random_uuid(),
  menu_id             uuid not null references public.event_menus(id) on delete cascade,
  section_id          uuid references public.event_menu_sections(id) on delete set null,
  recipe_id           uuid references public.recipes(id) on delete restrict,
  product_id          uuid references public.products(id) on delete restrict,
  quantity_per_person numeric(12,4) not null check (quantity_per_person > 0),
  unit_id             uuid references public.units(id),
  -- true = vaste hoeveelheid voor het hele menu (niet vermenigvuldigen
  -- met het aantal personen), bv. één grote schaal garnituur.
  is_fixed            boolean not null default false,
  note                text,
  sort_order          integer not null default 0,
  -- Precies één van beide moet gevuld zijn.
  constraint event_menu_line_target check (
    (recipe_id is not null and product_id is null)
    or (recipe_id is null and product_id is not null)
  )
);
create index idx_event_menu_lines_menu on public.event_menu_lines(menu_id);

comment on column public.event_menu_lines.is_fixed is
  'Vaste hoeveelheid: telt één keer voor het hele menu in plaats van per persoon.';

-- ---------------------------------------------------------------------
-- Uitklappen naar ingrediënten
-- ---------------------------------------------------------------------

-- Eén recept uitklappen naar de onderliggende inkoopingrediënten, in de
-- basiseenheid van elk ingrediënt. p_factor is hoe vaak het volledige
-- recept nodig is (0,5 = de helft). Subrecepten worden meegenomen.
create or replace function public.explode_recipe_to_products(
  p_recipe_id uuid,
  p_factor numeric,
  p_depth integer default 0
)
returns table (product_id uuid, quantity_in_base numeric)
language plpgsql
stable
as $$
declare
  v_line record;
  v_product_base_unit_id uuid;
  v_qty numeric;
  v_sub_yield numeric;
  v_sub_base_unit_id uuid;
  v_sub_qty numeric;
begin
  if p_depth > 15 or p_factor is null or p_factor <= 0 then
    return;
  end if;

  for v_line in
    select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
  loop
    if v_line.product_id is not null then
      select p.base_unit_id into v_product_base_unit_id
      from public.products p where p.id = v_line.product_id;

      -- Inkoopbehoefte rekent met het BRUTO gewicht: je moet immers het
      -- hele product inkopen, inclusief het deel dat je wegsnijdt.
      v_qty := public.convert_quantity(
        v_line.product_id, v_line.quantity, v_line.unit_id, v_product_base_unit_id, false
      );
      if v_qty is not null then
        product_id := v_line.product_id;
        quantity_in_base := v_qty * p_factor;
        return next;
      end if;

    elsif v_line.sub_recipe_id is not null then
      select r.yield_quantity, r.base_unit_id
      into v_sub_yield, v_sub_base_unit_id
      from public.recipes r where r.id = v_line.sub_recipe_id;
      if v_sub_yield is null or v_sub_yield <= 0 then
        continue;
      end if;

      v_sub_qty := public.convert_quantity(
        null, v_line.quantity, v_line.unit_id, v_sub_base_unit_id, false
      );
      if v_sub_qty is null then
        continue;
      end if;

      return query
        select * from public.explode_recipe_to_products(
          v_line.sub_recipe_id,
          p_factor * (v_sub_qty / v_sub_yield),
          p_depth + 1
        );
    end if;
  end loop;
end;
$$;

comment on function public.explode_recipe_to_products(uuid, numeric, integer) is
  'Klapt een recept (incl. subrecepten) uit naar de benodigde inkoopingrediënten in hun eigen basiseenheid. Rekent met bruto hoeveelheden: voor inkoop moet het hele product gekocht worden, ook het deel dat verloren gaat.';

-- Het hele menu uitklappen naar ingrediënten, al opgeteld per ingrediënt.
create or replace function public.explode_menu_to_products(p_menu_id uuid)
returns table (product_id uuid, quantity_in_base numeric)
language plpgsql
stable
as $$
declare
  v_persons integer;
  v_line record;
  v_total_qty numeric;
  v_recipe_yield numeric;
  v_recipe_base_unit_id uuid;
  v_qty_in_recipe_unit numeric;
  v_product_base_unit_id uuid;
  v_qty numeric;
begin
  select person_count into v_persons from public.event_menus where id = p_menu_id;
  if v_persons is null then
    return;
  end if;

  create temp table if not exists tmp_menu_needs (
    product_id uuid,
    quantity_in_base numeric
  ) on commit drop;
  delete from tmp_menu_needs;

  for v_line in
    select l.recipe_id, l.product_id, l.quantity_per_person, l.unit_id, l.is_fixed
    from public.event_menu_lines l
    where l.menu_id = p_menu_id
  loop
    -- Vaste regels tellen één keer; overige schalen met het aantal personen.
    v_total_qty := v_line.quantity_per_person * (case when v_line.is_fixed then 1 else v_persons end);

    if v_line.product_id is not null then
      select p.base_unit_id into v_product_base_unit_id
      from public.products p where p.id = v_line.product_id;
      v_qty := public.convert_quantity(
        v_line.product_id, v_total_qty, v_line.unit_id, v_product_base_unit_id, false
      );
      if v_qty is not null then
        insert into tmp_menu_needs values (v_line.product_id, v_qty);
      end if;

    elsif v_line.recipe_id is not null then
      select r.yield_quantity, r.base_unit_id
      into v_recipe_yield, v_recipe_base_unit_id
      from public.recipes r where r.id = v_line.recipe_id;
      if v_recipe_yield is null or v_recipe_yield <= 0 then
        continue;
      end if;
      v_qty_in_recipe_unit := public.convert_quantity(
        null, v_total_qty, v_line.unit_id, v_recipe_base_unit_id, false
      );
      if v_qty_in_recipe_unit is null then
        continue;
      end if;

      insert into tmp_menu_needs
      select * from public.explode_recipe_to_products(
        v_line.recipe_id, v_qty_in_recipe_unit / v_recipe_yield, 0
      );
    end if;
  end loop;

  return query
    select t.product_id, sum(t.quantity_in_base)
    from tmp_menu_needs t
    group by t.product_id;
end;
$$;

comment on function public.explode_menu_to_products(uuid) is
  'Klapt een heel menu/buffet uit naar de benodigde inkoopingrediënten, al opgeteld per ingrediënt en geschaald op het aantal personen. Vaste regels tellen één keer mee.';

-- ---------------------------------------------------------------------
-- Toegang: zelfde principe als recepten — centraal of per bedrijf.
-- ---------------------------------------------------------------------
alter table public.event_menus enable row level security;
alter table public.event_menu_sections enable row level security;
alter table public.event_menu_lines enable row level security;

create policy event_menus_select on public.event_menus
  for select using (
    (company_id is null and group_id = public.current_user_group_id())
    or public.has_company_access(company_id)
  );
create policy event_menus_write on public.event_menus
  for all using (
    (company_id is null and group_id = public.current_user_group_id())
    or public.has_company_access(company_id)
  )
  with check (
    (company_id is null and group_id = public.current_user_group_id())
    or public.has_company_access(company_id)
  );

create policy event_menu_sections_all on public.event_menu_sections
  for all using (
    exists (select 1 from public.event_menus m where m.id = menu_id)
  )
  with check (
    exists (select 1 from public.event_menus m where m.id = menu_id)
  );

create policy event_menu_lines_all on public.event_menu_lines
  for all using (
    exists (select 1 from public.event_menus m where m.id = menu_id)
  )
  with check (
    exists (select 1 from public.event_menus m where m.id = menu_id)
  );

-- ---------------------------------------------------------------------
-- Kostprijs van een heel menu, geschaald op het aantal personen.
-- Rekent per regel via de bestaande kostprijsfuncties, zodat de
-- stuk-conversie en het netto bruikbare gewicht gewoon meelopen.
-- ---------------------------------------------------------------------
create or replace function public.calculate_event_menu_cost(
  p_menu_id uuid,
  p_company_id uuid
)
returns numeric
language plpgsql
stable
as $$
declare
  v_persons integer;
  v_fixed numeric;
  v_line record;
  v_total numeric := 0;
  v_qty numeric;
  v_recipe_yield numeric;
  v_recipe_base_unit_id uuid;
  v_recipe_cost numeric;
  v_qty_in_recipe_unit numeric;
  v_product_base_unit_id uuid;
  v_price numeric;
begin
  select person_count, coalesce(fixed_costs, 0)
  into v_persons, v_fixed
  from public.event_menus where id = p_menu_id;
  if v_persons is null then
    return null;
  end if;

  for v_line in
    select recipe_id, product_id, quantity_per_person, unit_id, is_fixed
    from public.event_menu_lines where menu_id = p_menu_id
  loop
    v_qty := v_line.quantity_per_person * (case when v_line.is_fixed then 1 else v_persons end);

    if v_line.product_id is not null then
      select p.base_unit_id into v_product_base_unit_id
      from public.products p where p.id = v_line.product_id;
      select cpc.price_per_base_unit into v_price
      from public.current_product_cost cpc
      where cpc.product_id = v_line.product_id and cpc.company_id = p_company_id;
      -- Kostprijs rekent met netto bruikbaar (p_for_cost = true).
      v_qty := public.convert_quantity(
        v_line.product_id, v_qty, v_line.unit_id, v_product_base_unit_id, true
      );
      if v_price is not null and v_qty is not null then
        v_total := v_total + v_qty * v_price;
      end if;

    elsif v_line.recipe_id is not null then
      select r.yield_quantity, r.base_unit_id
      into v_recipe_yield, v_recipe_base_unit_id
      from public.recipes r where r.id = v_line.recipe_id;
      if v_recipe_yield is null or v_recipe_yield <= 0 then
        continue;
      end if;
      v_qty_in_recipe_unit := public.convert_quantity(
        null, v_qty, v_line.unit_id, v_recipe_base_unit_id, false
      );
      if v_qty_in_recipe_unit is null then
        continue;
      end if;
      v_recipe_cost := public.calculate_recipe_cost(v_line.recipe_id, p_company_id);
      if v_recipe_cost is not null then
        v_total := v_total + v_recipe_cost * (v_qty_in_recipe_unit / v_recipe_yield);
      end if;
    end if;
  end loop;

  return round(v_total + v_fixed, 4);
end;
$$;

comment on function public.calculate_event_menu_cost(uuid, uuid) is
  'Totale kostprijs van een menu/buffet bij het ingestelde aantal personen, inclusief vaste kosten. Gebruikt calculate_recipe_cost en convert_quantity, dus conversies en netto bruikbaar gewicht lopen mee.';

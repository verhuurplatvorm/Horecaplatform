-- 0022_voorraad.sql
-- Voorraadbeheer en theoretisch verbruik (spec §13, §16).
--
-- Ontwerpkeuze: voorraad is een append-only mutatieledger
-- (stock_movements), geen muteerbare "huidige voorraad"-kolom. De
-- huidige voorraad is altijd de som van alle mutaties — dat voorkomt
-- dat een los "on_hand"-veld ooit uit de pas kan lopen met de historie,
-- en geeft gratis een volledig mutatie-overzicht (spec §13: "historische
-- voorraadstanden").
--
-- Zowel producten als halfproducten (recepten) zijn voorraadbaar: een
-- vooraf bereide saus heeft net zo goed een voorraad als een ingekocht
-- product. quantity_change staat altijd in de basiseenheid van het
-- product/halfproduct.
--
-- Er is bewust geen kassakoppeling (die bestaat nog niet); "verkoop
-- registreren" gebeurt vooralsnog handmatig, net als productie.

create type public.stock_movement_type as enum (
  'ontvangst', 'verbruik', 'productie', 'correctie',
  'derving', 'overboeking_uit', 'overboeking_in', 'telling'
);

create table public.stock_movements (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references public.groups(id) on delete cascade,
  company_id         uuid not null references public.companies(id) on delete cascade,
  location_id        uuid references public.locations(id) on delete set null,
  product_id         uuid references public.products(id) on delete cascade,
  recipe_id          uuid references public.recipes(id) on delete cascade,
  movement_type      public.stock_movement_type not null,
  quantity_change    numeric(14,4) not null, -- in basiseenheid; positief = erbij, negatief = eraf
  batch_number       text,
  expiry_date        date,
  note               text,
  related_movement_id uuid references public.stock_movements(id) on delete set null,
  created_by         uuid references public.user_profiles(id),
  created_at         timestamptz not null default now(),
  constraint chk_stock_movement_target check (
    (product_id is not null and recipe_id is null) or
    (product_id is null and recipe_id is not null)
  )
);

create index idx_stock_movements_company on public.stock_movements(company_id);
create index idx_stock_movements_product on public.stock_movements(product_id);
create index idx_stock_movements_recipe on public.stock_movements(recipe_id);
create index idx_stock_movements_related on public.stock_movements(related_movement_id);

comment on table public.stock_movements is
  'Append-only voorraadmutatieledger. Huidige voorraad = som van quantity_change per product/halfproduct per bedrijf (zie view current_stock).';
comment on column public.stock_movements.quantity_change is
  'In de basiseenheid van het product (products.base_unit_id) of halfproduct (recipes.base_unit_id). Positief = voorraad erbij, negatief = eraf.';

-- Huidige voorraad per bedrijf, product óf halfproduct.
create or replace view public.current_stock as
select
  company_id,
  product_id,
  recipe_id,
  sum(quantity_change) as on_hand_quantity
from public.stock_movements
group by company_id, product_id, recipe_id;

comment on view public.current_stock is
  'Actuele voorraad = som van alle mutaties, per bedrijf en per product/halfproduct.';

-- ---------------------------------------------------------------------
-- Productie registreren: legt een positieve mutatie vast voor het
-- geproduceerde halfproduct, en trekt automatisch de onderliggende
-- ingrediënten (producten én, één niveau diep, andere halfproducten) af
-- als theoretisch verbruik (spec §13, §16: "een productieboeking van
-- tien liter saus verbruikt automatisch de onderliggende ingrediënten").
--
-- Bewust niet recursief door geneste halfproducten heen: als een
-- halfproduct zelf weer een halfproduct als ingrediënt gebruikt, wordt
-- de voorraad van dát onderliggende halfproduct verbruikt (niet diens
-- eigen ingrediënten) — dat halfproduct moet dus zelf ook via een eigen
-- productieboeking op voorraad zijn gebracht. Dit houdt de mutatielogica
-- voorspelbaar en traceerbaar per stap.
-- ---------------------------------------------------------------------
create or replace function public.register_recipe_production(
  p_recipe_id uuid,
  p_company_id uuid,
  p_quantity numeric,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_production_movement_id uuid;
  v_line record;
  v_user_id uuid := auth.uid();
  v_base_unit_id uuid;
  v_factor numeric;
  v_dim1 public.unit_dimension;
  v_dim2 public.unit_dimension;
  v_converted numeric;
begin
  if p_quantity <= 0 then
    raise exception 'Geproduceerde hoeveelheid moet groter dan 0 zijn.';
  end if;

  select group_id into v_group_id from public.recipes where id = p_recipe_id;
  if v_group_id is null then
    raise exception 'Receptuur % niet gevonden.', p_recipe_id;
  end if;

  insert into public.stock_movements (
    group_id, company_id, recipe_id, movement_type, quantity_change, note, created_by
  ) values (
    v_group_id, p_company_id, p_recipe_id, 'productie', p_quantity, p_note, v_user_id
  )
  returning id into v_production_movement_id;

  for v_line in
    select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
  loop
    if v_line.product_id is not null then
      select base_unit_id into v_base_unit_id from public.products where id = v_line.product_id;
    else
      select base_unit_id into v_base_unit_id from public.recipes where id = v_line.sub_recipe_id;
    end if;

    if v_line.unit_id is null or v_base_unit_id is null then
      continue; -- geen geldige eenheid bekend, kan niet omgerekend worden
    end if;

    select u1.factor_to_base / u2.factor_to_base, u1.dimension, u2.dimension
    into v_factor, v_dim1, v_dim2
    from public.units u1, public.units u2
    where u1.id = v_line.unit_id and u2.id = v_base_unit_id;

    if v_dim1 is distinct from v_dim2 then
      continue; -- incompatibele eenheid, sla over i.p.v. te gokken
    end if;

    v_converted := v_line.quantity * v_factor * p_quantity;

    insert into public.stock_movements (
      group_id, company_id, product_id, recipe_id, movement_type,
      quantity_change, note, related_movement_id, created_by
    ) values (
      v_group_id, p_company_id, v_line.product_id, v_line.sub_recipe_id, 'verbruik',
      -v_converted, 'Theoretisch verbruik voor productie', v_production_movement_id, v_user_id
    );
  end loop;

  return v_production_movement_id;
end;
$$;

comment on function public.register_recipe_production(uuid, uuid, numeric, text) is
  'Registreert productie van een halfproduct en trekt automatisch de theoretisch benodigde ingrediënten van de voorraad af.';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.stock_movements enable row level security;

create policy stock_movements_select on public.stock_movements
  for select using (public.has_company_access(company_id));

create policy stock_movements_write on public.stock_movements
  for all using (public.has_company_access(company_id))
  with check (public.has_company_access(company_id));

create trigger trg_audit_stock_movements
  after insert or update or delete on public.stock_movements
  for each row execute function public.audit_row_change();

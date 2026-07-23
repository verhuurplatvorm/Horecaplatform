-- 0005_recepturen_kostprijzen.sql
-- Recepturenbeheer (spec §7) en kostprijzen/verkoopprijzen (spec §8).
--
-- Model: een centrale receptuur (is_central = true, company_id null)
-- kan door meerdere bedrijven gebruikt worden via recipe_company_links.
-- Een bedrijf mag lokaal afwijken door een eigen recipe-rij aan te
-- maken met parent_recipe_id verwijzend naar de centrale standaard
-- (spec §7: centrale standaard vs. lokale variant nooit stilzwijgend
-- overschrijven).

create type public.recipe_status as enum ('concept', 'goedgekeurd', 'vervallen');

create table public.recipes (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.groups(id) on delete cascade,
  company_id        uuid references public.companies(id) on delete cascade, -- null = centrale standaard
  parent_recipe_id  uuid references public.recipes(id) on delete set null,  -- verwijst naar centrale standaard bij lokale variant
  name              text not null,
  category          text,               -- gerecht, drank, cocktail, subreceptuur, saus, mise-en-place, arrangement, ...
  photo_url         text,
  preparation       text,
  preparation_minutes integer,
  portion_size      numeric(12,4),
  portion_unit      text,
  yield_quantity    numeric(12,4),      -- opbrengst (voor bulk/subrecepturen)
  yield_unit        text,
  preparation_loss_pct numeric(5,2),
  shelf_life_days   integer,
  status            public.recipe_status not null default 'concept',
  version           integer not null default 1,
  is_central        boolean not null default false,
  is_mandatory      boolean not null default false, -- verplichte groepsstandaard
  effective_date    date not null default current_date,
  sales_price       numeric(10,2),      -- huidige verkoopprijs incl. btw
  created_by        uuid references public.user_profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_recipes_group on public.recipes(group_id);
create index idx_recipes_company on public.recipes(company_id);
create index idx_recipes_parent on public.recipes(parent_recipe_id);

create trigger trg_recipes_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

-- Wijzigingshistorie van recepturen (spec §7: wijzigingshistorie).
create table public.recipe_revisions (
  id           uuid primary key default gen_random_uuid(),
  recipe_id    uuid not null references public.recipes(id) on delete cascade,
  version      integer not null,
  snapshot     jsonb not null,          -- volledige recipe + ingrediënten op moment van wijziging
  changed_by   uuid references public.user_profiles(id),
  changed_at   timestamptz not null default now(),
  change_note  text
);

create index idx_recipe_revisions_recipe on public.recipe_revisions(recipe_id);

-- Welke bedrijven gebruiken deze (centrale) receptuur, en gebruiken ze
-- een lokale variant in plaats van de standaard.
create table public.recipe_company_links (
  recipe_id        uuid not null references public.recipes(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,
  local_variant_id uuid references public.recipes(id) on delete set null,
  is_enabled       boolean not null default true,
  primary key (recipe_id, company_id)
);

-- Ingrediëntregels: een receptuur bestaat uit producten en/of
-- subrecepturen (bv. een saus die weer in een gerecht wordt gebruikt).
create table public.recipe_ingredients (
  id               uuid primary key default gen_random_uuid(),
  recipe_id        uuid not null references public.recipes(id) on delete cascade,
  product_id       uuid references public.products(id) on delete restrict,
  sub_recipe_id    uuid references public.recipes(id) on delete restrict,
  quantity         numeric(12,4) not null,
  unit             text not null,
  sort_order       integer not null default 0,
  note             text,
  created_at       timestamptz not null default now(),
  constraint chk_ingredient_source check (
    (product_id is not null and sub_recipe_id is null) or
    (product_id is null and sub_recipe_id is not null)
  )
);

create index idx_recipe_ingredients_recipe on public.recipe_ingredients(recipe_id);
create index idx_recipe_ingredients_product on public.recipe_ingredients(product_id);
create index idx_recipe_ingredients_subrecipe on public.recipe_ingredients(sub_recipe_id);

-- ---------------------------------------------------------------------
-- Kostprijsberekening (spec §8).
--
-- De actuele kostprijs is een afgeleide waarde (ingrediënt-hoeveelheid x
-- actuele inkoopprijs, recursief over subrecepturen). We bewaren die niet
-- als los te muteren kolom, maar als view zodat een prijswijziging bij de
-- leverancier direct doorwerkt (spec §8: "moet automatisch doorwerken").
-- Voor snelle rapportages over lange periodes kan hier later een
-- materialized view / samenvattingstabel bovenop komen (spec §33).
-- ---------------------------------------------------------------------

-- Actuele (laagste contract- of laatst geldige) inkoopprijs per product
-- en bedrijf, in de base_unit van het product.
create or replace view public.current_product_cost as
select distinct on (sp.product_id, coalesce(sp.company_id, c.id))
  sp.product_id,
  c.id as company_id,
  sp.supplier_id,
  sp.price_per_base_unit,
  sp.is_contract_price,
  sp.valid_from
from public.supplier_products sp
cross join public.companies c
where (sp.company_id is null or sp.company_id = c.id)
  and sp.valid_from <= current_date
  and (sp.valid_to is null or sp.valid_to >= current_date)
order by
  sp.product_id, coalesce(sp.company_id, c.id),
  sp.company_id nulls last,     -- bedrijfsspecifieke prijs gaat voor centrale prijs
  sp.is_contract_price desc,    -- contractprijs gaat voor spotprijs
  sp.valid_from desc;

comment on view public.current_product_cost is
  'Actuele inkoopprijs per product per bedrijf: bedrijfsspecifieke prijs > centrale prijs, contractprijs > spotprijs, meest recente eerst.';

-- Recursieve kostprijsberekening per receptuur per bedrijf (houdt
-- rekening met subrecepturen en bereidingsverlies).
create or replace function public.calculate_recipe_cost(p_recipe_id uuid, p_company_id uuid)
returns numeric
language plpgsql
stable
as $$
declare
  v_total numeric := 0;
begin
  with recursive expanded as (
    select ri.recipe_id, ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id

    union all

    select ri.recipe_id, ri.product_id, ri.sub_recipe_id,
           ri.quantity * e.quantity as quantity, ri.unit
    from public.recipe_ingredients ri
    join expanded e on ri.recipe_id = e.sub_recipe_id
  )
  select coalesce(sum(
    e.quantity * coalesce(cpc.price_per_base_unit, 0)
  ), 0)
  into v_total
  from expanded e
  left join public.current_product_cost cpc
    on cpc.product_id = e.product_id and cpc.company_id = p_company_id
  where e.product_id is not null;

  return round(v_total, 4);
end;
$$;

comment on function public.calculate_recipe_cost(uuid, uuid) is
  'Berekent de actuele theoretische kostprijs van een receptuur voor een bedrijf, inclusief subrecepturen. Gebruikt current_product_cost, dus wijzigt automatisch mee met inkoopprijzen (spec §8).';

comment on table public.recipes is 'Centrale of lokale receptuur (spec §7). is_central+company_id null = groepsstandaard; parent_recipe_id verwijst een lokale variant naar de standaard.';
comment on table public.recipe_ingredients is 'Ingrediëntregels van een receptuur: product óf subreceptuur, nooit beide.';

-- 0023_halfproducten_module.sql
-- Halfproducten krijgen een eigen module, los van de gewone
-- receptenlijst (spec: "Halfproducten mogen geen onderdeel zijn van de
-- gewone receptenlijst"). Het datamodel (recipes met recipe_kind =
-- 'halfproduct', recipe_ingredients) bestond al sinds 0016; deze
-- migratie voegt toe wat specifiek voor de module nodig is: favorieten,
-- bewaarmethode, en een functie die laat zien in welke gerechten een
-- halfproduct wordt gebruikt ("Gebruikt in").

alter table public.recipes
  add column storage_method text;

comment on column public.recipes.storage_method is
  'Bewaarmethode van een halfproduct (spec: "bewaarmethode"), bv. "Gekoeld bewaren bij max. 7°C".';

create table public.recipe_favorites (
  user_id    uuid not null references public.user_profiles(id) on delete cascade,
  recipe_id  uuid not null references public.recipes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

comment on table public.recipe_favorites is
  'Favoriete recepten/halfproducten per gebruiker, voor snelle toegang in overzichten.';

-- Welke gerechten (of andere halfproducten) gebruiken dit halfproduct
-- rechtstreeks, met hoeveelheid en actuele kostprijsbijdrage.
create or replace function public.get_recipe_usage(
  p_recipe_id uuid,
  p_company_id uuid
)
returns table (
  using_recipe_id uuid,
  using_recipe_name text,
  using_recipe_kind public.recipe_kind,
  company_name text,
  quantity numeric,
  unit_name text,
  cost_contribution numeric
)
language plpgsql
stable
as $$
begin
  return query
  select
    r.id,
    r.name,
    r.recipe_kind,
    c.name,
    ri.quantity,
    u.name,
    case
      when ri.unit_id is not null and (select base_unit_id from public.recipes where id = p_recipe_id) is not null then
        (
          select ri.quantity * (u1.factor_to_base / u2.factor_to_base)
            / nullif((select yield_quantity from public.recipes where id = p_recipe_id), 0)
            * public.calculate_recipe_cost(p_recipe_id, p_company_id)
          from public.units u1, public.units u2
          where u1.id = ri.unit_id
            and u2.id = (select base_unit_id from public.recipes where id = p_recipe_id)
            and u1.dimension = u2.dimension
        )
      else null
    end
  from public.recipe_ingredients ri
  join public.recipes r on r.id = ri.recipe_id
  left join public.companies c on c.id = r.company_id
  left join public.units u on u.id = ri.unit_id
  where ri.sub_recipe_id = p_recipe_id;
end;
$$;

comment on function public.get_recipe_usage(uuid, uuid) is
  '"Gebruikt in": welke gerechten/halfproducten dit halfproduct rechtstreeks gebruiken, met hoeveelheid en kostprijsbijdrage voor het opgegeven bedrijf.';

alter table public.recipe_favorites enable row level security;

create policy recipe_favorites_select on public.recipe_favorites
  for select using (user_id = auth.uid());

create policy recipe_favorites_write on public.recipe_favorites
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

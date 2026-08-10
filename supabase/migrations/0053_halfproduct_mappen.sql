-- 0053_halfproduct_mappen.sql
-- Vervangt het platte categorie-tabblad van Halfproducten door een
-- echte mappenstructuur (zelf aan te maken, hernoemen, verwijderen, en
-- halfproducten er met drag-and-drop tussen verslepen) — dezelfde
-- bediening als bij Menukaarten. Bewust ÉÉN niveau (geen submappen):
-- de oude situatie was ook plat (één categorie per halfproduct), en dit
-- houdt de migratie laag-risico. Submappen kunnen later alsnog als dat
-- nodig blijkt.
--
-- Recepten (gerechten) blijven ongemoeid: die gebruiken nog steeds het
-- bestaande category-veld met de tab-weergave van vandaag.

create table public.halfproduct_folders (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index idx_halfproduct_folders_group on public.halfproduct_folders(group_id);

alter table public.halfproduct_folders enable row level security;

create policy halfproduct_folders_select on public.halfproduct_folders
  for select using (group_id = public.current_user_group_id());

create policy halfproduct_folders_write on public.halfproduct_folders
  for all using (group_id = public.current_user_group_id())
  with check (group_id = public.current_user_group_id());

comment on table public.halfproduct_folders is
  'Handmatig beheerde mappen voor halfproducten (aanmaken/hernoemen/verwijderen/drag-and-drop), los van het category-veld dat recepten (gerechten) nog gebruiken.';

alter table public.recipes
  add column if not exists halfproduct_folder_id uuid references public.halfproduct_folders(id) on delete set null;

comment on column public.recipes.halfproduct_folder_id is
  'Map-koppeling voor halfproducten (recipe_kind = halfproduct). Wordt nooit automatisch gezet door een Excel-import — alleen handmatig via de Halfproducten-pagina.';

-- Bestaande categorieën van halfproducten overzetten naar de nieuwe
-- mappenstructuur, zodat niets uit het oog verdwijnt: per bestaande
-- categorie-waarde (per groep) wordt één map aangemaakt en gekoppeld.
-- Het category-veld zelf blijft ongewijzigd staan (geen dataverlies,
-- puur een aanvullende koppeling).
with bestaande_categorieen as (
  select distinct group_id, category
  from public.recipes
  where recipe_kind = 'halfproduct'
    and category is not null
    and btrim(category) <> ''
),
aangemaakte_mappen as (
  insert into public.halfproduct_folders (group_id, name, sort_order)
  select
    group_id,
    btrim(category),
    row_number() over (partition by group_id order by btrim(category)) - 1
  from bestaande_categorieen
  returning id, group_id, name
)
update public.recipes r
set halfproduct_folder_id = m.id
from aangemaakte_mappen m
where r.recipe_kind = 'halfproduct'
  and r.group_id = m.group_id
  and btrim(r.category) = m.name;

-- 0089_gerechten_mappen.sql
-- Mappenstructuur voor Gerechten: zelf (lege) mappen aanmaken en mappen
-- onder hoofdmappen (bv. Zomers, Kerst, 2 voor 1, Het Strand) slepen.
--
-- recipes.category blijft de koppeling van een gerecht aan een map (op
-- naam), zodat de Excel-import en bestaande schermen ongewijzigd blijven.
-- recipe_folders legt alleen de mappen zelf vast (ook lege) en welke
-- hoofdmap erboven zit. Bestaande categorieën worden als losse mappen
-- overgenomen. Er wordt niets verwijderd of gewijzigd aan recepten.

create table if not exists public.recipe_folders (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  name        text not null,
  parent_id   uuid references public.recipe_folders(id) on delete set null,
  is_main     boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create unique index if not exists uq_recipe_folders_group_name
  on public.recipe_folders (group_id, lower(name));
create index if not exists idx_recipe_folders_group on public.recipe_folders (group_id);

alter table public.recipe_folders enable row level security;

drop policy if exists recipe_folders_select on public.recipe_folders;
create policy recipe_folders_select on public.recipe_folders
  for select using (group_id = public.current_user_group_id());

drop policy if exists recipe_folders_write on public.recipe_folders;
create policy recipe_folders_write on public.recipe_folders
  for all using (group_id = public.current_user_group_id())
  with check (group_id = public.current_user_group_id());

comment on table public.recipe_folders is
  'Mappen voor gerechten. is_main = hoofdmap (bevat mappen, geen gerechten); parent_id wijst een map naar zijn hoofdmap. Gerechten horen bij een map via recipes.category (naam).';

-- Bestaande categorieën van gerechten overnemen als losse mappen.
insert into public.recipe_folders (group_id, name, sort_order)
select group_id, name, (row_number() over (partition by group_id order by name))::int
from (
  select distinct on (group_id, lower(trim(category)))
         group_id, trim(category) as name
  from public.recipes
  where recipe_kind = 'gerecht' and category is not null and trim(category) <> ''
  order by group_id, lower(trim(category)), trim(category)
) c
on conflict do nothing;

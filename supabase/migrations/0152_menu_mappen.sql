-- 0152: Mappen voor Menu's & buffetten.
--
-- Een menu/buffet kan in een map staan (bv. "Afgelopen evenementen 2026").
-- Het overzicht toont standaard alleen menu's zonder map ("Actueel");
-- zoeken doorzoekt alle menu's, ook die in mappen. Een map verwijderen
-- verwijdert nooit de menu's: die gaan terug naar "Actueel".

create table if not exists public.event_menu_folders (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists event_menu_folders_group_idx on public.event_menu_folders (group_id, sort_order);

alter table public.event_menus
  add column if not exists folder_id uuid references public.event_menu_folders(id) on delete set null;

create index if not exists event_menus_folder_idx on public.event_menus (folder_id);

alter table public.event_menu_folders enable row level security;

create policy event_menu_folders_select on public.event_menu_folders
  for select using (group_id = (select public.current_user_group_id()));

create policy event_menu_folders_write on public.event_menu_folders
  for all using (group_id = (select public.current_user_group_id()))
  with check (group_id = (select public.current_user_group_id()));

-- Operators (alleen lezen) mogen geen mappen wijzigen, net als elders.
create policy operator_readonly_insert on public.event_menu_folders
  as restrictive for insert to authenticated with check (not (select public.current_user_is_operator()));
create policy operator_readonly_update on public.event_menu_folders
  as restrictive for update to authenticated using (not (select public.current_user_is_operator()));
create policy operator_readonly_delete on public.event_menu_folders
  as restrictive for delete to authenticated using (not (select public.current_user_is_operator()));

grant select, insert, update, delete on public.event_menu_folders to authenticated;

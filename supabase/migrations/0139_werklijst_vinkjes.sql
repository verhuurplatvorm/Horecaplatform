-- Afgevinkte regels op de productiewerklijst van een menu/buffet.
-- Voorheen alleen in de browser (weg na verversen); nu per menu in de
-- database, zodat elk scherm in de keuken dezelfde stand ziet.
--
-- item_key is de sleutel uit de werklijst:
--   partijgerecht  -> event_menu_lines.id
--   overige regels -> '<recipe_id>:<unit_id>'
-- Daarom bewust geen foreign key op item_key.

create table if not exists public.event_menu_work_done (
  menu_id  uuid not null references public.event_menus(id) on delete cascade,
  item_key text not null,
  done_by  uuid default auth.uid() references auth.users(id) on delete set null,
  done_at  timestamptz not null default now(),
  primary key (menu_id, item_key)
);

alter table public.event_menu_work_done enable row level security;

-- Wie het menu mag zien, mag afvinken. De RLS van event_menus bepaalt
-- welke menu's zichtbaar zijn. Operators (keuken) mogen ook afvinken:
-- dit is geen stamgegeven.
drop policy if exists event_menu_work_done_all on public.event_menu_work_done;
create policy event_menu_work_done_all on public.event_menu_work_done
  for all to authenticated
  using (exists (select 1 from public.event_menus m where m.id = menu_id))
  with check (exists (select 1 from public.event_menus m where m.id = menu_id));

grant select, insert, update, delete on public.event_menu_work_done to authenticated;

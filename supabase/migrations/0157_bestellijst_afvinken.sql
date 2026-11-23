-- 0157: Bestellijst afvinken — gedeeld met collega's.
--
-- Per menu/boeking: welk ingrediënt is besteld (door wie, wanneer, hoeveel
-- verpakkingen) en welk halfproduct is niet in huis. Was alleen per browser
-- (localStorage); staat nu in de database zodat iedereen hetzelfde ziet.

create table if not exists public.event_menu_order_marks (
  menu_id uuid not null references public.event_menus(id) on delete cascade,
  item_id uuid not null,                 -- product_id (besteld) of recipe_id (niet_in_huis)
  kind text not null check (kind in ('besteld', 'niet_in_huis')),
  packages numeric,                      -- aantal verpakkingen op het moment van bestellen
  marked_by uuid default auth.uid() references auth.users(id) on delete set null,
  marked_at timestamptz not null default now(),
  primary key (menu_id, item_id, kind)
);

alter table public.event_menu_order_marks enable row level security;

create policy event_menu_order_marks_all on public.event_menu_order_marks
  for all using (exists (select 1 from public.event_menus m where m.id = event_menu_order_marks.menu_id))
  with check (exists (select 1 from public.event_menus m where m.id = event_menu_order_marks.menu_id));

grant select, insert, update, delete on public.event_menu_order_marks to authenticated;

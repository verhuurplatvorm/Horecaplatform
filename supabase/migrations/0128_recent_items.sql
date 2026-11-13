-- Laatst geopende recepten, halfproducten en ingrediënten per gebruiker.
create table if not exists public.recent_items (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('recipe', 'product')),
  item_id uuid not null,
  opened_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);
create index if not exists recent_items_user_opened on public.recent_items (user_id, opened_at desc);
alter table public.recent_items enable row level security;
drop policy if exists recent_items_own on public.recent_items;
create policy recent_items_own on public.recent_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
grant select, insert, update, delete on public.recent_items to authenticated;

-- Snel zoeken op receptnaam (stickerscherm, ook bij duizenden regels).
create index if not exists idx_recipes_name_trgm on public.recipes using gin (name gin_trgm_ops);

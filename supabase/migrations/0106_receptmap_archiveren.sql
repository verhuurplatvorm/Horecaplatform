-- Receptmappen archiveren (bv. "Winters 2026" als de nieuwe kaart draait).
-- Een gearchiveerde map en de gerechten erin verdwijnen uit het overzicht,
-- maar blijven bestaan en zijn terug te halen via "Toon gearchiveerd".
-- Bij een hoofdmap geldt het voor alle mappen eronder.
alter table public.recipe_folders
  add column if not exists is_archived boolean not null default false;

comment on column public.recipe_folders.is_archived is
  'Gearchiveerde map: verborgen in het gerechtenoverzicht (incl. gerechten erin, en bij een hoofdmap alle submappen). Niets wordt verwijderd.';

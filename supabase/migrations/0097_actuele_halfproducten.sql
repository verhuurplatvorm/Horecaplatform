-- Actuele halfproducten: de halfproducten van de menukaart die nu draait.
-- Eén vlag per halfproduct, gedeeld binnen de groep (anders dan favorieten,
-- die per gebruiker zijn). Alleen een selectie voor overzicht/productie;
-- verandert niets aan kostprijs, koppelingen of de recepten zelf.
alter table public.recipes
  add column if not exists is_current_menu boolean not null default false;

comment on column public.recipes.is_current_menu is
  'Staat in de tab "Actuele halfproducten" (halfproducten van de huidige kaart). Alleen een selectie; geen invloed op berekeningen.';

create index if not exists recipes_current_menu_idx
  on public.recipes (group_id)
  where is_current_menu;

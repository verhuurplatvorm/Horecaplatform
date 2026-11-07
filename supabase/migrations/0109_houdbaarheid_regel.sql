-- Houdbaarheidsregel per halfproduct (keuze op de stickerpagina wordt onthouden).
-- Regels (Hygiënecode voor de Horeca):
--   gekoeld_2d    zelf bereid, gekoeld ≤ 7 °C: dag van bereiding + 2 dagen
--   zelfde_dag    alleen op de dag van bereiding gebruiken
--   ingevroren_3m zelf ingevroren (−18 °C): maximaal 3 maanden
--   eigen         eigen termijn in dagen (recipes.shelf_life_days)
--   handmatig     datum per sticker zelf invullen
alter table public.recipes add column if not exists shelf_life_rule text;
comment on column public.recipes.shelf_life_rule is
  'Gekozen houdbaarheidsregel voor stickers (Hygiënecode): gekoeld_2d, zelfde_dag, ingevroren_3m, eigen, handmatig. Wordt onthouden per halfproduct.';

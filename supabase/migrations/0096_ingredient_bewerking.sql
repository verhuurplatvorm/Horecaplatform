-- Bewerking per ingrediëntregel (bv. "sap", "zeste", "fijngesneden").
-- Het ingrediënt zelf (bv. limoen) en de hoeveelheid blijven gekoppeld en
-- tellen gewoon mee in de kostprijs; de bewerking is alleen een aanduiding
-- van wat er met het ingrediënt gebeurt.
alter table public.recipe_ingredients
  add column if not exists preparation text;

comment on column public.recipe_ingredients.preparation is
  'Bewerking van het ingrediënt op deze regel (bv. sap, zeste, fijngesneden). Alleen weergave; heeft geen invloed op de kostprijs.';

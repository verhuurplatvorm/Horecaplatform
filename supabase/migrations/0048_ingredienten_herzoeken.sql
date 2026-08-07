-- 0048_ingredienten_herzoeken.sql
-- Bewaart ook het leveranciers-artikelnummer van een nog niet-gekoppeld
-- ingrediënt (naast de naam), zodat "Opnieuw zoeken in Producten" een
-- betrouwbare, exacte match kan proberen — niet alleen op naam.

alter table public.recipe_ingredients
  add column if not exists unmatched_article_number text;

comment on column public.recipe_ingredients.unmatched_article_number is
  'Leveranciers-artikelnummer van het oorspronkelijke ingrediënt uit een import, zolang deze regel nog niet gekoppeld is. Gebruikt door "Opnieuw zoeken in Producten" voor een betrouwbare exacte match.';

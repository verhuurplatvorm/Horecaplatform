-- Opbrengst van een halfproduct: automatisch (som van de ingrediënten) of
-- handmatig door de kok bepaald. Handmatig is leidend en wordt nooit
-- overschreven. Bestaande halfproducten blijven ongewijzigd: hun opbrengst
-- is tot nu toe nooit automatisch overschreven, dus ze gelden als handmatig.
alter table public.recipes
  add column if not exists yield_is_manual boolean not null default true;

comment on column public.recipes.yield_is_manual is
  'true = opbrengst door de kok ingesteld (leidend voor de kostprijs); false = editor volgt de som van de ingrediënten.';

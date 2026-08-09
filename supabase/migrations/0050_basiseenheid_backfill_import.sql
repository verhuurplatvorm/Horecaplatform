-- 0050_basiseenheid_backfill_import.sql
-- Herstel: door de recepten/halfproducten-import werden recepten
-- aangemaakt ZONDER basiseenheid. Daardoor werkte de automatische
-- opbrengst-berekening, de prijs per basiseenheid en het schalen niet.
-- Deze migratie vult de basiseenheid alsnog in op basis van de
-- overheersende dimensie van de ingrediënten van elk recept:
-- inhoud → ml, gewicht → g, anders stuk. (De import zelf zet 'm
-- voortaan meteen goed; dit repareert wat al geïmporteerd is.)

with dominant as (
  select
    r.id as recipe_id,
    count(*) filter (where u.dimension = 'inhoud')  as volume_count,
    count(*) filter (where u.dimension = 'gewicht') as weight_count,
    count(*) filter (where u.dimension = 'aantal')  as piece_count
  from public.recipes r
  join public.recipe_ingredients ri on ri.recipe_id = r.id
  left join public.units u on u.id = ri.unit_id
  where r.base_unit_id is null
  group by r.id
),
chosen as (
  select
    recipe_id,
    case
      when volume_count >= weight_count and volume_count >= piece_count and volume_count > 0 then 'ml'
      when weight_count >= piece_count and weight_count > 0 then 'g'
      else 'stuk'
    end as unit_key
  from dominant
)
update public.recipes r
set base_unit_id = u.id
from chosen c
join public.units u on u.key = c.unit_key
where r.id = c.recipe_id
  and r.base_unit_id is null;

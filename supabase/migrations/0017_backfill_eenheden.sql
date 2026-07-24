-- 0017_backfill_eenheden.sql
-- Producten en receptregels die zijn aangemaakt vóór het eenhedensysteem
-- (migraties 0011/0013) hebben alleen de oude vrije-tekst eenheid
-- (products.base_unit / recipe_ingredients.unit), maar geen base_unit_id
-- / unit_id. Kostprijsberekening en de eenhedendropdown in de UI leunen
-- volledig op die FK's, dus zulke rijen tonen nu "onvolledig" ook al is
-- er wel degelijk een geldige prijs bekend.
--
-- Deze migratie vult, alleen waar nog leeg, base_unit_id / unit_id in op
-- basis van de bestaande tekstwaarde (bv. 'ml' -> units.key = 'ml').
-- Rijen met een tekstwaarde die niet exact overeenkomt met een
-- units.key (zou niet moeten voorkomen, maar voor de zekerheid) blijven
-- ongemoeid en moeten handmatig gecorrigeerd worden.

update public.products p
set base_unit_id = u.id
from public.units u
where p.base_unit_id is null
  and p.base_unit is not null
  and u.key = p.base_unit;

update public.recipe_ingredients ri
set unit_id = u.id
from public.units u
where ri.unit_id is null
  and ri.unit is not null
  and ri.unit <> ''
  and u.key = ri.unit;

-- Ter controle: producten die na deze migratie nog steeds geen
-- base_unit_id hebben (bv. omdat base_unit een onbekende waarde bevatte)
-- kun je opsporen met:
--
--   select id, name, base_unit from products where base_unit_id is null;
--
-- en handmatig corrigeren via het productformulier.

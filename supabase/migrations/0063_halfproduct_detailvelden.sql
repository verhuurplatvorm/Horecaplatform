-- 0063_halfproduct_detailvelden.sql
--
-- Velden die het herontworpen halfproductscherm nodig heeft en die nog
-- niet bestonden. Alles wat er al was blijft ongewijzigd en wordt alleen
-- anders ingedeeld — geen dubbele velden of berekeningen:
--   naam, map, omschrijving     -> recipes.name / halfproduct_folder_id / preparation
--   opbrengst + eenheid         -> recipes.yield_quantity / base_unit_id
--   productieverlies            -> recipes.waste_percentage
--   overige kosten              -> recipes.margin_free_costs
--   houdbaarheid, bewaarmethode -> recipes.shelf_life_days / storage_method
--   foto                        -> recipes.photo_url
--   bereiding, opmaak/opslag    -> recipes.preparation / plating_instructions
--   allergenen/voedingswaarden  -> afgeleid uit de ingrediënten
--   historie                    -> bestaande tabel recipe_revisions
--   circulaire koppelingen      -> al geblokkeerd door trg_recipe_ingredients_no_circular (0013)

alter table public.recipes
  add column if not exists labour_minutes_kitchen numeric(10,2),
  add column if not exists labour_minutes_other numeric(10,2),
  add column if not exists labour_cost_per_hour numeric(10,2),
  add column if not exists production_location text,
  add column if not exists synonyms text[] not null default '{}';

comment on column public.recipes.labour_minutes_kitchen is
  'Arbeid keuken in minuten voor één productie van de standaardopbrengst.';
comment on column public.recipes.labour_minutes_other is
  'Overige arbeid in minuten voor één productie van de standaardopbrengst.';
comment on column public.recipes.labour_cost_per_hour is
  'Uurtarief waarmee de arbeidsminuten worden omgerekend naar kosten. Leeg = arbeid telt niet mee in de kostprijs.';
comment on column public.recipes.production_location is
  'Waar dit halfproduct gemaakt wordt (bv. "Centrale keuken").';
comment on column public.recipes.synonyms is
  'Alternatieve benamingen waarop dit halfproduct ook gevonden wordt.';

create index if not exists idx_recipes_synonyms
  on public.recipes using gin (synonyms);

-- Arbeidskosten als afgeleide waarde, zodat er nergens een tweede,
-- handmatig bij te houden bedrag ontstaat.
create or replace function public.recipe_labour_cost(p_recipe_id uuid)
returns numeric
language sql
stable
as $$
  select round(
    coalesce(
      (coalesce(labour_minutes_kitchen, 0) + coalesce(labour_minutes_other, 0))
        / 60.0 * labour_cost_per_hour,
      0
    ), 4)
  from public.recipes where id = p_recipe_id;
$$;

comment on function public.recipe_labour_cost(uuid) is
  'Arbeidskosten van één productie: (keukenminuten + overige minuten) / 60 x uurtarief. 0 als er geen uurtarief is ingesteld.';

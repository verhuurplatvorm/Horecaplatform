-- 0039_receptkosten_afval_margevrij.sql
-- Twee extra kostencomponenten op receptniveau (los van de bestaande
-- per-ingrediënt verlies%):
-- - waste_percentage: algemene keukenderving/afval over de totale
--   ingrediëntkostprijs (bv. snijverlies dat niet aan één ingrediënt is
--   toe te wijzen).
-- - margin_free_costs: vaste kosten (bv. verpakking) die wél in de
--   totale kostprijs meetellen, maar NIET worden vermenigvuldigd met de
--   winstmarge bij het berekenen van de adviesverkoopprijs — ze worden
--   er na de margeberekening gewoon bovenop opgeteld.

alter table public.recipes
  add column if not exists waste_percentage numeric(5,2) not null default 0,
  add column if not exists margin_free_costs numeric(10,2) not null default 0;

comment on column public.recipes.waste_percentage is
  'Algemeen afval-/dervingspercentage over de totale ingrediëntkostprijs van dit recept (los van verlies% per ingrediëntregel).';
comment on column public.recipes.margin_free_costs is
  'Vaste kosten (bv. verpakking) die in de totale kostprijs meetellen, maar niet meegerekend worden in de winstmarge bij de adviesprijs.';

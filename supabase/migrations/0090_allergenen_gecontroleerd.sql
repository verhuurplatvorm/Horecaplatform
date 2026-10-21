-- 0090_allergenen_gecontroleerd.sql
-- Onderscheid "allergenen nog niet beoordeeld" van "beoordeeld: geen
-- allergenen". Een leeg allergenenveld betekende tot nu toe beide, waardoor
-- bv. zout of een ui nooit als "bekend" gold en recepten altijd "onzeker"
-- bleven. Bestaande producten blijven op "niet gecontroleerd".

alter table public.products
  add column if not exists allergens_checked boolean not null default false;

comment on column public.products.allergens_checked is
  'true = allergenen zijn beoordeeld (ook als de lijst leeg is, dus: geen allergenen). false = onbekend.';

-- 0095_auto_doorvoeren_drempel.sql
-- Instelbare grens voor het automatisch doorvoeren van factuurprijzen
-- (voorheen vast 30%). Standaard 15%.
alter table public.groups add column if not exists auto_apply_max_change_pct numeric(5,2) not null default 15;
comment on column public.groups.auto_apply_max_change_pct is 'Prijswijziging (%) boven deze grens wordt bij automatisch doorvoeren van een factuur niet doorgevoerd maar blijft ter controle.';

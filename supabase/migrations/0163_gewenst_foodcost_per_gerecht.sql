-- 0163: Gewenst foodcost% per gerecht (leeg = 30%).
alter table public.recipes add column if not exists target_foodcost_pct numeric(5,2);
comment on column public.recipes.target_foodcost_pct is 'Gewenst foodcost% voor de adviesverkoopprijs van dit gerecht; leeg = 30%.';

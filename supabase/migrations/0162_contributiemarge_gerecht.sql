-- 0162: Contributiemarge per gerecht (euro per portie, excl. btw).
-- Adviesprijs incl. btw = (kostprijs + marge) x (1 + btw).
alter table public.recipes add column if not exists contribution_margin numeric(10,2);
comment on column public.recipes.contribution_margin is 'Gewenste contributiemarge per portie in euro (excl. btw). Adviesprijs = (kostprijs + marge) x (1 + btw).';

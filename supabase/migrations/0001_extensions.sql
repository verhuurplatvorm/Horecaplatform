-- 0001_extensions.sql
-- Basisextensies en generieke helperfuncties.

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- fuzzy zoeken (artikel/leveranciersnamen)

-- Generieke trigger die updated_at bijwerkt bij iedere UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Zet updated_at automatisch op now() bij elke UPDATE. Wordt per tabel als trigger gekoppeld.';

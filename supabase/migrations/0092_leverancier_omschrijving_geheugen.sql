-- 0092_leverancier_omschrijving_geheugen.sql
-- Geheugen per leverancier voor factuurregels ZONDER EAN of artikelnummer:
-- een omschrijving die eenmaal aan een ingrediënt is gekoppeld (en toegepast)
-- wordt bij de volgende factuur van dezelfde leverancier automatisch herkend.

create table if not exists public.supplier_description_matches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  normalized_description text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  updated_at timestamptz not null default now(),
  unique (supplier_id, normalized_description)
);

create index if not exists idx_supplier_description_matches_product
  on public.supplier_description_matches(product_id);

alter table public.supplier_description_matches enable row level security;

drop policy if exists supplier_description_matches_all on public.supplier_description_matches;
create policy supplier_description_matches_all on public.supplier_description_matches
  for all
  using (group_id = public.current_user_group_id())
  with check (group_id = public.current_user_group_id());

comment on table public.supplier_description_matches is
  'Per leverancier: genormaliseerde factuuromschrijving -> ingrediënt, voor regels zonder EAN/artikelnummer.';

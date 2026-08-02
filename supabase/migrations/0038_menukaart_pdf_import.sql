-- 0038_menukaart_pdf_import.sql
-- Menukaart als PDF uploaden en automatisch uitlezen. Hergebruikt bewust
-- de bestaande menukaarten/mappen/recepten-structuur — een geïmporteerd
-- gerecht wordt een normaal (concept-)recept + menukaartitem, zodat er
-- later gewoon recepturen, ingrediënten, kostprijzen, allergenen en
-- foto's aan toegevoegd kunnen worden via de bestaande schermen.

alter table public.menu_cards
  add column if not exists source_file_path text;

comment on column public.menu_cards.source_file_path is
  'Pad in de opslagbucket "menukaarten" naar het originele bronbestand (PDF), indien deze menukaart via import is aangemaakt.';

insert into storage.buckets (id, name, public)
values ('menukaarten', 'menukaarten', false)
on conflict (id) do nothing;

drop policy if exists "menukaarten_select_eigen_groep" on storage.objects;
create policy "menukaarten_select_eigen_groep"
  on storage.objects for select
  using (
    bucket_id = 'menukaarten'
    and (storage.foldername(name))[1] = public.current_user_group_id()::text
  );

drop policy if exists "menukaarten_insert_eigen_groep" on storage.objects;
create policy "menukaarten_insert_eigen_groep"
  on storage.objects for insert
  with check (
    bucket_id = 'menukaarten'
    and (storage.foldername(name))[1] = public.current_user_group_id()::text
  );

create or replace function public.match_recipe_by_name(
  p_group_id uuid,
  p_name text
)
returns table (
  recipe_id uuid,
  recipe_name text,
  similarity_score real
)
language sql
stable
as $$
  select r.id, r.name, similarity(lower(r.name), lower(p_name))
  from public.recipes r
  where r.group_id = p_group_id
    and r.recipe_kind = 'gerecht'
    and similarity(lower(r.name), lower(p_name)) > 0.4
  order by similarity(lower(r.name), lower(p_name)) desc
  limit 3;
$$;

comment on function public.match_recipe_by_name(uuid, text) is
  'Zoekt bestaande gerechten met een gelijkende naam, voor dubbel-detectie bij het importeren van een menukaart-PDF.';

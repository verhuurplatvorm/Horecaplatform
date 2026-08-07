-- 0046_leverancier_naam_matcher.sql
-- Naamgelijkenis-zoeker voor leveranciers, zelfde patroon als
-- match_recipe_by_name / match_product_by_name. Gebruikt bij het
-- bulk-importeren van producten met meerdere leveranciers in één
-- bestand: als een leveranciersnaam niet exact (of na het strippen van
-- een bekend achtervoegsel zoals "- InOne") overeenkomt, wordt hiermee
-- een suggestie gedaan — nooit automatisch een nieuwe leverancier
-- aanmaken.

create or replace function public.match_supplier_by_name(
  p_group_id uuid,
  p_name text
)
returns table (
  supplier_id uuid,
  supplier_name text,
  similarity_score real
)
language sql
stable
as $$
  select s.id, s.name, similarity(lower(s.name), lower(p_name))
  from public.suppliers s
  where s.group_id = p_group_id
    and s.is_active
    and similarity(lower(s.name), lower(p_name)) > 0.3
  order by 3 desc
  limit 5;
$$;

comment on function public.match_supplier_by_name(uuid, text) is
  'Zoekt bestaande leveranciers met een gelijkende naam, voor het koppelen van leveranciers bij het bulk-importeren van producten uit meerdere leveranciers. Maakt nooit automatisch een nieuwe leverancier aan.';

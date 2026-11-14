-- Operator-rol: keukenmedewerker die recepten, halfproducten en
-- ingrediënten alleen mag bekijken (plus stickers, keukenlijsten,
-- producties, HACCP en afval volgens de bestaande rolrechten).
-- Beveiliging op databaseniveau: extra RESTRICTIVE policies die alleen
-- voor operators gelden; voor alle andere gebruikers verandert niets.

alter table public.roles add column if not exists operator_view boolean not null default false;
update public.roles set operator_view = true where lower(name) = 'operator';

-- Is de ingelogde gebruiker (uitsluitend) operator?
-- Groepsbeheerders nooit; wie naast Operator ook een andere rol heeft,
-- houdt de rechten van die andere rol.
create or replace function public.current_user_is_operator()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    not coalesce((select up.is_group_admin from public.user_profiles up where up.id = auth.uid()), false)
    and exists (
      select 1 from public.user_company_access uca
      join public.roles r on r.id = uca.role_id
      where uca.user_id = auth.uid() and r.operator_view
    )
    and not exists (
      select 1 from public.user_company_access uca
      join public.roles r on r.id = uca.role_id
      where uca.user_id = auth.uid() and not r.operator_view
    ),
    false);
$$;
grant execute on function public.current_user_is_operator() to authenticated;

-- Alleen-lezen voor operators op stamgegevens.
do $$
declare
  t text;
begin
  foreach t in array array[
    'recipes', 'recipe_ingredients', 'recipe_revisions', 'recipe_folders', 'halfproduct_folders',
    'products', 'product_packagings', 'product_company_settings',
    'supplier_products', 'suppliers', 'supplier_name_aliases', 'supplier_description_matches',
    'supplier_contract_prices', 'packaging_corrections',
    'price_import_batches', 'price_import_rows',
    'menu_cards', 'menu_folders', 'menu_items',
    'sales_products', 'sales_product_components',
    'kitchen_stations',
    'event_menus', 'event_menu_sections', 'event_menu_lines'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop policy if exists operator_readonly_insert on public.%I', t);
    execute format('drop policy if exists operator_readonly_update on public.%I', t);
    execute format('drop policy if exists operator_readonly_delete on public.%I', t);
    execute format('create policy operator_readonly_insert on public.%I as restrictive for insert to authenticated with check (not (select public.current_user_is_operator()))', t);
    execute format('create policy operator_readonly_update on public.%I as restrictive for update to authenticated using (not (select public.current_user_is_operator()))', t);
    execute format('create policy operator_readonly_delete on public.%I as restrictive for delete to authenticated using (not (select public.current_user_is_operator()))', t);
  end loop;
end;
$$;

-- Functies die als eigenaar draaien (en RLS dus omzeilen) en stamgegevens
-- wijzigen: operators weigeren.
do $$
declare
  f text;
  d text;
  n text;
begin
  foreach f in array array[
    'public.set_recipe_station(uuid[], uuid)',
    'public.set_recipe_line_station(uuid, uuid)',
    'public.apply_price_import_row(uuid)',
    'public.rollback_price_import_batch(uuid)',
    'public.rollback_recipe_import(uuid)'
  ] loop
    begin
      d := pg_get_functiondef(f::regprocedure);
    exception when others then
      raise notice 'functie % niet gevonden, overgeslagen', f;
      continue;
    end;
    if position('current_user_is_operator' in d) > 0 then
      continue;
    end if;
    n := regexp_replace(d, '(\$function\$\s*(declare.*?)?)\mbegin\M',
      E'\\1begin\n  if (select public.current_user_is_operator()) then\n    raise exception ''Geen rechten: operators kunnen niets wijzigen.'';\n  end if;', 'i');
    if n = d then
      raise exception 'Kon % niet aanpassen', f;
    end if;
    execute n;
  end loop;
end;
$$;

-- Rolrechten van Operator: recepten, halfproducten, ingrediënten,
-- menukaarten en bedrijven alleen bekijken (geen kostprijzen).
update public.role_permissions rp
set can_create = false, can_edit = false, can_delete = false, can_view_financial = false
from public.roles r
where r.id = rp.role_id and r.operator_view
  and rp.module_key in ('recepturen', 'halfproducten', 'producten', 'menukaarten', 'bedrijven');

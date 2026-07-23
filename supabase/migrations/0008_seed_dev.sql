-- 0008_seed_dev.sql
-- Testdata voor lokale ontwikkeling: één groep, twee juridische
-- entiteiten, drie bedrijven van verschillend type, met vestigingen,
-- rollen, een centraal product/leverancier/receptuur (spec §36-7:
-- "gebruik testdata voor meerdere bedrijven").
--
-- LET OP: draai dit alleen in dev/test-omgevingen, nooit in productie.
-- Koppel dit bestand niet automatisch aan een productie-migratiepad.

do $$
declare
  v_group_id uuid := gen_random_uuid();
  v_legal_a  uuid := gen_random_uuid();
  v_legal_b  uuid := gen_random_uuid();
  v_company_restaurant uuid := gen_random_uuid();
  v_company_beach uuid := gen_random_uuid();
  v_company_hotel uuid := gen_random_uuid();
  v_location_restaurant uuid := gen_random_uuid();
  v_location_beach uuid := gen_random_uuid();
  v_role_directie uuid := gen_random_uuid();
  v_role_vestigingsmanager uuid := gen_random_uuid();
  v_product_bier uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_recipe uuid := gen_random_uuid();
begin
  insert into public.groups (id, name) values (v_group_id, 'Kust Horeca Groep (demo)');

  insert into public.legal_entities (id, group_id, name, legal_type, kvk_number)
  values
    (v_legal_a, v_group_id, 'Kust Horeca Holding B.V.', 'holding', '12345678'),
    (v_legal_b, v_group_id, 'Strand Exploitatie B.V.', 'bv', '87654321');

  insert into public.companies (id, group_id, legal_entity_id, name, kind, is_seasonal)
  values
    (v_company_restaurant, v_group_id, v_legal_a, 'Restaurant De Kade', 'restaurant', false),
    (v_company_beach, v_group_id, v_legal_b, 'Beachclub Zonnig', 'beachclub', true),
    (v_company_hotel, v_group_id, v_legal_a, 'Hotel Duinzicht', 'hotel', false);

  insert into public.locations (id, group_id, company_id, name)
  values
    (v_location_restaurant, v_group_id, v_company_restaurant, 'Hoofdvestiging'),
    (v_location_beach, v_group_id, v_company_beach, 'Strandlocatie Noord');

  insert into public.departments (group_id, company_id, location_id, name, department_type)
  values
    (v_group_id, v_company_restaurant, v_location_restaurant, 'Keuken', 'keuken'),
    (v_group_id, v_company_restaurant, v_location_restaurant, 'Bar', 'bar'),
    (v_group_id, v_company_beach, v_location_beach, 'Terras', 'terras');

  insert into public.cost_centers (group_id, company_id, code, name)
  values
    (v_group_id, v_company_restaurant, 'KEUKEN-01', 'Keuken De Kade'),
    (v_group_id, v_company_beach, 'BAR-01', 'Bar Zonnig');

  insert into public.roles (id, group_id, key, name, is_system) values
    (v_role_directie, v_group_id, 'directie', 'Directie', true),
    (v_role_vestigingsmanager, v_group_id, 'vestigingsmanager', 'Vestigingsmanager', true);

  insert into public.role_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_view_financial)
  values
    (v_role_directie, 'alles', true, true, true, true, true),
    (v_role_vestigingsmanager, 'recepturen', true, true, true, false, false),
    (v_role_vestigingsmanager, 'inkoop', true, true, true, false, true);

  insert into public.products (id, group_id, name, kind, product_group, base_unit, allergens)
  values
    (v_product_bier, v_group_id, 'Pilsener fust 30L', 'inkoopartikel', 'dranken-alcoholisch', 'ml', '["gluten"]'::jsonb);

  insert into public.suppliers (id, group_id, name, email, delivery_days)
  values
    (v_supplier, v_group_id, 'Noordzee Drankengroothandel', 'inkoop@noordzeedranken.nl', '["maandag","donderdag"]'::jsonb);

  insert into public.supplier_products (supplier_id, product_id, company_id, packaging_description, packaging_unit_count, purchase_price, is_contract_price)
  values
    (v_supplier, v_product_bier, null, 'fust 30L', 30000, 89.50, true);

  insert into public.recipes (id, group_id, company_id, name, category, portion_size, portion_unit, status, is_central)
  values
    (v_recipe, v_group_id, null, 'Pils 250ml', 'drank', 250, 'ml', 'goedgekeurd', true);

  insert into public.recipe_ingredients (recipe_id, product_id, quantity, unit)
  values
    (v_recipe, v_product_bier, 250, 'ml');

  insert into public.recipe_company_links (recipe_id, company_id)
  values
    (v_recipe, v_company_restaurant),
    (v_recipe, v_company_beach);

  raise notice 'Demo group_id: %', v_group_id;
end $$;

-- 0007_rls_policies.sql
-- Row Level Security: voorkomt dat gegevens tussen bedrijven zichtbaar
-- zijn zonder de juiste rechten (spec §2, §26, §31, §32).
--
-- Basisregel: group admins zien alles binnen hun groep; overige
-- gebruikers alleen bedrijven waarvoor via user_company_access
-- expliciet toegang is verleend (public.has_company_access()).

alter table public.groups enable row level security;
alter table public.legal_entities enable row level security;
alter table public.companies enable row level security;
alter table public.company_modules enable row level security;
alter table public.locations enable row level security;
alter table public.departments enable row level security;
alter table public.cost_centers enable row level security;
alter table public.user_profiles enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_company_access enable row level security;
alter table public.products enable row level security;
alter table public.product_company_settings enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_products enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_revisions enable row level security;
alter table public.recipe_company_links enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.audit_log enable row level security;

-- ---------------------------------------------------------------------
-- Groep: iedereen binnen de groep mag de eigen groep lezen.
-- ---------------------------------------------------------------------
create policy groups_select on public.groups
  for select using (id = public.current_user_group_id());

-- ---------------------------------------------------------------------
-- Juridisch bedrijf: leesbaar voor group admins, of voor gebruikers die
-- toegang hebben tot minstens één company onder dat juridisch bedrijf.
-- ---------------------------------------------------------------------
create policy legal_entities_select on public.legal_entities
  for select using (
    group_id = public.current_user_group_id()
    and (
      public.is_group_admin()
      or exists (
        select 1 from public.companies c
        where c.legal_entity_id = legal_entities.id
          and public.has_company_access(c.id)
      )
    )
  );

create policy legal_entities_write on public.legal_entities
  for all using (public.is_group_admin())
  with check (public.is_group_admin());

-- ---------------------------------------------------------------------
-- Bedrijven: select alleen bedrijven met toegang; wijzigen is voorbehouden
-- aan group admins (aanmaken/opheffen van bedrijven is een groepsbeslissing).
-- ---------------------------------------------------------------------
create policy companies_select on public.companies
  for select using (public.has_company_access(id));

create policy companies_write on public.companies
  for all using (public.is_group_admin())
  with check (public.is_group_admin());

create policy company_modules_select on public.company_modules
  for select using (public.has_company_access(company_id));

create policy company_modules_write on public.company_modules
  for all using (public.is_group_admin())
  with check (public.is_group_admin());

-- ---------------------------------------------------------------------
-- Vestigingen, afdelingen, kostenplaatsen: volgen het company_id.
-- ---------------------------------------------------------------------
create policy locations_select on public.locations
  for select using (public.has_company_access(company_id));
create policy locations_write on public.locations
  for all using (public.has_company_access(company_id))
  with check (public.has_company_access(company_id));

create policy departments_select on public.departments
  for select using (public.has_company_access(company_id));
create policy departments_write on public.departments
  for all using (public.has_company_access(company_id))
  with check (public.has_company_access(company_id));

create policy cost_centers_select on public.cost_centers
  for select using (public.has_company_access(company_id));
create policy cost_centers_write on public.cost_centers
  for all using (public.has_company_access(company_id))
  with check (public.has_company_access(company_id));

-- ---------------------------------------------------------------------
-- Gebruikers en rechten.
-- Een gebruiker mag altijd het eigen profiel lezen; group admins zien
-- alle profielen binnen de groep. Alleen group admins muteren rechten.
-- ---------------------------------------------------------------------
create policy user_profiles_select_self on public.user_profiles
  for select using (id = auth.uid() or public.is_group_admin());

create policy user_profiles_write_admin on public.user_profiles
  for all using (public.is_group_admin())
  with check (public.is_group_admin());

create policy roles_select on public.roles
  for select using (group_id = public.current_user_group_id());
create policy roles_write_admin on public.roles
  for all using (public.is_group_admin())
  with check (public.is_group_admin());

create policy role_permissions_select on public.role_permissions
  for select using (
    exists (select 1 from public.roles r where r.id = role_permissions.role_id
            and r.group_id = public.current_user_group_id())
  );
create policy role_permissions_write_admin on public.role_permissions
  for all using (public.is_group_admin())
  with check (public.is_group_admin());

create policy user_company_access_select on public.user_company_access
  for select using (user_id = auth.uid() or public.has_company_access(company_id));
create policy user_company_access_write_admin on public.user_company_access
  for all using (public.is_group_admin())
  with check (public.is_group_admin());

-- ---------------------------------------------------------------------
-- Centrale productdatabase: groepsbreed leesbaar voor iedereen met
-- minstens één bedrijf in de groep (spec §6: één centraal artikel kan
-- door meerdere bedrijven gebruikt worden -> moet dus groepsbreed
-- zichtbaar zijn om te kunnen hergebruiken). Schrijven is voorbehouden
-- aan group admins en rollen met de juiste permissie (afgedwongen in
-- de applicatielaag via role_permissions; RLS bewaakt hier de grens
-- 'lid van de groep').
-- ---------------------------------------------------------------------
create policy products_select on public.products
  for select using (
    group_id = public.current_user_group_id()
    and (public.is_group_admin() or exists (
      select 1 from public.user_company_access uca
      join public.companies c on c.id = uca.company_id
      where uca.user_id = auth.uid() and c.group_id = products.group_id
    ))
  );
create policy products_write on public.products
  for all using (group_id = public.current_user_group_id())
  with check (group_id = public.current_user_group_id());

create policy product_company_settings_select on public.product_company_settings
  for select using (public.has_company_access(company_id));
create policy product_company_settings_write on public.product_company_settings
  for all using (public.has_company_access(company_id))
  with check (public.has_company_access(company_id));

-- ---------------------------------------------------------------------
-- Leveranciers: centrale leveranciers (company_id null) groepsbreed
-- zichtbaar; lokale leveranciers alleen voor het eigen bedrijf.
-- ---------------------------------------------------------------------
create policy suppliers_select on public.suppliers
  for select using (
    group_id = public.current_user_group_id()
    and (company_id is null or public.has_company_access(company_id))
  );
create policy suppliers_write on public.suppliers
  for all using (company_id is null and public.is_group_admin() or public.has_company_access(company_id))
  with check (company_id is null and public.is_group_admin() or public.has_company_access(company_id));

create policy supplier_products_select on public.supplier_products
  for select using (
    company_id is null
      and exists (select 1 from public.suppliers s where s.id = supplier_products.supplier_id
                  and s.group_id = public.current_user_group_id())
    or public.has_company_access(company_id)
  );
create policy supplier_products_write on public.supplier_products
  for all using (company_id is null and public.is_group_admin() or public.has_company_access(company_id))
  with check (company_id is null and public.is_group_admin() or public.has_company_access(company_id));

-- ---------------------------------------------------------------------
-- Recepturen: centrale recepturen (company_id null) groepsbreed
-- zichtbaar; lokale varianten alleen voor het eigen bedrijf. Alleen
-- group admins (of gemandateerde rollen, applicatielaag) muteren de
-- centrale standaard; lokaal aangepaste varianten zijn eigendom van
-- het bedrijf.
-- ---------------------------------------------------------------------
create policy recipes_select on public.recipes
  for select using (
    (company_id is null and group_id = public.current_user_group_id())
    or public.has_company_access(company_id)
  );
create policy recipes_write on public.recipes
  for all using (
    (company_id is null and public.is_group_admin())
    or public.has_company_access(company_id)
  )
  with check (
    (company_id is null and public.is_group_admin())
    or public.has_company_access(company_id)
  );

create policy recipe_revisions_select on public.recipe_revisions
  for select using (
    exists (
      select 1 from public.recipes r where r.id = recipe_revisions.recipe_id
      and ((r.company_id is null and r.group_id = public.current_user_group_id())
           or public.has_company_access(r.company_id))
    )
  );

create policy recipe_company_links_select on public.recipe_company_links
  for select using (public.has_company_access(company_id));
create policy recipe_company_links_write on public.recipe_company_links
  for all using (public.has_company_access(company_id))
  with check (public.has_company_access(company_id));

create policy recipe_ingredients_select on public.recipe_ingredients
  for select using (
    exists (
      select 1 from public.recipes r where r.id = recipe_ingredients.recipe_id
      and ((r.company_id is null and r.group_id = public.current_user_group_id())
           or public.has_company_access(r.company_id))
    )
  );
create policy recipe_ingredients_write on public.recipe_ingredients
  for all using (
    exists (
      select 1 from public.recipes r where r.id = recipe_ingredients.recipe_id
      and ((r.company_id is null and public.is_group_admin())
           or public.has_company_access(r.company_id))
    )
  )
  with check (
    exists (
      select 1 from public.recipes r where r.id = recipe_ingredients.recipe_id
      and ((r.company_id is null and public.is_group_admin())
           or public.has_company_access(r.company_id))
    )
  );

-- ---------------------------------------------------------------------
-- Auditlog: alleen group admins mogen de log inzien; niemand mag hem
-- vanuit de client aanpassen (alleen de trigger, via SECURITY DEFINER,
-- schrijft erin).
-- ---------------------------------------------------------------------
create policy audit_log_select_admin on public.audit_log
  for select using (public.is_group_admin());

-- 0117_stickers.sql
--
-- Losse functie "Sticker afdrukken": productiedatum-, vers- en diepvriesstickers
-- met digitale HACCP-registratie.
--
-- Uitgangspunten
-- * Volledig additief: niets bestaands wordt gewijzigd of verwijderd. De
--   bestaande halfproduct-sticker (production_labels) blijft zoals hij is.
-- * Geen productieopdracht, recept of voorraad nodig; geen voorraadmutaties.
-- * Medewerker is altijd verplicht en komt uit user_profiles. Op een gedeeld
--   keukenaccount moet een medewerker zich eerst met pincode melden
--   (bestaande HACCP-medewerkersessie).
-- * Stickerregistraties zijn alleen-toevoegen. Herdrukken zijn nieuwe regels
--   met verwijzing naar het origineel en dezelfde stickergegevens.
-- * Afdrukken loopt uitsluitend via sticker_print() / sticker_reprint(); de
--   server controleert de termijnen opnieuw.

-- ---------------------------------------------------------------------
-- 0. Gedeelde keukenaccounts (bv. "Het Strand", "Keuken Zomers")
-- ---------------------------------------------------------------------
alter table public.user_profiles
  add column if not exists is_shared_account boolean not null default false;

comment on column public.user_profiles.is_shared_account is
  'Gedeeld keukenaccount (tablet/keukencomputer). Hierop mag niet zonder gekozen medewerker worden geregistreerd.';

-- ---------------------------------------------------------------------
-- 1. Rechten
-- ---------------------------------------------------------------------
-- Recht van een willekeurige gebruiker (niet alleen de ingelogde) op een module.
create or replace function public.user_has_module_permission(
  p_user_id uuid,
  p_company_id uuid,
  p_module_key text,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.user_profiles up
      where up.id = p_user_id and up.is_active and up.is_group_admin
    )
    or exists (
      select 1
      from public.user_company_access uca
      join public.role_permissions rp on rp.role_id = uca.role_id
      where uca.user_id = p_user_id
        and uca.company_id = p_company_id
        and rp.module_key = p_module_key
        and case p_action
              when 'view' then rp.can_view
              when 'create' then rp.can_create
              when 'edit' then rp.can_edit
              when 'delete' then rp.can_delete
              else false
            end
    );
$$;

-- Mag de ingelogde gebruiker de bewaartermijnen (groepsbreed) beheren?
create or replace function public.sticker_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_group_admin()
    or exists (
      select 1
      from public.user_company_access uca
      join public.role_permissions rp on rp.role_id = uca.role_id
      where uca.user_id = auth.uid()
        and rp.module_key = 'stickers_beheer'
        and rp.can_edit
    );
$$;

insert into public.role_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_view_financial)
select r.id, m.module_key,
  true,
  case when m.module_key = 'stickers' then true else r.key in ('chef', 'directie') end,
  r.key in ('chef', 'directie'),
  false,
  false
from public.roles r
cross join (values ('stickers'), ('stickers_beheer')) as m(module_key)
where not (r.key not in ('chef', 'directie') and m.module_key = 'stickers_beheer')
on conflict (role_id, module_key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Diepvriescategorieën (groepsbreed)
-- ---------------------------------------------------------------------
create table if not exists public.sticker_freezer_categories (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null default public.current_user_group_id()
                  references public.groups(id) on delete cascade,
  key           text,
  name          text not null check (length(trim(name)) > 0),
  months        smallint check (months between 1 and 36),   -- null = handmatig invoeren
  storage_temp  text not null default '-18 °C of kouder',
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  approved_at   timestamptz,
  approved_by   uuid references public.user_profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists sticker_freezer_categories_name_uq
  on public.sticker_freezer_categories (group_id, lower(trim(name)));

comment on table public.sticker_freezer_categories is
  'Diepvriescategorieën met standaard bewaartermijn (kalendermaanden). Pas na goedkeuring (approved_at) wordt de termijn automatisch gebruikt.';

-- Goedkeuring vervalt bij elke inhoudelijke wijziging; alleen de beheerder
-- zelf kan goedkeuren (approved_by = ingelogde gebruiker).
create or replace function public.sticker_freezer_category_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.group_id := old.group_id;
    new.updated_at := now();
    if (old.months, old.storage_temp) is distinct from (new.months, new.storage_temp)
       and new.approved_at is not distinct from old.approved_at then
      new.approved_at := null;
      new.approved_by := null;
    end if;
  end if;
  if new.approved_at is not null
     and (tg_op = 'INSERT' or old.approved_at is distinct from new.approved_at) then
    new.approved_at := now();
    new.approved_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace trigger trg_sticker_freezer_category_guard
  before insert or update on public.sticker_freezer_categories
  for each row execute function public.sticker_freezer_category_guard();

create or replace trigger trg_audit_sticker_freezer_categories
  after insert or update or delete on public.sticker_freezer_categories
  for each row execute function public.audit_row_change();

-- Voorlopige standaardlijst (bewaring bij -18 °C of kouder), NIET goedgekeurd.
insert into public.sticker_freezer_categories (group_id, key, name, months, sort_order)
select g.id, v.key, v.name, v.months, v.sort_order
from public.groups g
cross join (values
  ('brood',          'Brood en broodjes',                       1,    10),
  ('rauw_deeg',      'Rauw deeg',                               2,    20),
  ('boter',          'Boter en margarine',                      3,    30),
  ('harde_kaas',     'Harde kaas',                              2,    40),
  ('soepen_sauzen',  'Bereide soepen en sauzen',                3,    50),
  ('maaltijden',     'Bereide maaltijden',                      3,    60),
  ('gebraden_vlees', 'Gebakken/gebraden vlees',                 3,    70),
  ('vette_vis',      'Vette vis (zalm, makreel, haring)',       3,    80),
  ('magere_vis',     'Magere vis (kabeljauw, schol, koolvis)',  6,    90),
  ('schaaldieren',   'Garnalen en schaaldieren',                3,   100),
  ('gehakt',         'Rauw gehakt en hamburgers',               2,   110),
  ('worst',          'Rauwe worst en vleeswaren',               2,   120),
  ('rund',           'Rauw rundvlees',                         12,   130),
  ('varken',         'Rauw varkensvlees',                       6,   140),
  ('lam',            'Rauw lamsvlees',                         12,   150),
  ('gevogelte',      'Rauw gevogelte',                          9,   160),
  ('groenten',       'Geblancheerde groenten',                 12,   170),
  ('fruit',          'Fruit',                                  12,   180),
  ('overig',         'Overige producten',                    null,   190)
) as v(key, name, months, sort_order)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Productspecifieke instellingen (groepsbreed)
-- ---------------------------------------------------------------------
-- Voor halfproducten/gerechten geldt de verse termijn uit het recept
-- (recipes.shelf_life_rule / shelf_life_days); fresh_days is alleen voor
-- ingrediënten, zodat er geen dubbel invoerveld ontstaat.
create table if not exists public.sticker_product_settings (
  id                   uuid primary key default gen_random_uuid(),
  group_id             uuid not null default public.current_user_group_id()
                         references public.groups(id) on delete cascade,
  recipe_id            uuid references public.recipes(id) on delete cascade,
  product_id           uuid references public.products(id) on delete cascade,
  freezer_category_id  uuid references public.sticker_freezer_categories(id) on delete set null,
  freezer_months       smallint check (freezer_months between 1 and 36),
  fresh_days           smallint check (fresh_days between 0 and 60),
  note                 text,
  category_set_by      uuid references public.user_profiles(id),
  approved_at          timestamptz,
  approved_by          uuid references public.user_profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((recipe_id is null) <> (product_id is null)),
  check (recipe_id is null or fresh_days is null)
);

create unique index if not exists sticker_product_settings_recipe_uq
  on public.sticker_product_settings (recipe_id) where recipe_id is not null;
create unique index if not exists sticker_product_settings_product_uq
  on public.sticker_product_settings (group_id, product_id) where product_id is not null;

comment on table public.sticker_product_settings is
  'Per product: vaste diepvriescategorie en eventuele productspecifieke termijnen (gaan altijd voor op de algemene categorie).';

create or replace function public.sticker_product_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.group_id := old.group_id;
    new.updated_at := now();
  end if;
  -- Productspecifieke termijnen kunnen alleen door een bevoegde beheerder
  -- worden vastgelegd (RLS); vastleggen = vaststellen. Wie en wanneer wordt
  -- bewaard, de oude waarde staat in de wijzigingslog.
  if (tg_op = 'INSERT' and (new.freezer_months is not null or new.fresh_days is not null))
     or (tg_op = 'UPDATE' and (old.freezer_months, old.fresh_days) is distinct from (new.freezer_months, new.fresh_days)) then
    if new.freezer_months is null and new.fresh_days is null then
      new.approved_at := null;
      new.approved_by := null;
    else
      new.approved_at := now();
      new.approved_by := auth.uid();
    end if;
  elsif tg_op = 'UPDATE' then
    new.approved_at := old.approved_at;
    new.approved_by := old.approved_by;
  end if;
  return new;
end;
$$;

create or replace trigger trg_sticker_product_settings_guard
  before insert or update on public.sticker_product_settings
  for each row execute function public.sticker_product_settings_guard();

create or replace trigger trg_audit_sticker_product_settings
  after insert or update or delete on public.sticker_product_settings
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------
-- 4. Stickerregistraties (alleen toevoegen)
-- ---------------------------------------------------------------------
create table if not exists public.sticker_prints (
  id                    uuid primary key,   -- door de app gegenereerd: dubbel klikken = zelfde id
  group_id              uuid not null references public.groups(id) on delete restrict,
  company_id            uuid not null references public.companies(id) on delete restrict,
  company_name          text not null,
  recipe_id             uuid references public.recipes(id) on delete set null,
  product_id            uuid references public.products(id) on delete set null,
  product_name          text not null check (length(trim(product_name)) > 0),
  sticker_type          text not null check (sticker_type in ('productie', 'vers', 'diepvries')),
  freezer_category_id   uuid references public.sticker_freezer_categories(id) on delete set null,
  product_group         text,
  production_date       date not null,          -- productie- of invriesdatum
  production_time       time,
  original_expiry       date,
  original_expiry_kind  text check (original_expiry_kind in ('TGT', 'THT')),
  original_source       text check (original_source in ('batch', 'handmatig')),
  source_label_id       uuid references public.production_labels(id) on delete set null,
  standard_term         smallint,
  term_unit             text check (term_unit in ('dagen', 'maanden')),
  applied_term          smallint,
  expiry_date           date,
  term_source           text,                   -- product / categorie / standaard / handmatig
  term_changed          boolean not null default false,
  change_reason         text,
  approved_by           uuid references public.user_profiles(id),
  approved_by_name      text,
  storage_temp          text,
  batch_number          text,
  quantity              text,
  note                  text,
  employee_id           uuid not null references public.user_profiles(id),
  employee_name         text not null,
  printed_by_id         uuid not null references public.user_profiles(id),
  printed_by_name       text not null,
  recorded_by           uuid default auth.uid() references public.user_profiles(id),
  staff_session_id      uuid,
  sticker_count         smallint not null default 1 check (sticker_count between 1 and 200),
  sticker_format        text,
  reprint_of            uuid references public.sticker_prints(id) on delete restrict,
  reprint_reason        text,
  printed_at            timestamptz not null default now(),
  check (expiry_date is null or expiry_date >= production_date)
);

create index if not exists sticker_prints_company_time_idx
  on public.sticker_prints (company_id, printed_at desc);
create index if not exists sticker_prints_recipe_idx on public.sticker_prints (recipe_id);
create index if not exists sticker_prints_product_idx on public.sticker_prints (product_id);
create index if not exists sticker_prints_reprint_idx on public.sticker_prints (reprint_of);

create or replace trigger trg_sticker_prints_block
  before update or delete on public.sticker_prints
  for each row execute function public.haccp_block_change();

comment on table public.sticker_prints is
  'Alle afgedrukte stickers (HACCP). Alleen toevoegen; herdrukken zijn nieuwe regels met reprint_of en dezelfde stickergegevens.';

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
alter table public.sticker_freezer_categories enable row level security;
alter table public.sticker_product_settings enable row level security;
alter table public.sticker_prints enable row level security;

do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'sticker_freezer_categories_select') then
    create policy sticker_freezer_categories_select on public.sticker_freezer_categories
      for select using (group_id = public.current_user_group_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'sticker_freezer_categories_write') then
    create policy sticker_freezer_categories_write on public.sticker_freezer_categories
      for all using (group_id = public.current_user_group_id() and public.sticker_can_manage())
      with check (group_id = public.current_user_group_id() and public.sticker_can_manage());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'sticker_product_settings_select') then
    create policy sticker_product_settings_select on public.sticker_product_settings
      for select using (group_id = public.current_user_group_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'sticker_product_settings_write') then
    create policy sticker_product_settings_write on public.sticker_product_settings
      for all using (group_id = public.current_user_group_id() and public.sticker_can_manage())
      with check (group_id = public.current_user_group_id() and public.sticker_can_manage());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'sticker_prints_select') then
    create policy sticker_prints_select on public.sticker_prints
      for select using (public.has_company_access(company_id));
  end if;
end $p$;

-- ---------------------------------------------------------------------
-- 6. Hulpfuncties
-- ---------------------------------------------------------------------
-- Medewerkers die een sticker mogen "ondertekenen" (geen gedeelde accounts).
create or replace function public.sticker_staff(p_company_id uuid)
returns table (id uuid, full_name text, has_pin boolean, can_approve boolean)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.full_name, s.has_pin,
    public.user_has_module_permission(s.id, p_company_id, 'stickers_beheer', 'edit')
  from public.haccp_staff(p_company_id) s
  join public.user_profiles up on up.id = s.id
  where not up.is_shared_account
  order by s.full_name;
$$;

-- Standaardtermijn voor een product (server-side, zelfde regels als de app).
-- Geeft (termijn, eenheid, bron) terug; termijn null = handmatig invoeren.
create or replace function public.sticker_standard_term(
  p_type text,
  p_recipe_id uuid,
  p_product_id uuid,
  p_freezer_category_id uuid,
  out term smallint,
  out unit text,
  out source text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_set public.sticker_product_settings%rowtype;
  v_rec public.recipes%rowtype;
  v_cat public.sticker_freezer_categories%rowtype;
begin
  if p_recipe_id is not null then
    select * into v_set from public.sticker_product_settings where recipe_id = p_recipe_id;
    select * into v_rec from public.recipes where id = p_recipe_id;
  elsif p_product_id is not null then
    select * into v_set from public.sticker_product_settings
    where product_id = p_product_id and group_id = public.current_user_group_id();
  end if;

  if p_type = 'productie' then
    term := null; unit := null; source := null;
    return;
  end if;

  if p_type = 'vers' then
    unit := 'dagen';
    if v_rec.id is not null and v_rec.shelf_life_rule is distinct from 'ingevroren_3m' then
      if v_rec.shelf_life_rule = 'handmatig' then
        term := null; source := 'handmatig'; return;
      elsif v_rec.shelf_life_rule = 'zelfde_dag' then
        term := 1; source := 'product'; return;
      elsif v_rec.shelf_life_rule = 'gekoeld_2d' and v_rec.shelf_life_days is not distinct from 2 then
        term := 3; source := 'product'; return;
      elsif v_rec.shelf_life_days is not null then
        term := v_rec.shelf_life_days + 1; source := 'product'; return;
      end if;
    end if;
    if v_set.fresh_days is not null then
      term := v_set.fresh_days; source := 'product'; return;
    end if;
    term := 3; source := 'standaard';
    return;
  end if;

  -- diepvries
  unit := 'maanden';
  if v_set.freezer_months is not null then
    term := v_set.freezer_months; source := 'product'; return;
  end if;
  if v_rec.shelf_life_rule = 'ingevroren_3m' then
    term := 3; source := 'product'; return;
  end if;
  if p_freezer_category_id is not null then
    select * into v_cat from public.sticker_freezer_categories
    where id = p_freezer_category_id and group_id = public.current_user_group_id();
    if v_cat.id is not null and v_cat.months is not null and v_cat.approved_at is not null then
      term := v_cat.months; source := 'categorie'; return;
    end if;
  end if;
  term := null; source := 'handmatig';
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Afdrukken
-- ---------------------------------------------------------------------
create or replace function public.sticker_print(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_company_id uuid := (p->>'company_id')::uuid;
  v_session uuid := nullif(p->>'session_id', '')::uuid;
  v_type text := p->>'sticker_type';
  v_recipe_id uuid := nullif(p->>'recipe_id', '')::uuid;
  v_product_id uuid := nullif(p->>'product_id', '')::uuid;
  v_cat_id uuid := nullif(p->>'freezer_category_id', '')::uuid;
  v_name text := trim(coalesce(p->>'product_name', ''));
  v_prod_date date := nullif(p->>'production_date', '')::date;
  v_expiry date := nullif(p->>'expiry_date', '')::date;
  v_orig date := nullif(p->>'original_expiry', '')::date;
  v_orig_kind text := nullif(p->>'original_expiry_kind', '');
  v_orig_source text := nullif(p->>'original_source', '');
  v_label_id uuid := nullif(p->>'source_label_id', '')::uuid;
  v_reason text := nullif(trim(coalesce(p->>'change_reason', '')), '');
  v_approver uuid := nullif(p->>'approver_id', '')::uuid;
  v_approver_pin text := nullif(p->>'approver_pin', '');
  v_existing public.sticker_prints%rowtype;
  v_company public.companies%rowtype;
  v_performer uuid;
  v_performer_name text;
  v_std record;
  v_expected date;
  v_applied smallint;
  v_needs_approval boolean := false;
  v_needs_reason boolean := false;
  v_hash text;
  v_cat public.sticker_freezer_categories%rowtype;
  v_set_id uuid;
  v_set_cat uuid;
begin
  if v_id is null then raise exception 'Geen registratie-id'; end if;

  -- Dubbel klikken / opnieuw verzonden: zelfde id = al geregistreerd.
  select * into v_existing from public.sticker_prints where id = v_id;
  if found then
    return jsonb_build_object('status', 'al_geregistreerd', 'id', v_existing.id);
  end if;

  select * into v_company from public.companies where id = v_company_id;
  if not found or not public.has_company_access(v_company_id) then
    raise exception 'Geen toegang tot dit bedrijf';
  end if;
  if not public.has_module_permission(v_company_id, 'stickers', 'create') then
    raise exception 'Geen recht om stickers af te drukken';
  end if;

  -- Medewerker: via pincode-sessie of het eigen (persoonlijke) account.
  v_performer := public.haccp_resolve_performer(v_company_id, v_session);
  if v_performer is null then
    raise exception 'Kies eerst de medewerker';
  end if;
  if not exists (select 1 from public.sticker_staff(v_company_id) s where s.id = v_performer) then
    raise exception 'Kies eerst de medewerker — een gedeeld keukenaccount kan geen sticker ondertekenen';
  end if;
  select full_name into v_performer_name from public.user_profiles where id = v_performer;

  if v_type not in ('productie', 'vers', 'diepvries') then
    raise exception 'Onbekend stickertype';
  end if;
  if v_name = '' then raise exception 'Productnaam is verplicht'; end if;
  if v_prod_date is null then raise exception 'Datum is verplicht'; end if;
  if v_type <> 'productie' and v_expiry is null then
    raise exception 'Houdbaarheidsdatum is verplicht';
  end if;
  if v_expiry is not null and v_expiry < v_prod_date then
    raise exception 'Houdbaarheidsdatum ligt vóór de productie-/invriesdatum';
  end if;

  if v_cat_id is not null then
    select * into v_cat from public.sticker_freezer_categories
    where id = v_cat_id and group_id = public.current_user_group_id();
    if not found then raise exception 'Onbekende productgroep'; end if;
  end if;
  if v_type = 'diepvries' and v_cat_id is null then
    raise exception 'Kies een productgroep';
  end if;

  -- Termijncontrole
  select * into v_std from public.sticker_standard_term(v_type, v_recipe_id, v_product_id, v_cat_id);
  if v_type <> 'productie' then
    if v_std.term is not null then
      v_expected := case v_std.unit
        when 'maanden' then (v_prod_date + make_interval(months => v_std.term))::date
        else v_prod_date + v_std.term end;
      if v_expiry > v_expected then
        v_needs_approval := true;  -- korter mag altijd, langer alleen met goedkeuring
      end if;
      v_applied := case when v_expiry = v_expected then v_std.term else null end;
    else
      v_needs_reason := true;  -- geen goedgekeurde termijn: handmatige datum met onderbouwing
    end if;
  end if;

  -- Bestaande THT/TGT: nooit stilzwijgend verlengen.
  if v_orig is not null then
    if v_type = 'diepvries' then
      if v_prod_date >= v_orig and v_orig_kind = 'TGT' then
        raise exception 'Invriesdatum ligt op of na de oorspronkelijke TGT — dit product mag niet meer worden ingevroren';
      end if;
      if v_prod_date > v_orig then
        raise exception 'Invriesdatum ligt na de oorspronkelijke THT — dit product mag niet meer worden ingevroren';
      end if;
    end if;
    if v_expiry > v_orig then
      if v_type = 'diepvries' and v_orig_source = 'batch' and v_label_id is not null then
        null;  -- eigen productie, ingevroren vóór TGT: volgens procedure (Hygiënecode)
      else
        v_needs_approval := true;
      end if;
    end if;
  end if;

  if v_needs_reason and v_reason is null then
    raise exception 'Geef een onderbouwing voor de handmatige datum';
  end if;

  if v_needs_approval then
    if v_reason is null then
      raise exception 'Een langere houdbaarheid vereist een onderbouwing';
    end if;
    if v_approver is null then
      raise exception 'Een langere houdbaarheid vereist goedkeuring van een leidinggevende';
    end if;
    if not public.user_has_module_permission(v_approver, v_company_id, 'stickers_beheer', 'edit') then
      raise exception 'Deze persoon mag geen langere houdbaarheid goedkeuren';
    end if;
    if v_approver is distinct from auth.uid() then
      select staff_pin_hash into v_hash from public.user_profiles where id = v_approver;
      if v_hash is null then
        raise exception 'Voor de leidinggevende is nog geen pincode ingesteld';
      end if;
      if v_approver_pin is null or extensions.crypt(v_approver_pin, v_hash) <> v_hash then
        raise exception 'Pincode leidinggevende klopt niet';
      end if;
    end if;
  else
    v_approver := null;
  end if;

  insert into public.sticker_prints (
    id, group_id, company_id, company_name, recipe_id, product_id, product_name,
    sticker_type, freezer_category_id, product_group, production_date, production_time,
    original_expiry, original_expiry_kind, original_source, source_label_id,
    standard_term, term_unit, applied_term, expiry_date, term_source, term_changed,
    change_reason, approved_by, approved_by_name, storage_temp, batch_number, quantity,
    note, employee_id, employee_name, printed_by_id, printed_by_name, recorded_by,
    staff_session_id, sticker_count, sticker_format
  ) values (
    v_id, v_company.group_id, v_company_id, coalesce(nullif(v_company.trade_name, ''), v_company.name),
    v_recipe_id, v_product_id, v_name,
    v_type, v_cat_id, case when v_cat.id is not null then v_cat.name else nullif(p->>'product_group', '') end,
    v_prod_date, nullif(p->>'production_time', '')::time,
    v_orig, v_orig_kind, v_orig_source, v_label_id,
    v_std.term, v_std.unit, v_applied, v_expiry,
    case when v_type = 'productie' then null
         when v_std.term is null then 'handmatig'
         when v_applied is null then 'aangepast'
         else v_std.source end,
    v_type <> 'productie' and (v_std.term is null or v_applied is null),
    v_reason, v_approver, (select full_name from public.user_profiles where id = v_approver),
    nullif(p->>'storage_temp', ''), nullif(trim(coalesce(p->>'batch_number', '')), ''),
    nullif(trim(coalesce(p->>'quantity', '')), ''), nullif(trim(coalesce(p->>'note', '')), ''),
    v_performer, v_performer_name, v_performer, v_performer_name, auth.uid(),
    v_session, greatest(1, least(200, coalesce((p->>'sticker_count')::int, 1))),
    nullif(p->>'sticker_format', '')
  );

  -- Gekozen productgroep onthouden voor dit product (eerste keer), of
  -- bijwerken als een leidinggevende een andere kiest.
  if v_cat_id is not null and (v_recipe_id is not null or v_product_id is not null) then
    if v_recipe_id is not null then
      select id, freezer_category_id into v_set_id, v_set_cat
      from public.sticker_product_settings where recipe_id = v_recipe_id;
    else
      select id, freezer_category_id into v_set_id, v_set_cat
      from public.sticker_product_settings
      where product_id = v_product_id and group_id = v_company.group_id;
    end if;
    if v_set_id is null then
      insert into public.sticker_product_settings (group_id, recipe_id, product_id, freezer_category_id, category_set_by)
      values (v_company.group_id, v_recipe_id, v_product_id, v_cat_id, v_performer);
    elsif v_set_cat is null
       or (v_set_cat <> v_cat_id
           and public.user_has_module_permission(v_performer, v_company_id, 'stickers_beheer', 'edit')) then
      update public.sticker_product_settings
      set freezer_category_id = v_cat_id, category_set_by = v_performer
      where id = v_set_id;
    end if;
  end if;

  return jsonb_build_object('status', 'geregistreerd', 'id', v_id,
                            'employee_name', v_performer_name);
end;
$$;

comment on function public.sticker_print(jsonb) is
  'Registreert een sticker. Controleert medewerker, termijnen, bestaande THT/TGT en goedkeuring. Dubbel klikken levert geen dubbele registratie op.';

-- Herdruk: altijd de oorspronkelijke gegevens, nooit een nieuwe datum.
create or replace function public.sticker_reprint(
  p_id uuid,
  p_original_id uuid,
  p_session_id uuid default null,
  p_count integer default 1,
  p_reason text default null,
  p_format text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig public.sticker_prints%rowtype;
  v_performer uuid;
  v_name text;
begin
  if exists (select 1 from public.sticker_prints where id = p_id) then
    return jsonb_build_object('status', 'al_geregistreerd', 'id', p_id);
  end if;
  select * into v_orig from public.sticker_prints where id = p_original_id;
  if not found then raise exception 'Sticker niet gevonden'; end if;
  -- Altijd terug naar het allereerste origineel.
  if v_orig.reprint_of is not null then
    select * into v_orig from public.sticker_prints where id = v_orig.reprint_of;
  end if;
  if not public.has_module_permission(v_orig.company_id, 'stickers', 'create') then
    raise exception 'Geen recht om stickers af te drukken';
  end if;
  v_performer := public.haccp_resolve_performer(v_orig.company_id, p_session_id);
  if not exists (select 1 from public.sticker_staff(v_orig.company_id) s where s.id = v_performer) then
    raise exception 'Kies eerst de medewerker — een gedeeld keukenaccount kan geen sticker herdrukken';
  end if;
  select full_name into v_name from public.user_profiles where id = v_performer;

  insert into public.sticker_prints (
    id, group_id, company_id, company_name, recipe_id, product_id, product_name,
    sticker_type, freezer_category_id, product_group, production_date, production_time,
    original_expiry, original_expiry_kind, original_source, source_label_id,
    standard_term, term_unit, applied_term, expiry_date, term_source, term_changed,
    change_reason, approved_by, approved_by_name, storage_temp, batch_number, quantity,
    note, employee_id, employee_name, printed_by_id, printed_by_name, recorded_by,
    staff_session_id, sticker_count, sticker_format, reprint_of, reprint_reason
  ) values (
    p_id, v_orig.group_id, v_orig.company_id, v_orig.company_name, v_orig.recipe_id,
    v_orig.product_id, v_orig.product_name, v_orig.sticker_type, v_orig.freezer_category_id,
    v_orig.product_group, v_orig.production_date, v_orig.production_time,
    v_orig.original_expiry, v_orig.original_expiry_kind, v_orig.original_source,
    v_orig.source_label_id, v_orig.standard_term, v_orig.term_unit, v_orig.applied_term,
    v_orig.expiry_date, v_orig.term_source, v_orig.term_changed, v_orig.change_reason,
    v_orig.approved_by, v_orig.approved_by_name, v_orig.storage_temp, v_orig.batch_number,
    v_orig.quantity, v_orig.note, v_orig.employee_id, v_orig.employee_name,
    v_performer, v_name, auth.uid(), p_session_id,
    greatest(1, least(200, coalesce(p_count, 1))), coalesce(p_format, v_orig.sticker_format),
    v_orig.id, nullif(trim(coalesce(p_reason, '')), '')
  );
  return jsonb_build_object('status', 'geregistreerd', 'id', p_id, 'original_id', v_orig.id);
end;
$$;

comment on function public.sticker_reprint(uuid, uuid, uuid, integer, text, text) is
  'Herdrukt een sticker met exact de oorspronkelijke gegevens (medewerker en datums blijven gelijk); wie herdrukt wordt apart vastgelegd.';

grant execute on function public.sticker_print(jsonb) to authenticated;
grant execute on function public.sticker_reprint(uuid, uuid, uuid, integer, text, text) to authenticated;
grant execute on function public.sticker_staff(uuid) to authenticated;
grant execute on function public.sticker_standard_term(text, uuid, uuid, uuid) to authenticated;
grant execute on function public.sticker_can_manage() to authenticated;

-- 0003_gebruikers_rechten.sql
-- Gebruikers, rollen en rechten (spec §26).
-- Auth zelf loopt via Supabase Auth (auth.users). Hier leggen we het
-- profiel, de rollen en de toegang per bedrijf/module vast.

create table public.user_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  group_id     uuid not null references public.groups(id) on delete cascade,
  full_name    text not null,
  email        text not null,
  is_group_admin boolean not null default false,  -- ziet/beheert alle bedrijven binnen de groep
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- Rollen zijn groepsbreed gedefinieerd (directie, vestigingsmanager,
-- chef-kok, inkoper, kwaliteitsmanager, technische dienst, ...) en
-- worden per bedrijf aan een gebruiker toegekend via user_company_access.
create table public.roles (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  key          text not null,             -- machine-naam, bv. 'vestigingsmanager'
  name         text not null,             -- weergavenaam
  description  text,
  is_system    boolean not null default false, -- systeemrollen niet verwijderbaar
  unique (group_id, key)
);

-- Rechten per rol en module (spec §26: rechten instelbaar per module,
-- bedrijf, vestiging, afdeling, handeling, gegevenstype).
-- module_key correspondeert met company_modules.module_key.
create table public.role_permissions (
  role_id      uuid not null references public.roles(id) on delete cascade,
  module_key   text not null,
  can_view     boolean not null default false,
  can_create   boolean not null default false,
  can_edit     boolean not null default false,
  can_delete   boolean not null default false,
  can_view_financial boolean not null default false, -- extra afscherming kostprijzen/marges/contracten
  primary key (role_id, module_key)
);

-- Koppeling gebruiker <-> bedrijf <-> rol. Eén gebruiker kan toegang
-- hebben tot 1, meerdere, een groep, of (via is_group_admin) alle
-- bedrijven (spec §2, §26).
create table public.user_company_access (
  user_id      uuid not null references public.user_profiles(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  role_id      uuid not null references public.roles(id) on delete restrict,
  granted_at   timestamptz not null default now(),
  granted_by   uuid references public.user_profiles(id),
  primary key (user_id, company_id)
);

create index idx_user_company_access_company on public.user_company_access(company_id);

-- ---------------------------------------------------------------------
-- Helperfuncties voor RLS-policies (0008_rls_policies.sql).
-- SECURITY DEFINER zodat ze binnen policies mogen draaien zonder
-- opnieuw tegen RLS van de onderliggende tabellen te lopen.
-- ---------------------------------------------------------------------

create or replace function public.current_user_group_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select group_id from public.user_profiles where id = auth.uid();
$$;

create or replace function public.is_group_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_group_admin from public.user_profiles where id = auth.uid()),
    false
  );
$$;

-- True als de ingelogde gebruiker toegang heeft tot het opgegeven bedrijf,
-- hetzij via expliciete company-toegang, hetzij als group admin.
create or replace function public.has_company_access(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_group_admin()
    or exists (
      select 1
      from public.user_company_access uca
      where uca.user_id = auth.uid()
        and uca.company_id = target_company_id
    );
$$;

comment on function public.has_company_access(uuid) is
  'Centrale autorisatiecheck: group admins zien alles, overige gebruikers alleen bedrijven waarvoor expliciet toegang is verleend.';

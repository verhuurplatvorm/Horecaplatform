-- 0030_menukaarten.sql
-- Menukaarten met een door de gebruiker vrij te bepalen mappenstructuur
-- (onbeperkt genest) en gerechten die centraal beheerd blijven, maar per
-- menukaart een afwijkende prijs/omschrijving/zichtbaarheid kunnen
-- hebben (spec §5/§6).

create type public.menu_card_status as enum (
  'concept', 'in_voorbereiding', 'actief', 'gepland', 'verlopen', 'gearchiveerd'
);

create table public.menu_cards (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references public.groups(id) on delete cascade,
  company_id          uuid references public.companies(id) on delete cascade,
  name                text not null,
  menu_type           text,
  description         text,
  start_date          date,
  end_date            date,
  status              public.menu_card_status not null default 'concept',
  version             numeric(4,1) not null default 1.0,
  language            text not null default 'nl',
  duplicated_from_id  uuid references public.menu_cards(id) on delete set null,
  created_by          uuid references public.user_profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_menu_cards_company on public.menu_cards(company_id);

create trigger trg_menu_cards_updated_at
  before update on public.menu_cards
  for each row execute function public.set_updated_at();

create table public.menu_folders (
  id               uuid primary key default gen_random_uuid(),
  menu_card_id     uuid not null references public.menu_cards(id) on delete cascade,
  parent_folder_id uuid references public.menu_folders(id) on delete cascade,
  name             text not null,
  sort_order       integer not null default 0,
  is_hidden        boolean not null default false
);

create index idx_menu_folders_card on public.menu_folders(menu_card_id);
create index idx_menu_folders_parent on public.menu_folders(parent_folder_id);

create or replace function public.check_no_circular_menu_folder()
returns trigger
language plpgsql
as $$
declare
  v_current uuid;
begin
  if new.parent_folder_id is null then
    return new;
  end if;
  v_current := new.parent_folder_id;
  for i in 1..50 loop
    if v_current = new.id then
      raise exception 'Een map kan niet (indirect) zijn eigen submap zijn.';
    end if;
    select parent_folder_id into v_current from public.menu_folders where id = v_current;
    exit when v_current is null;
  end loop;
  return new;
end;
$$;

create trigger trg_no_circular_menu_folder
  before insert or update on public.menu_folders
  for each row execute function public.check_no_circular_menu_folder();

create table public.menu_items (
  id                uuid primary key default gen_random_uuid(),
  folder_id         uuid not null references public.menu_folders(id) on delete cascade,
  recipe_id         uuid not null references public.recipes(id) on delete restrict,
  display_name      text,
  short_description text,
  price             numeric(10,2),
  sort_order        integer not null default 0,
  is_visible        boolean not null default true,
  available_from    date,
  available_to      date,
  is_new            boolean not null default false,
  is_popular        boolean not null default false,
  is_chefs_special  boolean not null default false,
  is_vegetarian     boolean not null default false,
  is_vegan          boolean not null default false,
  is_gluten_free    boolean not null default false,
  supplement_price  numeric(10,2),
  paired_drink      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_menu_items_folder on public.menu_items(folder_id);
create index idx_menu_items_recipe on public.menu_items(recipe_id);

create trigger trg_menu_items_updated_at
  before update on public.menu_items
  for each row execute function public.set_updated_at();

create or replace function public.enforce_menu_item_is_gerecht()
returns trigger
language plpgsql
as $$
declare
  v_kind public.recipe_kind;
begin
  select recipe_kind into v_kind from public.recipes where id = new.recipe_id;
  if v_kind is distinct from 'gerecht' then
    raise exception 'Alleen gerechten kunnen aan een menukaart gekoppeld worden, geen halfproducten.';
  end if;
  return new;
end;
$$;

create trigger trg_enforce_menu_item_is_gerecht
  before insert or update on public.menu_items
  for each row execute function public.enforce_menu_item_is_gerecht();

alter table public.menu_cards enable row level security;
alter table public.menu_folders enable row level security;
alter table public.menu_items enable row level security;

create policy menu_cards_select on public.menu_cards
  for select using (
    (company_id is null and group_id = public.current_user_group_id())
    or public.has_company_access(company_id)
  );

create policy menu_cards_write on public.menu_cards
  for all using (
    case when company_id is null then public.is_group_admin()
         else public.has_company_access(company_id) end
  )
  with check (
    case when company_id is null then public.is_group_admin()
         else public.has_company_access(company_id) end
  );

create policy menu_folders_select on public.menu_folders
  for select using (
    exists (
      select 1 from public.menu_cards mc where mc.id = menu_folders.menu_card_id
        and (
          (mc.company_id is null and mc.group_id = public.current_user_group_id())
          or public.has_company_access(mc.company_id)
        )
    )
  );

create policy menu_folders_write on public.menu_folders
  for all using (
    exists (
      select 1 from public.menu_cards mc where mc.id = menu_folders.menu_card_id
        and (
          case when mc.company_id is null then public.is_group_admin()
               else public.has_company_access(mc.company_id) end
        )
    )
  )
  with check (
    exists (
      select 1 from public.menu_cards mc where mc.id = menu_folders.menu_card_id
        and (
          case when mc.company_id is null then public.is_group_admin()
               else public.has_company_access(mc.company_id) end
        )
    )
  );

create policy menu_items_select on public.menu_items
  for select using (
    exists (
      select 1 from public.menu_folders mf
      join public.menu_cards mc on mc.id = mf.menu_card_id
      where mf.id = menu_items.folder_id
        and (
          (mc.company_id is null and mc.group_id = public.current_user_group_id())
          or public.has_company_access(mc.company_id)
        )
    )
  );

create policy menu_items_write on public.menu_items
  for all using (
    exists (
      select 1 from public.menu_folders mf
      join public.menu_cards mc on mc.id = mf.menu_card_id
      where mf.id = menu_items.folder_id
        and (
          case when mc.company_id is null then public.is_group_admin()
               else public.has_company_access(mc.company_id) end
        )
    )
  )
  with check (
    exists (
      select 1 from public.menu_folders mf
      join public.menu_cards mc on mc.id = mf.menu_card_id
      where mf.id = menu_items.folder_id
        and (
          case when mc.company_id is null then public.is_group_admin()
               else public.has_company_access(mc.company_id) end
        )
    )
  );

create trigger trg_audit_menu_cards
  after insert or update or delete on public.menu_cards
  for each row execute function public.audit_row_change();
create trigger trg_audit_menu_items
  after insert or update or delete on public.menu_items
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------
-- duplicate_menu_card: kopieert een menukaart inclusief de volledige
-- mappenstructuur (met behoud van nesting) en alle gekoppelde gerechten
-- met hun menukaart-specifieke gegevens (spec §8).
-- ---------------------------------------------------------------------
create or replace function public.duplicate_menu_card(
  p_menu_card_id uuid,
  p_new_name text,
  p_new_company_id uuid default null,
  p_new_start_date date default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_source public.menu_cards%rowtype;
  v_new_id uuid;
  v_folder record;
  v_folder_id_map jsonb := '{}'::jsonb;
  v_new_folder_id uuid;
  v_new_parent_id uuid;
begin
  select * into v_source from public.menu_cards where id = p_menu_card_id;
  if not found then
    raise exception 'Menukaart niet gevonden.';
  end if;

  insert into public.menu_cards (
    group_id, company_id, name, menu_type, description, start_date, end_date,
    status, version, language, duplicated_from_id, created_by
  ) values (
    v_source.group_id,
    coalesce(p_new_company_id, v_source.company_id),
    p_new_name,
    v_source.menu_type,
    v_source.description,
    coalesce(p_new_start_date, v_source.start_date),
    v_source.end_date,
    'concept',
    1.0,
    v_source.language,
    v_source.id,
    auth.uid()
  )
  returning id into v_new_id;

  -- Mappen kopiëren op volgorde van diepte (ouders vóór kinderen), zodat
  -- parent_folder_id altijd al een nieuwe id heeft om naar te verwijzen.
  for v_folder in
    with recursive depth_ordered as (
      select id, parent_folder_id, name, sort_order, is_hidden, 0 as depth
      from public.menu_folders where menu_card_id = p_menu_card_id and parent_folder_id is null
      union all
      select f.id, f.parent_folder_id, f.name, f.sort_order, f.is_hidden, d.depth + 1
      from public.menu_folders f
      join depth_ordered d on f.parent_folder_id = d.id
    )
    select * from depth_ordered order by depth
  loop
    v_new_parent_id := case
      when v_folder.parent_folder_id is null then null
      else (v_folder_id_map ->> v_folder.parent_folder_id::text)::uuid
    end;

    insert into public.menu_folders (menu_card_id, parent_folder_id, name, sort_order, is_hidden)
    values (v_new_id, v_new_parent_id, v_folder.name, v_folder.sort_order, v_folder.is_hidden)
    returning id into v_new_folder_id;

    v_folder_id_map := v_folder_id_map || jsonb_build_object(v_folder.id::text, v_new_folder_id::text);
  end loop;

  insert into public.menu_items (
    folder_id, recipe_id, display_name, short_description, price, sort_order,
    is_visible, available_from, available_to, is_new, is_popular, is_chefs_special,
    is_vegetarian, is_vegan, is_gluten_free, supplement_price, paired_drink
  )
  select
    (v_folder_id_map ->> mi.folder_id::text)::uuid,
    mi.recipe_id, mi.display_name, mi.short_description, mi.price, mi.sort_order,
    mi.is_visible, mi.available_from, mi.available_to, mi.is_new, mi.is_popular, mi.is_chefs_special,
    mi.is_vegetarian, mi.is_vegan, mi.is_gluten_free, mi.supplement_price, mi.paired_drink
  from public.menu_items mi
  join public.menu_folders mf on mf.id = mi.folder_id
  where mf.menu_card_id = p_menu_card_id;

  return v_new_id;
end;
$$;

comment on function public.duplicate_menu_card(uuid, text, uuid, date) is
  'Dupliceert een menukaart met volledige mappenstructuur en gekoppelde gerechten (spec §8). Draait als de aanroepende gebruiker (security invoker), dus RLS op de doeltabellen blijft gelden.';

-- 0150: Prijsontwikkeling — welke halfproducten en gerechten raakt een
-- prijswijziging (ook via onderliggende halfproducten) — en een korte
-- keukennaam voor menukaarten.

-- ---------------------------------------------------------------------
-- 1. Menukaarten: korte naam voor de keuken + oorspronkelijke bestandsnaam
-- ---------------------------------------------------------------------
alter table public.menu_cards
  add column if not exists kitchen_name text,
  add column if not exists source_file_name text;

comment on column public.menu_cards.kitchen_name is
  'Korte naam voor de keuken (bv. "Dinerkaart Het Strand"), gebruikt in Keukenlijsten. Leeg = kaartnaam.';
comment on column public.menu_cards.source_file_name is
  'Oorspronkelijke bestandsnaam van het geïmporteerde document.';

-- Bestaande imports: bestandsnaam uit het opslagpad ("<groep>/<tijd>-<naam>").
update public.menu_cards
   set source_file_name = regexp_replace(regexp_replace(source_file_path, '^.*/', ''), '^[0-9]+-', '')
 where source_file_path is not null
   and source_file_name is null;

-- ---------------------------------------------------------------------
-- 2. Prijswijzigingen die gelden voor een bedrijf (netto over de periode)
-- ---------------------------------------------------------------------
-- Per ingrediënt: de prijs vóór de eerste wijziging in de periode (oud) en
-- de prijs die nu voor het bedrijf geldt (nieuw, current_product_cost —
-- dezelfde prijsbron als de kostprijsberekening). Een groepsbrede wijziging
-- telt niet als het bedrijf een eigen actuele prijs voor dit ingrediënt
-- heeft; een wijziging van een ander bedrijf telt nooit.
create or replace function public.company_price_changes(
  p_company_id uuid,
  p_from date,
  p_product_id uuid default null
)
returns table(product_id uuid, product_name text, supplier_name text, changed_on date,
              old_price numeric, new_price numeric, delta_pct numeric, change_count integer)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with applicable as (
    select h.*
      from public.price_change_history h
     where h.valid_from >= p_from
       and h.old_price_per_base_unit is not null
       and h.new_price_per_base_unit is not null
       and (p_product_id is null or h.product_id = p_product_id)
       and (
         h.company_id = p_company_id
         or (h.company_id is null and not exists (
               select 1 from public.supplier_products sp
                where sp.product_id = h.product_id
                  and sp.company_id = p_company_id
                  and sp.valid_from <= current_date
                  and (sp.valid_to is null or sp.valid_to >= current_date)))
       )
  ),
  per_product as (
    select a.product_id,
           (array_agg(a.old_price_per_base_unit order by a.valid_from, a.id))[1] as old_price,
           (array_agg(a.supplier_id order by a.valid_from desc, a.id desc))[1] as supplier_id,
           max(a.valid_from) as changed_on,
           count(*)::int as n
      from applicable a
     group by a.product_id
  )
  select pp.product_id, coalesce(nullif(p.custom_name, ''), p.name), s.name, pp.changed_on,
         pp.old_price, cpc.price_per_base_unit,
         case when pp.old_price > 0
              then round((cpc.price_per_base_unit - pp.old_price) / pp.old_price * 100, 2) end,
         pp.n
    from per_product pp
    join public.products p on p.id = pp.product_id
    join public.current_product_cost cpc
      on cpc.product_id = pp.product_id and cpc.company_id = p_company_id
    left join public.suppliers s on s.id = pp.supplier_id
   where abs(cpc.price_per_base_unit - pp.old_price) > 0.0000001;
$$;

-- ---------------------------------------------------------------------
-- 3. Gevolgen per (ingrediënt, recept)
-- ---------------------------------------------------------------------
-- Alle halfproducten en gerechten waarin het ingrediënt zit, direct of via
-- halfproducten (op elke diepte), met het kortste pad ("via"). Oude en
-- nieuwe kostprijs komen uit de bestaande berekening
-- calculate_recipe_cost_override: dezelfde rekenregels, met alleen de prijs
-- van dit ingrediënt op oud of nieuw gezet. Kostprijs is lineair in elke
-- ingrediëntprijs, dus de verschillen per ingrediënt tellen precies op tot
-- het totale verschil van een gerecht.
create or replace function public.price_change_impact(
  p_company_id uuid,
  p_from date,
  p_product_id uuid default null
)
returns table(product_id uuid, product_name text, recipe_id uuid, recipe_name text, recipe_kind text,
              category text, via text[], old_cost numeric, new_cost numeric, delta numeric,
              sales_price_excl numeric, active_cards text[])
language sql
stable
security invoker
set search_path to 'public'
as $$
  with recursive changes as (
    select * from public.company_price_changes(p_company_id, p_from, p_product_id)
  ),
  up(product_id, recipe_id, via, ids, depth) as (
    select c.product_id, ri.recipe_id, array[]::text[], array[ri.recipe_id], 0
      from changes c
      join public.recipe_ingredients ri on ri.product_id = c.product_id
    union all
    select u.product_id, ri.recipe_id, array[h.name] || u.via, u.ids || ri.recipe_id, u.depth + 1
      from up u
      join public.recipes h on h.id = u.recipe_id
      join public.recipe_ingredients ri on ri.sub_recipe_id = u.recipe_id
     where u.depth < 15
       and not (ri.recipe_id = any(u.ids))
  ),
  hits as (
    select distinct on (u.product_id, u.recipe_id) u.product_id, u.recipe_id, u.via
      from up u
      join public.recipes r on r.id = u.recipe_id
     where r.status <> 'vervallen'
       and (r.is_central or r.company_id is null or r.company_id = p_company_id)
     order by u.product_id, u.recipe_id, u.depth
  ),
  cards as (
    select mi.recipe_id,
           array_agg(distinct coalesce(nullif(trim(mc.kitchen_name), ''), mc.name)) as names
      from public.menu_items mi
      join public.menu_folders f on f.id = mi.folder_id
      join public.menu_cards mc on mc.id = f.menu_card_id
     where mc.status = 'actief'
       and (mc.company_id is null or mc.company_id = p_company_id)
     group by mi.recipe_id
  ),
  costed as (
    select h.*, c.product_name,
           public.calculate_recipe_cost_override(h.recipe_id, p_company_id, h.product_id, c.old_price) as old_cost,
           public.calculate_recipe_cost_override(h.recipe_id, p_company_id, h.product_id, c.new_price) as new_cost
      from hits h
      join changes c on c.product_id = h.product_id
  )
  select k.product_id, k.product_name, r.id, r.name, r.recipe_kind::text, r.category, k.via,
         round(k.old_cost, 4), round(k.new_cost, 4), round(k.new_cost - k.old_cost, 4),
         case when r.sales_price > 0 then round(r.sales_price / (1 + coalesce(r.vat_rate, 9) / 100), 4) end,
         coalesce(cd.names, array[]::text[])
    from costed k
    join public.recipes r on r.id = k.recipe_id
    left join cards cd on cd.recipe_id = r.id
   where abs(k.new_cost - k.old_cost) >= 0.00005;
$$;

grant execute on function public.company_price_changes(uuid, date, uuid) to authenticated;
grant execute on function public.price_change_impact(uuid, date, uuid) to authenticated;

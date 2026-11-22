-- 0148: Dashboard — één definitie per teller, gedeeld met de bestemmingspagina.
--
-- Probleem: de tegel "Margeproblemen" (dashboard_summary_scoped) en het blok
-- "Gerechten met een margeprobleem" (dashboard_margin_problems_scoped)
-- rekenden elk op hun eigen manier:
--   * tegel: alleen status 'goedgekeurd', vaste norm 33%;
--     blok: alles behalve 'vervallen', norm uit groups.foodcost_norm_pct;
--   * blok filterde daarna nog op categorie en toonde max. 15 regels;
--   * zonder gekozen bedrijf rekende calculate_recipe_cost met kostprijs 0,
--     dus telde de tegel 0 terwijl het blok (met bedrijf) wel gerechten had;
--   * "Actuele kaart" negeerde voor welk bedrijf een menukaart is;
--   * onvolledige kostprijzen telden als "margeprobleem" (of juist niet).
--
-- Nu: alle tegels komen uit dashboard_counts, en elke teller heeft een
-- rijenfunctie (zelfde filters) die de bestemmingspagina gebruikt. Zo is
-- de teller altijd gelijk aan het aantal resultaten na het doorklikken.
--
-- p_company_ids: null = alle bedrijven; anders de gekozen bedrijven.

-- ---------------------------------------------------------------------
-- 1. Actuele kaart per bedrijf
-- ---------------------------------------------------------------------
-- Gerechten/halfproducten op een actieve menukaart van de gekozen
-- bedrijven (of een groepsbrede kaart), plus handmatig als actueel
-- gemarkeerde recepten, met alle onderliggende halfproducten.
create or replace function public.current_recipe_ids_scoped(p_company_ids uuid[])
returns table(recipe_id uuid)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with recursive roots as (
    select r.id
      from public.recipes r
     where r.is_current_menu
       and r.status <> 'vervallen'
       and (p_company_ids is null or r.is_central or r.company_id is null
            or r.company_id = any(p_company_ids))
    union
    select mi.recipe_id
      from public.menu_items mi
      join public.menu_folders f on f.id = mi.folder_id
      join public.menu_cards c on c.id = f.menu_card_id
     where c.status = 'actief'
       and (p_company_ids is null or c.company_id is null or c.company_id = any(p_company_ids))
  ),
  tree(recipe_id) as (
    select id from roots
    union
    select ri.sub_recipe_id
      from public.recipe_ingredients ri
      join tree t on t.recipe_id = ri.recipe_id
     where ri.sub_recipe_id is not null
  )
  select recipe_id from tree;
$$;

create or replace function public.current_product_ids_scoped(p_company_ids uuid[])
returns table(product_id uuid)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select distinct ri.product_id
    from public.recipe_ingredients ri
   where ri.product_id is not null
     and ri.recipe_id in (select c.recipe_id from public.current_recipe_ids_scoped(p_company_ids) c);
$$;

-- ---------------------------------------------------------------------
-- 2. Margeproblemen (tegel, blok en Gerechten-filter)
-- ---------------------------------------------------------------------
-- Definitie: gerecht (niet vervallen) met een verkoopprijs, een VOLLEDIGE
-- kostprijs (recipe_cost_status) en een foodcost boven de norm van de
-- groep (groups.foodcost_norm_pct, standaard 33%). Per bedrijf gerekend
-- met de inkoopprijzen van dat bedrijf, alleen voor recepten die bij dat
-- bedrijf horen (centraal of van dat bedrijf). Bij meerdere bedrijven telt
-- een gerecht één keer, met het bedrijf waar de foodcost het hoogst is.
-- Onvolledige kostprijzen vallen hierbuiten; die staan onder
-- "Kostprijs onvolledig".
create or replace function public.dashboard_margin_problem_rows(
  p_company_ids uuid[],
  p_only_current boolean default false,
  p_category text default null
)
returns table(recipe_id uuid, recipe_name text, category text, company_id uuid, company_name text,
              cost_price numeric, sales_price numeric, foodcost_pct numeric, margin_pct numeric,
              norm_pct numeric)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with norm as (
    select coalesce(
      (select g.foodcost_norm_pct from public.groups g where g.id = public.current_user_group_id()),
      (select max(g.foodcost_norm_pct) from public.groups g),
      33)::numeric as pct
  ),
  comp as (
    select c.id, c.name from public.companies c
     where p_company_ids is null or c.id = any(p_company_ids)
  ),
  cand as (
    select co.id as cid, co.name as cname, r.id, r.name, r.category,
           r.sales_price / (1 + coalesce(r.vat_rate, 9) / 100) as sales_excl
      from comp co
      join public.recipes r
        on r.recipe_kind = 'gerecht'
       and r.status <> 'vervallen'
       and r.sales_price > 0
       and (r.is_central or r.company_id is null or r.company_id = co.id)
       and (p_category is null or r.category = p_category)
       and (not p_only_current
            or r.id in (select x.recipe_id from public.current_recipe_ids_scoped(array[co.id]) x))
  ),
  costs as (
    select co.id as cid, x.recipe_id, x.cost
      from comp co
      cross join lateral public.calculate_recipe_costs(
        co.id, (select array_agg(c.id) from cand c where c.cid = co.id)) x
  ),
  status as (
    select co.id as cid, s.recipe_id, s.is_complete
      from comp co
      cross join lateral public.recipe_cost_status(
        co.id, (select array_agg(c.id) from cand c where c.cid = co.id)) s
  ),
  calc as (
    select c.*, k.cost,
           round(k.cost / c.sales_excl * 100, 1) as fc
      from cand c
      join costs k on k.cid = c.cid and k.recipe_id = c.id
      join status s on s.cid = c.cid and s.recipe_id = c.id
     where s.is_complete
       and k.cost is not null
       and c.sales_excl > 0
  )
  select distinct on (c.id)
         c.id, c.name, c.category, c.cid, c.cname,
         round(c.cost, 4), round(c.sales_excl, 2), c.fc,
         round((c.sales_excl - c.cost) / c.sales_excl * 100, 1),
         n.pct
    from calc c cross join norm n
   where c.cost / c.sales_excl * 100 > n.pct
   order by c.id, c.fc desc;
$$;

-- ---------------------------------------------------------------------
-- 3. Prijsalarmen (tegel, blok en Prijswijzigingen-filter)
-- ---------------------------------------------------------------------
-- Zelfde alarmregel als dashboard_price_changes, maar met bedrijf en
-- actuele kaart als filter. Afwijkingen van afgesproken prijzen op
-- facturen komen apart uit agreed_price_deviations (met dezelfde filters).
create or replace function public.dashboard_price_alert_rows(
  p_company_ids uuid[],
  p_only_current boolean default false,
  p_days integer default 30
)
returns table(price_row_id uuid, product_id uuid, product_name text, supplier_name text,
              company_id uuid, old_price numeric, new_price numeric, difference_eur numeric,
              difference_pct numeric, changed_on date)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with threshold as (
    select coalesce(max(price_alert_threshold_pct), 10) as pct from public.groups
  )
  select h.id, h.product_id, coalesce(nullif(p.custom_name, ''), p.name), s.name, h.company_id,
         h.old_purchase_price, h.new_purchase_price,
         round(h.new_purchase_price - h.old_purchase_price, 4),
         round((h.new_purchase_price - h.old_purchase_price) / h.old_purchase_price * 100, 2),
         h.valid_from
    from public.price_change_history h
    join public.products p on p.id = h.product_id
    left join public.suppliers s on s.id = h.supplier_id
    cross join threshold t
   where h.old_purchase_price is not null
     and h.old_purchase_price > 0
     and h.valid_from >= current_date - greatest(p_days, 1)
     and not h.is_acknowledged
     and (abs((h.new_purchase_price - h.old_purchase_price) / h.old_purchase_price * 100) >= t.pct
          or ((s.price_type = 'vast' or coalesce(h.is_contract_price, false))
              and abs(h.new_purchase_price - h.old_purchase_price) >= 0.005))
     and (p_company_ids is null or h.company_id is null or h.company_id = any(p_company_ids))
     and (not p_only_current
          or h.product_id in (select x.product_id from public.current_product_ids_scoped(p_company_ids) x));
$$;

create or replace function public.dashboard_agreed_deviation_rows(
  p_company_ids uuid[],
  p_only_current boolean default false,
  p_days integer default 30
)
returns table(row_id uuid, batch_id uuid, invoice_number text, invoice_date date, supplier_name text,
              product_id uuid, product_name text, description text, invoice_price numeric, ref_price numeric,
              ref_source text, diff_pct numeric, impact numeric, reasons text[])
language sql
stable
security invoker
set search_path to 'public'
as $$
  select d.*
    from public.agreed_price_deviations(p_days, p_company_ids) d
   where not p_only_current
      or d.product_id in (select x.product_id from public.current_product_ids_scoped(p_company_ids) x);
$$;

-- ---------------------------------------------------------------------
-- 4. Werkvoorraden
-- ---------------------------------------------------------------------
-- Niet-gekoppelde receptregels: regels zonder ingrediënt én zonder
-- halfproduct, in recepten die niet vervallen zijn en bij de gekozen
-- bedrijven horen. Zelfde vorm als cost_attention_items (Opschonen).
create or replace function public.dashboard_unmatched_lines(
  p_company_ids uuid[],
  p_only_current boolean default false
)
returns table(line_id uuid, recipe_id uuid, recipe_name text, recipe_kind text,
              kind text, name text, product_id uuid, sub_recipe_id uuid, unit_name text,
              active_sources text[])
language sql
stable
security invoker
set search_path to 'public'
as $$
  with cur as (select x.recipe_id from public.current_recipe_ids_scoped(p_company_ids) x)
  select ri.id, r.id, r.name, r.recipe_kind::text, 'koppeling', ri.unmatched_name,
         null::uuid, null::uuid, u.name,
         case when r.id in (select recipe_id from cur) then array['Actuele kaart'] else array[]::text[] end
    from public.recipe_ingredients ri
    join public.recipes r on r.id = ri.recipe_id
    left join public.units u on u.id = ri.unit_id
   where ri.product_id is null
     and ri.sub_recipe_id is null
     and r.status <> 'vervallen'
     and (p_company_ids is null or r.is_central or r.company_id is null
          or r.company_id = any(p_company_ids))
     and (not p_only_current or r.id in (select recipe_id from cur));
$$;

-- Importprijzen te controleren: actuele leveranciersprijzen die bij een
-- import als onzeker zijn gemarkeerd.
create or replace function public.dashboard_flagged_price_ids(
  p_company_ids uuid[],
  p_only_current boolean default false
)
returns table(id uuid)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select sp.id
    from public.supplier_products sp
   where sp.flagged_for_review
     and sp.valid_to is null
     and (p_company_ids is null or sp.company_id is null or sp.company_id = any(p_company_ids))
     and (not p_only_current
          or sp.product_id in (select x.product_id from public.current_product_ids_scoped(p_company_ids) x));
$$;

-- Facturen ter controle: geüploade/verwerkte facturen die wachten op controle.
create or replace function public.dashboard_invoice_ids(p_company_ids uuid[])
returns table(id uuid)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select b.id
    from public.price_import_batches b
   where b.source_kind = 'factuur'
     and b.status = 'wacht_op_controle'
     and (p_company_ids is null or b.company_id is null or b.company_id = any(p_company_ids));
$$;

-- E-mailfacturen te verwerken: binnengekomen mail die nog geen factuur is
-- geworden (leverancier onbekend of fout bij verwerken).
create or replace function public.dashboard_mail_ids(p_company_ids uuid[])
returns table(id uuid)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select q.id
    from public.inbound_invoice_queue q
   where q.status in ('wacht_op_leverancier', 'fout')
     and q.resulting_batch_id is null
     and (p_company_ids is null or q.company_id is null or q.company_id = any(p_company_ids));
$$;

-- ---------------------------------------------------------------------
-- 5. Alle tegels in één aanroep — telt precies de rijenfuncties hierboven
-- ---------------------------------------------------------------------
create or replace function public.dashboard_counts(
  p_company_ids uuid[],
  p_only_current boolean default false,
  p_days integer default 30
)
returns table(price_alerts integer, agreed_deviations integer, margin_problems integer,
              unmatched_lines integer, unmatched_names integer, flagged_prices integer,
              invoices_to_check integer, mail_to_process integer)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select
    (select count(*)::int from public.dashboard_price_alert_rows(p_company_ids, p_only_current, p_days)),
    (select count(*)::int from public.dashboard_agreed_deviation_rows(p_company_ids, p_only_current, p_days)),
    (select count(*)::int from public.dashboard_margin_problem_rows(p_company_ids, p_only_current, null)),
    (select count(*)::int from public.dashboard_unmatched_lines(p_company_ids, p_only_current)),
    (select count(distinct lower(regexp_replace(trim(name), '\s+', ' ', 'g')))::int
       from public.dashboard_unmatched_lines(p_company_ids, p_only_current)),
    (select count(*)::int from public.dashboard_flagged_price_ids(p_company_ids, p_only_current)),
    (select count(*)::int from public.dashboard_invoice_ids(p_company_ids)),
    (select count(*)::int from public.dashboard_mail_ids(p_company_ids));
$$;

grant execute on function public.current_recipe_ids_scoped(uuid[]) to authenticated;
grant execute on function public.current_product_ids_scoped(uuid[]) to authenticated;
grant execute on function public.dashboard_margin_problem_rows(uuid[], boolean, text) to authenticated;
grant execute on function public.dashboard_price_alert_rows(uuid[], boolean, integer) to authenticated;
grant execute on function public.dashboard_agreed_deviation_rows(uuid[], boolean, integer) to authenticated;
grant execute on function public.dashboard_unmatched_lines(uuid[], boolean) to authenticated;
grant execute on function public.dashboard_flagged_price_ids(uuid[], boolean) to authenticated;
grant execute on function public.dashboard_invoice_ids(uuid[]) to authenticated;
grant execute on function public.dashboard_mail_ids(uuid[]) to authenticated;
grant execute on function public.dashboard_counts(uuid[], boolean, integer) to authenticated;

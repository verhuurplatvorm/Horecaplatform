-- 1. current_product_cost eenduidig: bij twee even goede prijzen van hetzelfde
--    product (zelfde datum, beide geldig) koos de database er willekeurig één.
--    Nu: de laatst ingevoerde prijs wint (daarna id als vaste volgorde).
create or replace view public.current_product_cost as
 SELECT DISTINCT ON (product_id, company_id) product_id,
    company_id,
    supplier_id,
    price_per_base_unit,
    is_contract_price,
    valid_from
   FROM ( SELECT sp.product_id,
            c.id AS company_id,
            sp.supplier_id,
            sp.price_per_base_unit,
            sp.is_contract_price,
            sp.valid_from,
            1 AS source_rank,
            (sp.company_id IS NOT NULL) AS company_specific,
            sp.created_at,
            sp.id AS row_id
           FROM (supplier_products sp
             CROSS JOIN companies c)
          WHERE (((sp.company_id IS NULL) OR (sp.company_id = c.id)) AND (sp.valid_from <= CURRENT_DATE) AND ((sp.valid_to IS NULL) OR (sp.valid_to >= CURRENT_DATE)))
        UNION ALL
         SELECT p.id AS product_id,
            c.id AS company_id,
            NULL::uuid AS supplier_id,
            p.manual_price_per_base_unit AS price_per_base_unit,
            false AS is_contract_price,
            NULL::date AS valid_from,
            2 AS source_rank,
            false AS company_specific,
            NULL::timestamptz AS created_at,
            p.id AS row_id
           FROM (products p
             CROSS JOIN companies c)
          WHERE (p.manual_price_per_base_unit IS NOT NULL)) prijsbronnen
  ORDER BY product_id, company_id, source_rank, company_specific DESC, is_contract_price DESC,
           valid_from DESC NULLS LAST, created_at DESC NULLS LAST, row_id;

-- 2. Kostprijzen voor overzichten in één keer (set-based): dezelfde
--    rekenregels als calculate_recipe_cost (omrekening, verlies%, afval%,
--    margevrije kosten, halfproducten via opbrengst / gewicht per stuk).
create or replace function public.calculate_recipe_costs(p_company_id uuid, p_recipe_ids uuid[])
returns table(recipe_id uuid, cost numeric)
language plpgsql
stable
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_all uuid[];
  v_base jsonb;
  v_subs jsonb;
  v_memo jsonb := '{}'::jsonb;
  v_new jsonb;
  v_rounds integer := 0;
begin
  if p_company_id is null or p_recipe_ids is null then
    return;
  end if;

  with recursive tree(id, depth) as (
    select unnest(p_recipe_ids), 0
    union
    select ri.sub_recipe_id, t.depth + 1
    from tree t
    join public.recipe_ingredients ri on ri.recipe_id = t.id
    where ri.sub_recipe_id is not null and t.depth < 15
  )
  select array_agg(distinct id) into v_all from tree;

  -- Ingrediëntregels: kosten per recept in één query.
  with prices as (
    select cpc.product_id, cpc.price_per_base_unit
    from public.current_product_cost cpc
    where cpc.company_id = p_company_id
      and cpc.product_id in (select ri.product_id from public.recipe_ingredients ri
                             where ri.recipe_id = any(v_all) and ri.product_id is not null)
  ),
  lines as (
    select ri.recipe_id, ri.quantity, pr.price_per_base_unit as price,
           coalesce(ri.loss_percentage,
                    case when p.net_unit_quantity is not null then 0 else coalesce(p.default_loss_percentage, 0) end) as loss,
           uf.dimension as fd, uf.factor_to_base as ff,
           ut.dimension as td, ut.factor_to_base as tf,
           ua.dimension as ad, ua.factor_to_base as af,
           coalesce(p.net_unit_quantity, p.avg_unit_quantity) as bridge,
           ri.unit_id = p.base_unit_id as same_unit
    from public.recipe_ingredients ri
    join public.products p on p.id = ri.product_id
    join prices pr on pr.product_id = ri.product_id
    left join public.units uf on uf.id = ri.unit_id
    left join public.units ut on ut.id = p.base_unit_id
    left join public.units ua on ua.id = p.avg_unit_id
    where ri.recipe_id = any(v_all)
  ),
  conv as (
    select recipe_id, price, loss,
      case
        when quantity is null then null
        when same_unit then quantity
        when fd is null or td is null then null
        when fd = td or (fd <> 'aantal' and td <> 'aantal') then
          case when coalesce(tf, 0) = 0 then null else quantity * ff / tf end
        when bridge is null or bridge <= 0 or ad is null or ad = 'aantal' then null
        when fd = 'aantal' then
          case when coalesce(tf, 0) = 0 then null else quantity * bridge * af / tf end
        else
          case when coalesce(af, 0) = 0 then null else (quantity * ff / af) / bridge end
      end as qty
    from lines
  )
  select coalesce(jsonb_object_agg(recipe_id::text, total), '{}'::jsonb) into v_base
  from (select recipe_id, sum(qty * price * (1 + loss / 100.0)) total
        from conv where qty is not null and price is not null group by recipe_id) x;

  -- Halfproductregels: hoeveelheid omgerekend naar de basiseenheid van het halfproduct.
  with sl as (
    select ri.recipe_id, ri.sub_recipe_id, s.yield_quantity as yield,
           ri.quantity, ri.unit_id = s.base_unit_id as same_unit,
           uf.dimension as fd, uf.factor_to_base as ff,
           ut.dimension as td, ut.factor_to_base as tf,
           up.dimension as pd, up.factor_to_base as pf, s.piece_quantity as pq
    from public.recipe_ingredients ri
    join public.recipes s on s.id = ri.sub_recipe_id
    left join public.units uf on uf.id = ri.unit_id
    left join public.units ut on ut.id = s.base_unit_id
    left join public.units up on up.id = s.piece_unit_id
    where ri.recipe_id = any(v_all)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'r', recipe_id, 's', sub_recipe_id, 'y', yield,
           'q', case
             when quantity is null then null
             when same_unit then quantity
             when fd is null or td is null then null
             when fd = td or (fd <> 'aantal' and td <> 'aantal') then
               case when coalesce(tf, 0) = 0 then null else quantity * ff / tf end
             when pq is null or pq <= 0 or pd is null or pd = 'aantal' then null
             when fd = 'aantal' then
               case when coalesce(tf, 0) = 0 then null else quantity * pq * pf / tf end
             else
               case when coalesce(pf, 0) = 0 then null else (quantity * ff / pf) / pq end
           end)), '[]'::jsonb)
  into v_subs from sl;

  -- Van onder naar boven: per ronde alle recepten waarvan de halfproducten klaar zijn.
  loop
    v_rounds := v_rounds + 1;
    with todo as (
      select r.id from unnest(v_all) r(id)
      where not (v_memo ? r.id::text)
        and r.id::text not in (
          select e->>'r' from jsonb_array_elements(v_subs) e
          where not (v_memo ? (e->>'s'))
        )
    ),
    subsum as (
      select (e->>'r')::uuid as rid,
             sum((v_memo->>(e->>'s'))::numeric * ((e->>'q')::numeric / (e->>'y')::numeric)) as amount
      from jsonb_array_elements(v_subs) e
      where (e->>'r')::uuid in (select id from todo)
        and (e->>'q') is not null and (e->>'y') is not null and (e->>'y')::numeric > 0
      group by 1
    )
    select jsonb_object_agg(t.id::text,
             round((coalesce((v_base->>t.id::text)::numeric, 0) + coalesce(s.amount, 0))
                   * (1 + coalesce(rc.waste_percentage, 0) / 100.0) + coalesce(rc.margin_free_costs, 0), 4))
    into v_new
    from todo t
    join public.recipes rc on rc.id = t.id
    left join subsum s on s.rid = t.id;
    exit when v_new is null or v_rounds > 20;
    v_memo := v_memo || v_new;
  end loop;

  return query
    select i, case when v_memo ? i::text then (v_memo ->> i::text)::numeric
                   else public.calculate_recipe_cost(i, p_company_id) end
    from unnest(p_recipe_ids) i;
end;
$$;

grant execute on function public.calculate_recipe_costs(uuid, uuid[]) to authenticated;

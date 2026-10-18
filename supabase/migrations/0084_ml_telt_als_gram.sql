-- 0084: ml telt als gram als het niet anders kan.
-- Een product met "1 stuk = 10000 ml" kon niet naar een recept in gram/kilogram
-- omgerekend worden (melding "geen gemiddeld gewicht per stuk ingesteld").
-- Gewicht <-> inhoud rekent nu 1 ml = 1 g (factor_to_base van g en ml is 1).
create or replace function public.convert_quantity(p_product_id uuid, p_quantity numeric, p_from_unit_id uuid, p_to_unit_id uuid, p_for_cost boolean default false)
 returns numeric
 language plpgsql
 stable
as $function$
declare
  v_from record;
  v_to record;
  v_avg record;
  v_bridge_qty numeric;
  v_avg_qty numeric;
  v_net_qty numeric;
  v_avg_unit_id uuid;
begin
  if p_quantity is null or p_from_unit_id is null or p_to_unit_id is null then
    return null;
  end if;
  if p_from_unit_id = p_to_unit_id then
    return p_quantity;
  end if;

  select dimension, factor_to_base into v_from from public.units where id = p_from_unit_id;
  select dimension, factor_to_base into v_to   from public.units where id = p_to_unit_id;
  if v_from is null or v_to is null then
    return null;
  end if;

  if v_from.dimension = v_to.dimension
     or (v_from.dimension <> 'aantal' and v_to.dimension <> 'aantal') then
    if coalesce(v_to.factor_to_base, 0) = 0 then return null; end if;
    return p_quantity * v_from.factor_to_base / v_to.factor_to_base;
  end if;

  if p_product_id is null then
    return null;
  end if;

  select avg_unit_quantity, net_unit_quantity, avg_unit_id
  into v_avg_qty, v_net_qty, v_avg_unit_id
  from public.products where id = p_product_id;

  v_bridge_qty := case when p_for_cost then coalesce(v_net_qty, v_avg_qty) else v_avg_qty end;
  if v_bridge_qty is null or v_bridge_qty <= 0 or v_avg_unit_id is null then
    return null;
  end if;

  select dimension, factor_to_base into v_avg from public.units where id = v_avg_unit_id;
  if v_avg is null or v_avg.dimension = 'aantal' then
    return null;
  end if;

  if v_from.dimension = 'aantal' then
    if coalesce(v_to.factor_to_base, 0) = 0 then
      return null;
    end if;
    return p_quantity * v_bridge_qty * v_avg.factor_to_base / v_to.factor_to_base;
  else
    if coalesce(v_avg.factor_to_base, 0) = 0 then
      return null;
    end if;
    return (p_quantity * v_from.factor_to_base / v_avg.factor_to_base) / v_bridge_qty;
  end if;
end;
$function$;

-- 0060_netto_bruikbaar_gewicht.sql
--
-- Netto bruikbaar gewicht/inhoud per stuk, bovenop de brug uit 0056/0057.
--
-- Twee verschillende dingen, die bewust uit elkaar worden gehouden:
--
--   avg_unit_quantity  = BRUTO per stuk (1 avocado = 180 gram)
--                        → gebruikt om HOEVEELHEDEN om te rekenen
--                          (weergave, totale hoeveelheid, schalen)
--   net_unit_quantity  = NETTO bruikbaar per stuk (1 avocado = 130 gram)
--                        → gebruikt als KOSTPRIJSBASIS
--
-- Voorbeeld (precies de casus uit de opdracht):
--   1 avocado kost € 1,20, weegt 180 g bruto, 130 g bruikbaar.
--   - zonder netto:  75 g kost 75/180 × € 1,20 = € 0,5000
--   - met netto 130: 75 g kost 75/130 × € 1,20 = € 0,6923
--     (oftewel € 1,20 / 130 g = € 0,009231 per bruikbare gram)
--
-- Netto leeg => netto = bruto, dus het gedrag van vóór deze migratie
-- blijft exact gelijk voor elk bestaand product.
--
-- DUBBELTELLING: netto 130 van 180 ís al 27,8% verlies. Daarom wordt
-- het verliespercentage van het PRODUCT (default_loss_percentage)
-- genegeerd zodra er een netto is ingesteld — anders zou hetzelfde
-- verlies twee keer meetellen. Een verliespercentage op de RECEPTREGEL
-- zelf blijft wel gelden: dat is bewust extra verlies voor dat ene
-- recept, bovenop de normale schoonmaakderving.

alter table public.products
  add column if not exists net_unit_quantity numeric(12,4)
  check (net_unit_quantity is null or net_unit_quantity > 0);

comment on column public.products.net_unit_quantity is
  'Netto bruikbaar per stuk, in dezelfde eenheid als avg_unit_id (bv. 130 bij "1 avocado = 180 g bruto, 130 g bruikbaar"). Leeg = gelijk aan bruto. Vormt de kostprijsbasis; vervangt dan het verliespercentage van het product om dubbeltelling te voorkomen.';

-- Netto zonder bruto is zinloos, en netto mag nooit groter zijn dan bruto.
create or replace function public.check_net_unit_quantity()
returns trigger
language plpgsql
as $$
begin
  if new.net_unit_quantity is not null then
    if new.avg_unit_quantity is null then
      raise exception 'Netto bruikbaar gewicht/inhoud kan alleen worden ingesteld als ook het bruto gewicht/inhoud per stuk is ingevuld.';
    end if;
    if new.net_unit_quantity > new.avg_unit_quantity then
      raise exception 'Netto bruikbaar (%) kan niet groter zijn dan bruto (%) per stuk.',
        new.net_unit_quantity, new.avg_unit_quantity;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_check_net_unit on public.products;
create trigger trg_products_check_net_unit
  before insert or update of net_unit_quantity, avg_unit_quantity on public.products
  for each row execute function public.check_net_unit_quantity();

-- ---------------------------------------------------------------------
-- convert_quantity krijgt een extra parameter: p_for_cost.
-- false (standaard) → bruto, voor hoeveelheden.
-- true              → netto, voor kostprijs.
-- Oude aanroepen met 4 argumenten blijven werken via de default.
-- ---------------------------------------------------------------------
drop function if exists public.convert_quantity(uuid, numeric, uuid, uuid);

create function public.convert_quantity(
  p_product_id uuid,
  p_quantity numeric,
  p_from_unit_id uuid,
  p_to_unit_id uuid,
  p_for_cost boolean default false
)
returns numeric
language plpgsql
stable
as $$
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

  if v_from.dimension = v_to.dimension then
    if coalesce(v_to.factor_to_base, 0) = 0 then return null; end if;
    return p_quantity * v_from.factor_to_base / v_to.factor_to_base;
  end if;

  if (v_from.dimension = 'aantal') = (v_to.dimension = 'aantal') then
    return null;
  end if;
  if p_product_id is null then
    return null;
  end if;

  select avg_unit_quantity, net_unit_quantity, avg_unit_id
  into v_avg_qty, v_net_qty, v_avg_unit_id
  from public.products where id = p_product_id;

  -- Kostprijs rekent met netto bruikbaar; hoeveelheden met bruto.
  v_bridge_qty := case when p_for_cost then coalesce(v_net_qty, v_avg_qty) else v_avg_qty end;
  if v_bridge_qty is null or v_bridge_qty <= 0 or v_avg_unit_id is null then
    return null;
  end if;

  select dimension, factor_to_base into v_avg from public.units where id = v_avg_unit_id;
  if v_avg is null or v_avg.dimension = 'aantal' then
    return null;
  end if;

  if v_from.dimension = 'aantal' then
    if v_avg.dimension <> v_to.dimension or coalesce(v_to.factor_to_base, 0) = 0 then
      return null;
    end if;
    return p_quantity * v_bridge_qty * v_avg.factor_to_base / v_to.factor_to_base;
  else
    if v_avg.dimension <> v_from.dimension or coalesce(v_avg.factor_to_base, 0) = 0 then
      return null;
    end if;
    return (p_quantity * v_from.factor_to_base / v_avg.factor_to_base) / v_bridge_qty;
  end if;
end;
$$;

comment on function public.convert_quantity(uuid, numeric, uuid, uuid, boolean) is
  'Centrale eenheidsconversie. Zelfde dimensie via factor_to_base; aantal <-> gewicht/inhoud via de brug van het product. p_for_cost = true rekent met netto bruikbaar (net_unit_quantity), anders met bruto (avg_unit_quantity). NULL als omrekenen niet kan. TS-tegenhanger: src/lib/units/convert.ts.';

-- Of het verliespercentage van het product nog meetelt: niet als netto
-- is ingesteld (dat verlies zit dan al in de netto-hoeveelheid).
create or replace function public.product_effective_loss_pct(
  p_product_id uuid,
  p_line_loss_pct numeric
)
returns numeric
language plpgsql
stable
as $$
declare
  v_net numeric;
  v_default numeric;
begin
  if p_line_loss_pct is not null then
    return p_line_loss_pct;
  end if;
  select net_unit_quantity, default_loss_percentage
  into v_net, v_default
  from public.products where id = p_product_id;
  if v_net is not null then
    return 0; -- verlies zit al in netto bruikbaar
  end if;
  return coalesce(v_default, 0);
end;
$$;

comment on function public.product_effective_loss_pct(uuid, numeric) is
  'Verliespercentage voor een receptregel. Een expliciet percentage op de regel wint altijd. Anders: 0 als het product netto bruikbaar heeft (dubbeltelling voorkomen), anders het standaard verliespercentage van het product.';

-- ---------------------------------------------------------------------
-- Kostprijsfuncties: rekenen voortaan met p_for_cost = true.
-- ---------------------------------------------------------------------
create or replace function public.calculate_recipe_cost(
  p_recipe_id uuid,
  p_company_id uuid,
  p_depth integer default 0
)
returns numeric
language plpgsql
stable
as $$
declare
  v_total numeric := 0;
  v_line record;
  v_product_base_unit_id uuid;
  v_price_per_base numeric;
  v_loss_pct numeric;
  v_qty_in_base numeric;
  v_sub_yield numeric;
  v_sub_base_unit_id uuid;
  v_sub_cost numeric;
  v_waste_pct numeric;
  v_margin_free numeric;
begin
  if p_depth > 15 then
    raise exception 'Kostprijsberekening afgebroken: te diepe halfproduct-nesting.';
  end if;

  select coalesce(waste_percentage, 0), coalesce(margin_free_costs, 0)
  into v_waste_pct, v_margin_free
  from public.recipes where id = p_recipe_id;

  for v_line in
    select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id, ri.loss_percentage
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
  loop
    if v_line.product_id is not null then
      select p.base_unit_id into v_product_base_unit_id
      from public.products p where p.id = v_line.product_id;

      select cpc.price_per_base_unit into v_price_per_base
      from public.current_product_cost cpc
      where cpc.product_id = v_line.product_id and cpc.company_id = p_company_id;

      v_loss_pct := public.product_effective_loss_pct(v_line.product_id, v_line.loss_percentage);
      v_qty_in_base := public.convert_quantity(
        v_line.product_id, v_line.quantity, v_line.unit_id, v_product_base_unit_id, true
      );

      if v_price_per_base is not null and v_qty_in_base is not null then
        v_total := v_total + v_qty_in_base * v_price_per_base * (1 + v_loss_pct / 100.0);
      end if;

    elsif v_line.sub_recipe_id is not null then
      select r.yield_quantity, r.base_unit_id
      into v_sub_yield, v_sub_base_unit_id
      from public.recipes r where r.id = v_line.sub_recipe_id;

      v_sub_cost := public.calculate_recipe_cost(v_line.sub_recipe_id, p_company_id, p_depth + 1);
      if v_sub_cost is null or v_sub_yield is null or v_sub_yield <= 0 then
        continue;
      end if;
      v_qty_in_base := public.convert_quantity(null, v_line.quantity, v_line.unit_id, v_sub_base_unit_id);
      if v_qty_in_base is null then
        continue;
      end if;
      v_total := v_total + v_sub_cost * (v_qty_in_base / v_sub_yield);
    end if;
  end loop;

  v_total := v_total * (1 + v_waste_pct / 100.0) + v_margin_free;
  return round(v_total, 4);
end;
$$;

create or replace function public.calculate_recipe_cost_override(
  p_recipe_id uuid,
  p_company_id uuid,
  p_override_product_id uuid,
  p_override_price_per_base_unit numeric,
  p_depth integer default 0
)
returns numeric
language plpgsql
stable
as $$
declare
  v_total numeric := 0;
  v_line record;
  v_product_base_unit_id uuid;
  v_price_per_base numeric;
  v_loss_pct numeric;
  v_qty_in_base numeric;
  v_sub_yield numeric;
  v_sub_base_unit_id uuid;
  v_sub_cost numeric;
  v_waste_pct numeric;
  v_margin_free numeric;
begin
  if p_depth > 15 then
    raise exception 'Kostprijsberekening afgebroken: te diepe halfproduct-nesting.';
  end if;

  select coalesce(waste_percentage, 0), coalesce(margin_free_costs, 0)
  into v_waste_pct, v_margin_free
  from public.recipes where id = p_recipe_id;

  for v_line in
    select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id, ri.loss_percentage
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
  loop
    if v_line.product_id is not null then
      select p.base_unit_id into v_product_base_unit_id
      from public.products p where p.id = v_line.product_id;

      if v_line.product_id = p_override_product_id then
        v_price_per_base := p_override_price_per_base_unit;
      else
        select cpc.price_per_base_unit into v_price_per_base
        from public.current_product_cost cpc
        where cpc.product_id = v_line.product_id and cpc.company_id = p_company_id;
      end if;

      v_loss_pct := public.product_effective_loss_pct(v_line.product_id, v_line.loss_percentage);
      v_qty_in_base := public.convert_quantity(
        v_line.product_id, v_line.quantity, v_line.unit_id, v_product_base_unit_id, true
      );
      if v_price_per_base is not null and v_qty_in_base is not null then
        v_total := v_total + v_qty_in_base * v_price_per_base * (1 + v_loss_pct / 100.0);
      end if;

    elsif v_line.sub_recipe_id is not null then
      select r.yield_quantity, r.base_unit_id
      into v_sub_yield, v_sub_base_unit_id
      from public.recipes r where r.id = v_line.sub_recipe_id;

      v_sub_cost := public.calculate_recipe_cost_override(
        v_line.sub_recipe_id, p_company_id, p_override_product_id,
        p_override_price_per_base_unit, p_depth + 1
      );
      if v_sub_cost is null or v_sub_yield is null or v_sub_yield <= 0 then
        continue;
      end if;
      v_qty_in_base := public.convert_quantity(null, v_line.quantity, v_line.unit_id, v_sub_base_unit_id);
      if v_qty_in_base is null then
        continue;
      end if;
      v_total := v_total + v_sub_cost * (v_qty_in_base / v_sub_yield);
    end if;
  end loop;

  v_total := v_total * (1 + v_waste_pct / 100.0) + v_margin_free;
  return round(v_total, 4);
end;
$$;

create or replace function public.calculate_recipe_cost_asof(
  p_recipe_id uuid,
  p_company_id uuid,
  p_asof_date date,
  p_depth integer default 0
)
returns numeric
language plpgsql
stable
as $$
declare
  v_total numeric := 0;
  v_line record;
  v_product_base_unit_id uuid;
  v_price_per_base numeric;
  v_loss_pct numeric;
  v_qty_in_base numeric;
  v_sub_yield numeric;
  v_sub_base_unit_id uuid;
  v_sub_cost numeric;
  v_waste_pct numeric;
  v_margin_free numeric;
begin
  if p_depth > 15 then
    raise exception 'Kostprijsberekening afgebroken: te diepe halfproduct-nesting.';
  end if;

  select coalesce(waste_percentage, 0), coalesce(margin_free_costs, 0)
  into v_waste_pct, v_margin_free
  from public.recipes where id = p_recipe_id;

  for v_line in
    select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id, ri.loss_percentage
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
  loop
    if v_line.product_id is not null then
      select p.base_unit_id into v_product_base_unit_id
      from public.products p where p.id = v_line.product_id;

      select sp.price_per_base_unit into v_price_per_base
      from public.supplier_products sp
      where sp.product_id = v_line.product_id
        and (sp.company_id is null or sp.company_id = p_company_id)
        and sp.valid_from <= p_asof_date
        and (sp.valid_to is null or sp.valid_to >= p_asof_date)
      order by sp.company_id nulls last, sp.is_contract_price desc, sp.valid_from desc
      limit 1;

      v_loss_pct := public.product_effective_loss_pct(v_line.product_id, v_line.loss_percentage);
      v_qty_in_base := public.convert_quantity(
        v_line.product_id, v_line.quantity, v_line.unit_id, v_product_base_unit_id, true
      );
      if v_price_per_base is not null and v_qty_in_base is not null then
        v_total := v_total + v_qty_in_base * v_price_per_base * (1 + v_loss_pct / 100.0);
      end if;

    elsif v_line.sub_recipe_id is not null then
      select r.yield_quantity, r.base_unit_id
      into v_sub_yield, v_sub_base_unit_id
      from public.recipes r where r.id = v_line.sub_recipe_id;

      v_sub_cost := public.calculate_recipe_cost_asof(v_line.sub_recipe_id, p_company_id, p_asof_date, p_depth + 1);
      if v_sub_cost is null or v_sub_yield is null or v_sub_yield <= 0 then
        continue;
      end if;
      v_qty_in_base := public.convert_quantity(null, v_line.quantity, v_line.unit_id, v_sub_base_unit_id);
      if v_qty_in_base is null then
        continue;
      end if;
      v_total := v_total + v_sub_cost * (v_qty_in_base / v_sub_yield);
    end if;
  end loop;

  v_total := v_total * (1 + v_waste_pct / 100.0) + v_margin_free;
  return round(v_total, 4);
end;
$$;

-- Breakdown: toont nu ook welke conversiefactor is gebruikt.
drop function if exists public.get_recipe_cost_breakdown(uuid, uuid);

create function public.get_recipe_cost_breakdown(
  p_recipe_id uuid,
  p_company_id uuid
)
returns table (
  sort_order integer,
  ingredient_name text,
  quantity numeric,
  unit_name text,
  line_cost numeric,
  quantity_in_recipe_unit numeric,
  conversion_missing boolean,
  product_id uuid,
  conversion_note text,
  applied_loss_pct numeric
)
language plpgsql
stable
as $$
declare
  v_line record;
  v_product_base_unit_id uuid;
  v_price_per_base numeric;
  v_qty_in_base numeric;
  v_sub_yield numeric;
  v_sub_base_unit_id uuid;
  v_sub_cost numeric;
  v_name text;
  v_unit_name text;
  v_cost numeric;
  v_recipe_base_unit_id uuid;
  v_qty_in_recipe_unit numeric;
  v_missing boolean;
  v_note text;
  v_loss numeric;
  v_avg numeric;
  v_net numeric;
  v_avg_unit_name text;
  v_line_dim public.unit_dimension;
  v_base_dim public.unit_dimension;
begin
  select base_unit_id into v_recipe_base_unit_id from public.recipes where id = p_recipe_id;

  for v_line in
    select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id, ri.loss_percentage, ri.sort_order
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
    order by ri.sort_order
  loop
    v_cost := null; v_missing := false; v_note := null; v_loss := 0;
    select u.name into v_unit_name from public.units u where u.id = v_line.unit_id;

    v_qty_in_recipe_unit := public.convert_quantity(
      v_line.product_id, v_line.quantity, v_line.unit_id, v_recipe_base_unit_id
    );

    if v_line.product_id is not null then
      select coalesce(nullif(p.custom_name, ''), p.name), p.base_unit_id,
             p.avg_unit_quantity, p.net_unit_quantity
      into v_name, v_product_base_unit_id, v_avg, v_net
      from public.products p where p.id = v_line.product_id;

      select cpc.price_per_base_unit into v_price_per_base
      from public.current_product_cost cpc
      where cpc.product_id = v_line.product_id and cpc.company_id = p_company_id;

      v_loss := public.product_effective_loss_pct(v_line.product_id, v_line.loss_percentage);
      v_qty_in_base := public.convert_quantity(
        v_line.product_id, v_line.quantity, v_line.unit_id, v_product_base_unit_id, true
      );

      -- Is er een dimensiewissel (stuk <-> gewicht/inhoud)? Dan melden
      -- welke factor de kostprijs heeft bepaald.
      select dimension into v_line_dim from public.units where id = v_line.unit_id;
      select dimension into v_base_dim from public.units where id = v_product_base_unit_id;
      if v_avg is not null and v_line_dim is distinct from v_base_dim then
        select name into v_avg_unit_name from public.units u
        join public.products p on p.avg_unit_id = u.id where p.id = v_line.product_id;
        if v_net is not null then
          v_note := format('1 stuk = %s %s bruikbaar (van %s %s bruto)',
                           trim(to_char(v_net, 'FM999999999.####')), v_avg_unit_name,
                           trim(to_char(v_avg, 'FM999999999.####')), v_avg_unit_name);
        else
          v_note := format('1 stuk = %s %s',
                           trim(to_char(v_avg, 'FM999999999.####')), v_avg_unit_name);
        end if;
      end if;

      if v_qty_in_base is null then
        v_missing := true;
      elsif v_price_per_base is not null then
        v_cost := v_qty_in_base * v_price_per_base * (1 + v_loss / 100.0);
      end if;

    elsif v_line.sub_recipe_id is not null then
      select r.name, r.yield_quantity, r.base_unit_id
      into v_name, v_sub_yield, v_sub_base_unit_id
      from public.recipes r where r.id = v_line.sub_recipe_id;

      v_sub_cost := public.calculate_recipe_cost(v_line.sub_recipe_id, p_company_id);
      v_qty_in_base := public.convert_quantity(null, v_line.quantity, v_line.unit_id, v_sub_base_unit_id);
      if v_qty_in_base is null then
        v_missing := true;
      elsif v_sub_cost is not null and v_sub_yield is not null and v_sub_yield > 0 then
        v_cost := v_sub_cost * (v_qty_in_base / v_sub_yield);
      end if;
    end if;

    if v_qty_in_recipe_unit is null and v_recipe_base_unit_id is not null then
      v_missing := true;
    end if;

    return query select
      v_line.sort_order, v_name, v_line.quantity, v_unit_name, v_cost,
      v_qty_in_recipe_unit, v_missing, v_line.product_id, v_note, v_loss;
  end loop;
end;
$$;

comment on function public.get_recipe_cost_breakdown(uuid, uuid) is
  'Kostprijs per receptregel. Rekent via convert_quantity met netto bruikbaar (p_for_cost). conversion_note vertelt welke conversiefactor de kostprijs bepaalde; applied_loss_pct welk verliespercentage is toegepast.';

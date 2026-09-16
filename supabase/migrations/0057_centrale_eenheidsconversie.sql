-- 0057_centrale_eenheidsconversie.sql
--
-- Eén centrale conversieregel voor het hele platform, plus de vier
-- kostprijsfuncties die 'm gebruiken.
--
-- Probleem tot nu toe: overal waar een receptregel of verpakking in een
-- ANDERE dimensie stond dan de basiseenheid van het product (bv. "2 stuk
-- komkommer" bij basiseenheid gram), werd de regel stilzwijgend
-- overgeslagen in de kostprijs en niet meegeteld in de totale
-- hoeveelheid. Sinds 0056 kan een product een brug hebben
-- ("1 stuk = 95 gram"), maar alleen de bulkimport gebruikte die.
--
-- Vanaf nu:
-- 1. public.convert_quantity(...) is de enige plek waar omgerekend wordt:
--    zelfde dimensie → factor-verhouding; aantal ↔ gewicht/inhoud → via de
--    brug van het product; anders NULL (bewust — nooit 0 of 1).
-- 2. calculate_recipe_cost / _override / _asof en get_recipe_cost_breakdown
--    rekenen via die functie. Een regel wordt alleen nog overgeslagen als
--    convert_quantity NULL geeft, en get_recipe_cost_breakdown meldt dat
--    expliciet met conversion_missing = true zodat de UI het kan tonen.
--
-- Zonder brug blijft alles exact zoals voorheen — geen enkele bestaande
-- kostprijs verandert door deze migratie tenzij een brug is ingesteld.

-- ---------------------------------------------------------------------
-- 1. Centrale conversiefunctie
-- ---------------------------------------------------------------------
create or replace function public.convert_quantity(
  p_product_id uuid,
  p_quantity numeric,
  p_from_unit_id uuid,
  p_to_unit_id uuid
)
returns numeric
language plpgsql
stable
as $$
declare
  v_from record;
  v_to record;
  v_avg record;
  v_avg_qty numeric;
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

  -- Zelfde dimensie: gewone factor-verhouding.
  if v_from.dimension = v_to.dimension then
    if coalesce(v_to.factor_to_base, 0) = 0 then return null; end if;
    return p_quantity * v_from.factor_to_base / v_to.factor_to_base;
  end if;

  -- Alleen aantal ↔ gewicht/inhoud is overbrugbaar; gewicht ↔ inhoud niet.
  if (v_from.dimension = 'aantal') = (v_to.dimension = 'aantal') then
    return null;
  end if;

  if p_product_id is null then
    return null;
  end if;
  select avg_unit_quantity, avg_unit_id into v_avg_qty, v_avg_unit_id
  from public.products where id = p_product_id;
  if v_avg_qty is null or v_avg_qty <= 0 or v_avg_unit_id is null then
    return null;
  end if;
  select dimension, factor_to_base into v_avg from public.units where id = v_avg_unit_id;
  if v_avg is null or v_avg.dimension = 'aantal' then
    return null;
  end if;

  if v_from.dimension = 'aantal' then
    -- stuks → gewicht/inhoud
    if v_avg.dimension <> v_to.dimension or coalesce(v_to.factor_to_base, 0) = 0 then
      return null;
    end if;
    return p_quantity * v_avg_qty * v_avg.factor_to_base / v_to.factor_to_base;
  else
    -- gewicht/inhoud → stuks
    if v_avg.dimension <> v_from.dimension or coalesce(v_avg.factor_to_base, 0) = 0 then
      return null;
    end if;
    return (p_quantity * v_from.factor_to_base / v_avg.factor_to_base) / v_avg_qty;
  end if;
end;
$$;

comment on function public.convert_quantity(uuid, numeric, uuid, uuid) is
  'Centrale eenheidsconversie. Zelfde dimensie via factor_to_base; aantal ↔ gewicht/inhoud via de brug (avg_unit_quantity/avg_unit_id) van het product; anders NULL. TS-tegenhanger: src/lib/units/convert.ts — beide moeten identiek blijven.';

-- ---------------------------------------------------------------------
-- 2. Kostprijsfuncties via convert_quantity
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
    raise exception 'Kostprijsberekening afgebroken: te diepe halfproduct-nesting (mogelijk een gemiste circulaire referentie).';
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
      select p.base_unit_id, p.default_loss_percentage
      into v_product_base_unit_id, v_loss_pct
      from public.products p where p.id = v_line.product_id;

      select cpc.price_per_base_unit into v_price_per_base
      from public.current_product_cost cpc
      where cpc.product_id = v_line.product_id and cpc.company_id = p_company_id;

      v_loss_pct := coalesce(v_line.loss_percentage, v_loss_pct, 0);

      v_qty_in_base := public.convert_quantity(
        v_line.product_id, v_line.quantity, v_line.unit_id, v_product_base_unit_id
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

      -- Subrecepten hebben geen stuk-brug; alleen zelfde-dimensie telt.
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
      select p.base_unit_id, p.default_loss_percentage
      into v_product_base_unit_id, v_loss_pct
      from public.products p where p.id = v_line.product_id;

      if v_line.product_id = p_override_product_id then
        v_price_per_base := p_override_price_per_base_unit;
      else
        select cpc.price_per_base_unit into v_price_per_base
        from public.current_product_cost cpc
        where cpc.product_id = v_line.product_id and cpc.company_id = p_company_id;
      end if;

      v_loss_pct := coalesce(v_line.loss_percentage, v_loss_pct, 0);
      v_qty_in_base := public.convert_quantity(
        v_line.product_id, v_line.quantity, v_line.unit_id, v_product_base_unit_id
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
      select p.base_unit_id, p.default_loss_percentage
      into v_product_base_unit_id, v_loss_pct
      from public.products p where p.id = v_line.product_id;

      select sp.price_per_base_unit into v_price_per_base
      from public.supplier_products sp
      where sp.product_id = v_line.product_id
        and (sp.company_id is null or sp.company_id = p_company_id)
        and sp.valid_from <= p_asof_date
        and (sp.valid_to is null or sp.valid_to >= p_asof_date)
      order by sp.company_id nulls last, sp.is_contract_price desc, sp.valid_from desc
      limit 1;

      v_loss_pct := coalesce(v_line.loss_percentage, v_loss_pct, 0);
      v_qty_in_base := public.convert_quantity(
        v_line.product_id, v_line.quantity, v_line.unit_id, v_product_base_unit_id
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

-- Returntype krijgt twee kolommen extra → drop + create.
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
  product_id uuid
)
language plpgsql
stable
as $$
declare
  v_line record;
  v_product_base_unit_id uuid;
  v_loss_pct numeric;
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
begin
  select base_unit_id into v_recipe_base_unit_id from public.recipes where id = p_recipe_id;

  for v_line in
    select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id, ri.loss_percentage, ri.sort_order
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
    order by ri.sort_order
  loop
    v_cost := null;
    v_missing := false;
    select u.name into v_unit_name from public.units u where u.id = v_line.unit_id;

    -- Hoeveelheid omgerekend naar de basiseenheid van het RECEPT (voor de
    -- "totale hoeveelheid") — bij een product via de brug van dat product.
    v_qty_in_recipe_unit := public.convert_quantity(
      v_line.product_id, v_line.quantity, v_line.unit_id, v_recipe_base_unit_id
    );

    if v_line.product_id is not null then
      select coalesce(nullif(p.custom_name, ''), p.name), p.base_unit_id, p.default_loss_percentage
      into v_name, v_product_base_unit_id, v_loss_pct
      from public.products p where p.id = v_line.product_id;

      select cpc.price_per_base_unit into v_price_per_base
      from public.current_product_cost cpc
      where cpc.product_id = v_line.product_id and cpc.company_id = p_company_id;

      v_loss_pct := coalesce(v_line.loss_percentage, v_loss_pct, 0);
      v_qty_in_base := public.convert_quantity(
        v_line.product_id, v_line.quantity, v_line.unit_id, v_product_base_unit_id
      );
      if v_qty_in_base is null then
        v_missing := true;
      elsif v_price_per_base is not null then
        v_cost := v_qty_in_base * v_price_per_base * (1 + v_loss_pct / 100.0);
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

    -- Ook "niet in de receptbasiseenheid uit te drukken" telt als ontbrekende conversie.
    if v_qty_in_recipe_unit is null and v_recipe_base_unit_id is not null then
      v_missing := true;
    end if;

    return query select
      v_line.sort_order, v_name, v_line.quantity, v_unit_name, v_cost,
      v_qty_in_recipe_unit, v_missing, v_line.product_id;
  end loop;
end;
$$;

comment on function public.get_recipe_cost_breakdown(uuid, uuid) is
  'Kostprijs per receptregel. Rekent via public.convert_quantity (incl. stuk-brug). conversion_missing = true als de regel niet naar de basiseenheid van product of recept om te rekenen is — de UI toont dan een waarschuwing i.p.v. de regel stil weg te laten.';

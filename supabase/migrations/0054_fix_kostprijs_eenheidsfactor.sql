-- 0054_fix_kostprijs_eenheidsfactor.sql
--
-- BELANGRIJKE BUGFIX — kostprijs werd tot 1000x te hoog berekend voor
-- elk ingrediënt waarvan de BASISEENHEID van het product zelf kilogram
-- of liter is (in plaats van gram/milliliter/stuk).
--
-- Voorbeeld uit de praktijk: "Aardappel la ratte" heeft basiseenheid
-- kilogram, prijs € 4,95/kg. Een receptregel van 10 kilogram hoort dan
-- € 49,50 te kosten. De kostprijsfuncties rekenden € 49.500,00 — een
-- factor 1000 te veel, exact de factor_to_base van kilogram.
--
-- Oorzaak: bij het omrekenen van de receptregel-eenheid naar de
-- basiseenheid van het product werd alleen de factor_to_base van de
-- receptregel-eenheid gebruikt (bv. kilogram → 1000), zonder die te
-- delen door de factor_to_base van de basiseenheid van het product
-- zelf. Dat klopte toevallig alleen wanneer een product zijn
-- basiseenheid op gram, milliliter of stuk had staan (factor 1) — de
-- meerderheid van de producten, wat verklaart waarom dit zo lang
-- onopgemerkt is gebleven.
--
-- Juiste formule (en al zo gebruikt in de front-end, recipe-form.tsx):
--   conversiefactor = factor_to_base(receptregel-eenheid)
--                      / factor_to_base(basiseenheid van het product)
--
-- Dit raakt vier functies, die hier stuk voor stuk opnieuw gedefinieerd
-- worden met de correctie. Signatuur en gedrag blijven verder gelijk.

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
  v_line_cost numeric;
  v_product_base_unit_id uuid;
  v_ingredient_factor numeric;
  v_line_unit_factor numeric;
  v_target_unit_factor numeric;
  v_ingredient_dimension public.unit_dimension;
  v_target_dimension public.unit_dimension;
  v_price_per_base numeric;
  v_loss_pct numeric;
  v_sub_yield numeric;
  v_sub_base_unit_id uuid;
  v_sub_cost numeric;
  v_converted_qty numeric;
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

      v_ingredient_factor := null;
      if v_line.unit_id is not null and v_product_base_unit_id is not null then
        select u1.factor_to_base, u1.dimension, u2.factor_to_base, u2.dimension
        into v_line_unit_factor, v_ingredient_dimension, v_target_unit_factor, v_target_dimension
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_product_base_unit_id;

        if v_ingredient_dimension is not distinct from v_target_dimension
           and v_target_unit_factor is not null and v_target_unit_factor <> 0 then
          -- Fix: delen door de factor van de basiseenheid van het product
          -- (was voorheen alleen v_line_unit_factor, vandaar de bug).
          v_ingredient_factor := v_line_unit_factor / v_target_unit_factor;
        else
          v_ingredient_factor := null;
        end if;
      end if;

      if v_price_per_base is not null and v_ingredient_factor is not null then
        v_line_cost := v_line.quantity * v_ingredient_factor * v_price_per_base
                        * (1 + v_loss_pct / 100.0);
        v_total := v_total + v_line_cost;
      end if;

    elsif v_line.sub_recipe_id is not null then
      select r.yield_quantity, r.base_unit_id
      into v_sub_yield, v_sub_base_unit_id
      from public.recipes r where r.id = v_line.sub_recipe_id;

      v_sub_cost := public.calculate_recipe_cost(
        v_line.sub_recipe_id, p_company_id, p_depth + 1
      );

      if v_sub_cost is null or v_sub_yield is null or v_sub_yield <= 0 then
        continue;
      end if;

      if v_sub_base_unit_id is not null and v_line.unit_id is not null then
        v_ingredient_factor := null;
        select u1.factor_to_base, u1.dimension, u2.factor_to_base, u2.dimension
        into v_line_unit_factor, v_ingredient_dimension, v_target_unit_factor, v_target_dimension
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_sub_base_unit_id;

        if v_ingredient_dimension is distinct from v_target_dimension
           or v_target_unit_factor is null or v_target_unit_factor = 0 then
          continue;
        end if;

        v_converted_qty := v_line.quantity * (v_line_unit_factor / v_target_unit_factor);
        v_total := v_total + v_sub_cost * (v_converted_qty / v_sub_yield);
      else
        v_total := v_total + v_sub_cost * (v_line.quantity / v_sub_yield);
      end if;
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
  v_line_cost numeric;
  v_product_base_unit_id uuid;
  v_ingredient_factor numeric;
  v_line_unit_factor numeric;
  v_target_unit_factor numeric;
  v_ingredient_dimension public.unit_dimension;
  v_target_dimension public.unit_dimension;
  v_price_per_base numeric;
  v_loss_pct numeric;
  v_sub_yield numeric;
  v_sub_base_unit_id uuid;
  v_sub_cost numeric;
  v_converted_qty numeric;
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

      v_ingredient_factor := null;
      if v_line.unit_id is not null and v_product_base_unit_id is not null then
        select u1.factor_to_base, u1.dimension, u2.factor_to_base, u2.dimension
        into v_line_unit_factor, v_ingredient_dimension, v_target_unit_factor, v_target_dimension
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_product_base_unit_id;

        if v_ingredient_dimension is not distinct from v_target_dimension
           and v_target_unit_factor is not null and v_target_unit_factor <> 0 then
          v_ingredient_factor := v_line_unit_factor / v_target_unit_factor;
        else
          v_ingredient_factor := null;
        end if;
      end if;

      if v_price_per_base is not null and v_ingredient_factor is not null then
        v_line_cost := v_line.quantity * v_ingredient_factor * v_price_per_base
                        * (1 + v_loss_pct / 100.0);
        v_total := v_total + v_line_cost;
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

      if v_sub_base_unit_id is not null and v_line.unit_id is not null then
        v_ingredient_factor := null;
        select u1.factor_to_base, u1.dimension, u2.factor_to_base, u2.dimension
        into v_line_unit_factor, v_ingredient_dimension, v_target_unit_factor, v_target_dimension
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_sub_base_unit_id;

        if v_ingredient_dimension is distinct from v_target_dimension
           or v_target_unit_factor is null or v_target_unit_factor = 0 then
          continue;
        end if;

        v_converted_qty := v_line.quantity * (v_line_unit_factor / v_target_unit_factor);
        v_total := v_total + v_sub_cost * (v_converted_qty / v_sub_yield);
      else
        v_total := v_total + v_sub_cost * (v_line.quantity / v_sub_yield);
      end if;
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
  v_line_cost numeric;
  v_product_base_unit_id uuid;
  v_ingredient_factor numeric;
  v_line_unit_factor numeric;
  v_target_unit_factor numeric;
  v_ingredient_dimension public.unit_dimension;
  v_target_dimension public.unit_dimension;
  v_price_per_base numeric;
  v_loss_pct numeric;
  v_sub_yield numeric;
  v_sub_base_unit_id uuid;
  v_sub_cost numeric;
  v_converted_qty numeric;
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

      select sp.price_per_base_unit
      into v_price_per_base
      from public.supplier_products sp
      where sp.product_id = v_line.product_id
        and (sp.company_id is null or sp.company_id = p_company_id)
        and sp.valid_from <= p_asof_date
        and (sp.valid_to is null or sp.valid_to >= p_asof_date)
      order by
        sp.company_id nulls last,
        sp.is_contract_price desc,
        sp.valid_from desc
      limit 1;

      v_loss_pct := coalesce(v_line.loss_percentage, v_loss_pct, 0);

      v_ingredient_factor := null;
      if v_line.unit_id is not null and v_product_base_unit_id is not null then
        select u1.factor_to_base, u1.dimension, u2.factor_to_base, u2.dimension
        into v_line_unit_factor, v_ingredient_dimension, v_target_unit_factor, v_target_dimension
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_product_base_unit_id;

        if v_ingredient_dimension is not distinct from v_target_dimension
           and v_target_unit_factor is not null and v_target_unit_factor <> 0 then
          v_ingredient_factor := v_line_unit_factor / v_target_unit_factor;
        else
          v_ingredient_factor := null;
        end if;
      end if;

      if v_price_per_base is not null and v_ingredient_factor is not null then
        v_line_cost := v_line.quantity * v_ingredient_factor * v_price_per_base
                        * (1 + v_loss_pct / 100.0);
        v_total := v_total + v_line_cost;
      end if;

    elsif v_line.sub_recipe_id is not null then
      select r.yield_quantity, r.base_unit_id
      into v_sub_yield, v_sub_base_unit_id
      from public.recipes r where r.id = v_line.sub_recipe_id;

      v_sub_cost := public.calculate_recipe_cost_asof(
        v_line.sub_recipe_id, p_company_id, p_asof_date, p_depth + 1
      );

      if v_sub_cost is null or v_sub_yield is null or v_sub_yield <= 0 then
        continue;
      end if;

      if v_sub_base_unit_id is not null and v_line.unit_id is not null then
        v_ingredient_factor := null;
        select u1.factor_to_base, u1.dimension, u2.factor_to_base, u2.dimension
        into v_line_unit_factor, v_ingredient_dimension, v_target_unit_factor, v_target_dimension
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_sub_base_unit_id;

        if v_ingredient_dimension is distinct from v_target_dimension
           or v_target_unit_factor is null or v_target_unit_factor = 0 then
          continue;
        end if;

        v_converted_qty := v_line.quantity * (v_line_unit_factor / v_target_unit_factor);
        v_total := v_total + v_sub_cost * (v_converted_qty / v_sub_yield);
      else
        v_total := v_total + v_sub_cost * (v_line.quantity / v_sub_yield);
      end if;
    end if;
  end loop;

  v_total := v_total * (1 + v_waste_pct / 100.0) + v_margin_free;

  return round(v_total, 4);
end;
$$;

-- Returntype wijzigt niet, maar drop+create voorkomt verwarring met de
-- OUT-parameternamen die in 0044 al eens gewijzigd zijn.
drop function if exists public.get_recipe_cost_breakdown(uuid, uuid);

create or replace function public.get_recipe_cost_breakdown(
  p_recipe_id uuid,
  p_company_id uuid
)
returns table (
  sort_order integer,
  ingredient_name text,
  quantity numeric,
  unit_name text,
  line_cost numeric,
  quantity_in_recipe_unit numeric
)
language plpgsql
stable
as $$
declare
  v_line record;
  v_product_base_unit_id uuid;
  v_loss_pct numeric;
  v_ingredient_factor numeric;
  v_line_unit_factor numeric;
  v_target_unit_factor numeric;
  v_ingredient_dimension public.unit_dimension;
  v_target_dimension public.unit_dimension;
  v_price_per_base numeric;
  v_sub_yield numeric;
  v_sub_base_unit_id uuid;
  v_sub_cost numeric;
  v_converted_qty numeric;
  v_name text;
  v_unit_name text;
  v_cost numeric;
  v_recipe_base_unit_id uuid;
  v_recipe_unit_factor numeric;
  v_recipe_unit_dimension public.unit_dimension;
  v_line_unit_factor_for_recipe numeric;
  v_line_unit_dimension public.unit_dimension;
  v_qty_in_recipe_unit numeric;
begin
  select base_unit_id into v_recipe_base_unit_id
  from public.recipes where id = p_recipe_id;

  if v_recipe_base_unit_id is not null then
    select factor_to_base, dimension into v_recipe_unit_factor, v_recipe_unit_dimension
    from public.units where id = v_recipe_base_unit_id;
  end if;

  for v_line in
    select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id, ri.loss_percentage, ri.sort_order
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
    order by ri.sort_order
  loop
    v_cost := null;
    v_qty_in_recipe_unit := null;
    select u.name into v_unit_name from public.units u where u.id = v_line.unit_id;

    -- Hoeveelheid omgerekend naar de basiseenheid van het RECEPT (voor
    -- de "totale hoeveelheid"-weergave) — deze conversie was al correct
    -- (deelt al door v_recipe_unit_factor), dus ongewijzigd.
    if v_line.unit_id is not null and v_recipe_base_unit_id is not null then
      select factor_to_base, dimension into v_line_unit_factor_for_recipe, v_line_unit_dimension
      from public.units where id = v_line.unit_id;

      if v_line_unit_dimension is not distinct from v_recipe_unit_dimension
         and v_line_unit_factor_for_recipe is not null and v_recipe_unit_factor is not null then
        v_qty_in_recipe_unit := v_line.quantity * v_line_unit_factor_for_recipe / v_recipe_unit_factor;
      end if;
    end if;

    if v_line.product_id is not null then
      select coalesce(nullif(p.custom_name, ''), p.name), p.base_unit_id, p.default_loss_percentage
      into v_name, v_product_base_unit_id, v_loss_pct
      from public.products p where p.id = v_line.product_id;

      select cpc.price_per_base_unit into v_price_per_base
      from public.current_product_cost cpc
      where cpc.product_id = v_line.product_id and cpc.company_id = p_company_id;

      v_loss_pct := coalesce(v_line.loss_percentage, v_loss_pct, 0);

      v_ingredient_factor := null;
      if v_line.unit_id is not null and v_product_base_unit_id is not null then
        select u1.factor_to_base, u1.dimension, u2.factor_to_base, u2.dimension
        into v_line_unit_factor, v_ingredient_dimension, v_target_unit_factor, v_target_dimension
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_product_base_unit_id;

        if v_ingredient_dimension is not distinct from v_target_dimension
           and v_target_unit_factor is not null and v_target_unit_factor <> 0 then
          -- Fix: delen door de factor van de basiseenheid van het
          -- product (was voorheen alleen v_line_unit_factor).
          v_ingredient_factor := v_line_unit_factor / v_target_unit_factor;
        else
          v_ingredient_factor := null;
        end if;
      end if;

      if v_price_per_base is not null and v_ingredient_factor is not null then
        v_cost := v_line.quantity * v_ingredient_factor * v_price_per_base * (1 + v_loss_pct / 100.0);
      end if;

    elsif v_line.sub_recipe_id is not null then
      select r.name, r.yield_quantity, r.base_unit_id
      into v_name, v_sub_yield, v_sub_base_unit_id
      from public.recipes r where r.id = v_line.sub_recipe_id;

      v_sub_cost := public.calculate_recipe_cost(v_line.sub_recipe_id, p_company_id);

      if v_sub_cost is not null and v_sub_yield is not null and v_sub_yield > 0 then
        if v_sub_base_unit_id is not null and v_line.unit_id is not null then
          select u1.factor_to_base, u1.dimension, u2.factor_to_base, u2.dimension
          into v_line_unit_factor, v_ingredient_dimension, v_target_unit_factor, v_target_dimension
          from public.units u1, public.units u2
          where u1.id = v_line.unit_id and u2.id = v_sub_base_unit_id;

          if v_ingredient_dimension is not distinct from v_target_dimension
             and v_target_unit_factor is not null and v_target_unit_factor <> 0 then
            v_converted_qty := v_line.quantity * (v_line_unit_factor / v_target_unit_factor);
            v_cost := v_sub_cost * (v_converted_qty / v_sub_yield);
          end if;
        else
          v_cost := v_sub_cost * (v_line.quantity / v_sub_yield);
        end if;
      end if;
    end if;

    return query select v_line.sort_order, v_name, v_line.quantity, v_unit_name, v_cost, v_qty_in_recipe_unit;
  end loop;
end;
$$;

comment on function public.calculate_recipe_cost(uuid, uuid, integer) is
  'Totale kostprijs van een recept. Gefixt in 0054: de eenheidsconversie deelt nu ook door de factor_to_base van de basiseenheid van het product/subrecept zelf, niet alleen die van de receptregel-eenheid.';
comment on function public.calculate_recipe_cost_override(uuid, uuid, uuid, numeric, integer) is
  'Als calculate_recipe_cost, met simulatie van één afwijkende inkoopprijs. Zelfde eenheidsfix als 0054.';
comment on function public.calculate_recipe_cost_asof(uuid, uuid, date, integer) is
  'Als calculate_recipe_cost, met de prijs die gold op een historische datum. Zelfde eenheidsfix als 0054.';
comment on function public.get_recipe_cost_breakdown(uuid, uuid) is
  'Kostprijs per ingrediëntregel van een recept. Zelfde eenheidsfix als 0054.';

-- 0020_allergenen_voedingswaarden.sql
-- Automatische doorwerking van allergenen en voedingswaarden vanuit
-- producten en halfproducten naar gerechten (spec §12). Volgt dezelfde
-- boomstructuur als calculate_recipe_cost: recursief door
-- recipe_ingredients, met dezelfde recursiebeveiliging.

-- ---------------------------------------------------------------------
-- Allergenen: geeft {"bevat": [...], "sporen": [...]} terug. "sporen"
-- bevat nooit een allergeen dat ook al in "bevat" zit (een allergeen dat
-- ergens met zekerheid aanwezig is, hoeft niet ook als "kan sporen
-- bevatten" vermeld te worden).
-- ---------------------------------------------------------------------
create or replace function public.calculate_recipe_allergens(
  p_recipe_id uuid,
  p_depth integer default 0
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_contains text[] := array[]::text[];
  v_traces text[] := array[]::text[];
  v_line record;
  v_product_allergens text[];
  v_product_traces text[];
  v_sub jsonb;
begin
  if p_depth > 15 then
    return jsonb_build_object('bevat', to_jsonb(v_contains), 'sporen', to_jsonb(v_traces));
  end if;

  for v_line in
    select ri.product_id, ri.sub_recipe_id
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
  loop
    if v_line.product_id is not null then
      select
        coalesce(array(select jsonb_array_elements_text(p.allergens)), array[]::text[]),
        coalesce(array(select jsonb_array_elements_text(p.contains_traces)), array[]::text[])
      into v_product_allergens, v_product_traces
      from public.products p
      where p.id = v_line.product_id;

      v_contains := v_contains || coalesce(v_product_allergens, array[]::text[]);
      v_traces := v_traces || coalesce(v_product_traces, array[]::text[]);

    elsif v_line.sub_recipe_id is not null then
      v_sub := public.calculate_recipe_allergens(v_line.sub_recipe_id, p_depth + 1);
      v_contains := v_contains || coalesce(
        array(select jsonb_array_elements_text(v_sub->'bevat')), array[]::text[]
      );
      v_traces := v_traces || coalesce(
        array(select jsonb_array_elements_text(v_sub->'sporen')), array[]::text[]
      );
    end if;
  end loop;

  return jsonb_build_object(
    'bevat', to_jsonb(array(select distinct unnest(v_contains) order by 1)),
    'sporen', to_jsonb(array(
      select distinct t from unnest(v_traces) as t
      where v_contains is null or t <> all(v_contains)
      order by 1
    ))
  );
end;
$$;

comment on function public.calculate_recipe_allergens(uuid, integer) is
  'Verzamelt alle allergenen (bevat/sporen) van een gerecht/halfproduct via producten en (recursief) halfproducten. Sporen die al als "bevat" gelden worden eruit gefilterd.';

-- ---------------------------------------------------------------------
-- Voedingswaarden: telt nutrition_per_100 van elk product op, geschaald
-- naar de daadwerkelijk gebruikte hoeveelheid (per 100 basiseenheden),
-- en schaalt halfproducten via hun yield_quantity — dezelfde conversie-
-- logica als calculate_recipe_cost.
-- ---------------------------------------------------------------------
create or replace function public.calculate_recipe_nutrition(
  p_recipe_id uuid,
  p_depth integer default 0
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_totals jsonb := '{}'::jsonb;
  v_line record;
  v_product_nutrition jsonb;
  v_product_base_unit_id uuid;
  v_factor numeric;
  v_dim1 public.unit_dimension;
  v_dim2 public.unit_dimension;
  v_converted_qty numeric;
  v_sub_totals jsonb;
  v_sub_yield numeric;
  v_sub_base_unit_id uuid;
  v_key text;
  v_value numeric;
begin
  if p_depth > 15 then
    return v_totals;
  end if;

  for v_line in
    select product_id, sub_recipe_id, quantity, unit_id
    from public.recipe_ingredients
    where recipe_id = p_recipe_id
  loop
    if v_line.product_id is not null then
      select nutrition_per_100, base_unit_id
      into v_product_nutrition, v_product_base_unit_id
      from public.products where id = v_line.product_id;

      if v_product_nutrition is not null and v_line.unit_id is not null and v_product_base_unit_id is not null then
        select u1.factor_to_base / u2.factor_to_base, u1.dimension, u2.dimension
        into v_factor, v_dim1, v_dim2
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_product_base_unit_id;

        if v_dim1 = v_dim2 then
          v_converted_qty := v_line.quantity * v_factor;
          for v_key, v_value in
            select key, value::numeric from jsonb_each_text(v_product_nutrition)
          loop
            v_totals := jsonb_set(
              v_totals, array[v_key],
              to_jsonb(coalesce((v_totals->>v_key)::numeric, 0) + v_value * v_converted_qty / 100.0)
            );
          end loop;
        end if;
      end if;

    elsif v_line.sub_recipe_id is not null then
      select yield_quantity, base_unit_id into v_sub_yield, v_sub_base_unit_id
      from public.recipes where id = v_line.sub_recipe_id;

      v_sub_totals := public.calculate_recipe_nutrition(v_line.sub_recipe_id, p_depth + 1);

      if v_sub_yield is not null and v_sub_yield > 0
         and v_sub_base_unit_id is not null and v_line.unit_id is not null then
        select u1.factor_to_base / u2.factor_to_base, u1.dimension, u2.dimension
        into v_factor, v_dim1, v_dim2
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_sub_base_unit_id;

        if v_dim1 = v_dim2 then
          v_converted_qty := v_line.quantity * v_factor;
          for v_key, v_value in
            select key, value::numeric from jsonb_each_text(v_sub_totals)
          loop
            v_totals := jsonb_set(
              v_totals, array[v_key],
              to_jsonb(coalesce((v_totals->>v_key)::numeric, 0) + v_value * v_converted_qty / v_sub_yield)
            );
          end loop;
        end if;
      end if;
    end if;
  end loop;

  return v_totals;
end;
$$;

comment on function public.calculate_recipe_nutrition(uuid, integer) is
  'Telt voedingswaarden (energie, vet, koolhydraten, ...) op voor een gerecht/halfproduct, geschaald naar gebruikte hoeveelheid, via producten en recursief via halfproducten.';

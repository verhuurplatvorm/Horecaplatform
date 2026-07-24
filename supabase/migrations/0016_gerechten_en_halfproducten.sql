-- 0016_gerechten_en_halfproducten.sql
-- Herinrichting van de receptenmodule op basis van de gebruikersflow
-- "Nieuw gerecht": een gerecht (altijd per één portie) wordt opgebouwd
-- uit ingrediënten (producten) en halfproducten (vooraf bereide
-- producten). Voorheen was er geen formeel onderscheid tussen een
-- "gerecht" en een "subreceptuur" — recipes.category was vrije tekst en
-- er was geen manier om dit betrouwbaar te filteren of te valideren.

create type public.recipe_kind as enum ('gerecht', 'halfproduct');

alter table public.recipes
  add column recipe_kind public.recipe_kind not null default 'gerecht',
  add column base_unit_id uuid references public.units(id);

alter table public.recipe_ingredients
  add column is_optional boolean not null default false;

alter table public.recipes
  add column plating_instructions text;

comment on column public.recipes.plating_instructions is
  'Opmaakinstructies (spec §1).';

comment on column public.recipe_ingredients.is_optional is
  'Of deze receptregel optioneel is binnen het gerecht/halfproduct (spec §4).';

comment on column public.recipes.recipe_kind is
  'Onderscheidt een gerecht (verkoopbaar, altijd per 1 portie) van een halfproduct (vooraf bereid, met een eigen opbrengst en basiseenheid).';
comment on column public.recipes.base_unit_id is
  'Alleen relevant voor halfproducten: de eenheid waarin yield_quantity is uitgedrukt, zodat het halfproduct als ingrediënt elders correct kan worden omgerekend (net als products.base_unit_id).';

-- yield_unit (tekst) blijft bestaan voor weergave, gesynchroniseerd
-- vanuit base_unit_id — zelfde patroon als products.base_unit.
create or replace function public.sync_recipe_base_unit_text()
returns trigger
language plpgsql
as $$
begin
  if new.base_unit_id is not null then
    select key into new.yield_unit from public.units where id = new.base_unit_id;
  end if;
  return new;
end;
$$;

create trigger trg_recipes_sync_base_unit_text
  before insert or update of base_unit_id on public.recipes
  for each row execute function public.sync_recipe_base_unit_text();

-- Gerechten rekenen altijd per 1 portie (spec: "Alle berekeningen moeten
-- uitgaan van één gerecht, dus één portie"). Forceer dit op databaseniveau
-- i.p.v. alleen in de UI, zodat een verkeerde waarde nooit stil de
-- kostprijsberekening verstoort.
create or replace function public.enforce_gerecht_portion_size()
returns trigger
language plpgsql
as $$
begin
  if new.recipe_kind = 'gerecht' then
    new.portion_size := 1;
  end if;
  return new;
end;
$$;

create trigger trg_recipes_enforce_portion_size
  before insert or update on public.recipes
  for each row execute function public.enforce_gerecht_portion_size();

-- ---------------------------------------------------------------------
-- calculate_recipe_cost: subreceptuur/halfproduct-branch herzien. Als het
-- halfproduct een base_unit_id heeft, wordt de receptregel-eenheid daar
-- daadwerkelijk naartoe omgerekend (net als bij producten). Heeft het
-- halfproduct nog geen base_unit_id (bestaande data van vóór deze
-- migratie), dan valt de functie terug op de oude aanname (quantity
-- rechtstreeks vergelijken met yield_quantity) zodat bestaande recepten
-- niet plotseling op nul kostprijs uitkomen.
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
  v_line_cost numeric;
  v_product_base_unit_id uuid;
  v_ingredient_factor numeric;
  v_ingredient_dimension public.unit_dimension;
  v_target_dimension public.unit_dimension;
  v_price_per_base numeric;
  v_loss_pct numeric;
  v_sub_yield numeric;
  v_sub_base_unit_id uuid;
  v_sub_cost numeric;
  v_converted_qty numeric;
begin
  if p_depth > 15 then
    raise exception 'Kostprijsberekening afgebroken: te diepe halfproduct-nesting (mogelijk een gemiste circulaire referentie).';
  end if;

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
        select u1.factor_to_base, u1.dimension, u2.dimension
        into v_ingredient_factor, v_ingredient_dimension, v_target_dimension
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_product_base_unit_id;

        if v_ingredient_dimension is distinct from v_target_dimension then
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
        -- Halfproduct heeft een echte basiseenheid: converteer de
        -- receptregel-eenheid ernaartoe, alleen binnen dezelfde dimensie.
        v_ingredient_factor := null;
        select u1.factor_to_base, u1.dimension, u2.dimension
        into v_ingredient_factor, v_ingredient_dimension, v_target_dimension
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_sub_base_unit_id;

        if v_ingredient_dimension is distinct from v_target_dimension then
          continue; -- incompatibele eenheid, regel telt niet mee
        end if;

        v_converted_qty := v_line.quantity * v_ingredient_factor;
        v_total := v_total + v_sub_cost * (v_converted_qty / v_sub_yield);
      else
        -- Backward compatible fallback voor halfproducten zonder
        -- base_unit_id: oude aanname, quantity direct tegen yield_quantity.
        v_total := v_total + v_sub_cost * (v_line.quantity / v_sub_yield);
      end if;
    end if;
  end loop;

  return round(v_total, 4);
end;
$$;

comment on function public.calculate_recipe_cost(uuid, uuid, integer) is
  'Kostprijs van een gerecht/halfproduct: converteert receptregel-eenheden naar de basiseenheid van elk ingrediënt of halfproduct, past verlies%% toe, en schaalt halfproducten via hun yield_quantity. Valt terug op de oude (niet-converterende) aanname voor halfproducten zonder base_unit_id.';

-- 0013_recept_eenheden_verlies_kostprijs.sql
-- Receptregels rekenden tot nu toe met een vrije-tekst eenheid en zonder
-- verliespercentage, en calculate_recipe_cost deed geen enkele
-- eenheidsconversie (nam quantity 1-op-1 als zijnde in de basiseenheid
-- van het product). Dit maakt dat goed: receptregels krijgen een echte
-- eenheid (units-tabel) en een verliespercentage (spec §7), en de
-- kostprijsfunctie converteert, past verlies toe, schaalt subrecepten via
-- hun opbrengst, en beschermt tegen circulaire subrecepten (spec §21,
-- verplichte test #16).

alter table public.recipe_ingredients
  add column unit_id uuid references public.units(id),
  add column loss_percentage numeric(5,2);

comment on column public.recipe_ingredients.loss_percentage is
  'Verliespercentage voor deze receptregel (spec §7). Overschrijft, indien gezet, products.default_loss_percentage voor deze regel.';

-- unit (tekst) blijft bestaan voor weergave/back-compat, gesynchroniseerd
-- vanuit unit_id — zelfde patroon als products.base_unit.
create or replace function public.sync_recipe_ingredient_unit_text()
returns trigger
language plpgsql
as $$
begin
  if new.unit_id is not null then
    select key into new.unit from public.units where id = new.unit_id;
  end if;
  return new;
end;
$$;

create trigger trg_recipe_ingredients_sync_unit_text
  before insert or update of unit_id on public.recipe_ingredients
  for each row execute function public.sync_recipe_ingredient_unit_text();

-- ---------------------------------------------------------------------
-- Bescherming tegen circulaire subrecepten (spec §21, test #16): vóór
-- het opslaan van een receptregel die een subreceptuur gebruikt, wordt
-- gecontroleerd of het doelrecept ergens in de receptenboom van die
-- subreceptuur voorkomt. Zo ja: de INSERT/UPDATE wordt geweigerd.
-- ---------------------------------------------------------------------
create or replace function public.check_no_circular_subrecipe()
returns trigger
language plpgsql
as $$
declare
  v_found boolean;
begin
  if new.sub_recipe_id is null then
    return new;
  end if;

  if new.sub_recipe_id = new.recipe_id then
    raise exception 'Een receptuur kan zichzelf niet als subreceptuur gebruiken.';
  end if;

  with recursive chain as (
    select new.sub_recipe_id as recipe_id
    union all
    select ri.sub_recipe_id
    from public.recipe_ingredients ri
    join chain c on ri.recipe_id = c.recipe_id
    where ri.sub_recipe_id is not null
  )
  select exists (select 1 from chain where recipe_id = new.recipe_id)
  into v_found;

  if v_found then
    raise exception 'Circulaire subreceptuur gedetecteerd: dit recept komt al voor in de receptenboom van de gekozen subreceptuur.';
  end if;

  return new;
end;
$$;

create trigger trg_recipe_ingredients_no_circular
  before insert or update of sub_recipe_id on public.recipe_ingredients
  for each row execute function public.check_no_circular_subrecipe();

-- ---------------------------------------------------------------------
-- calculate_recipe_cost, herbouwd: converteert nu daadwerkelijk eenheden
-- (via units.factor_to_base, alleen binnen dezelfde dimensie — spec §3:
-- nooit ongevalideerd tussen bv. liters en kilogrammen rekenen), past
-- het verliespercentage toe (regel overschrijft product-default), en
-- schaalt subrecepten via hun eigen opbrengst (yield_quantity) in plaats
-- van de hoeveelheid rechtstreeks te vermenigvuldigen.
--
-- p_depth is interne recursiebeveiliging (naast de trigger hierboven):
-- voorkomt dat een gemiste circulaire referentie de database vastdraait.
-- ---------------------------------------------------------------------
-- BELANGRIJK: CREATE OR REPLACE FUNCTION vervangt een functie niet als
-- het aantal argumenten verandert — dat maakt in Postgres een aparte,
-- overloaded functie aan. Zonder deze DROP zou de oude, niet-converterende
-- 2-argumenten-versie blijven bestaan en gebruikt worden door bestaande
-- aanroepen met precies 2 argumenten.
drop function if exists public.calculate_recipe_cost(uuid, uuid);

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
  v_product_base_factor numeric;
  v_ingredient_factor numeric;
  v_ingredient_dimension public.unit_dimension;
  v_product_dimension public.unit_dimension;
  v_price_per_base numeric;
  v_loss_pct numeric;
  v_sub_yield numeric;
  v_sub_cost numeric;
begin
  if p_depth > 15 then
    raise exception 'Kostprijsberekening afgebroken: te diepe subreceptuur-nesting (mogelijk een gemiste circulaire referentie).';
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

      -- Omrekenfactor van de receptregel-eenheid naar de basiseenheid van
      -- het product. Alleen toegestaan binnen dezelfde dimensie; anders
      -- wordt de regel overgeslagen (geen ongevalideerde conversie).
      v_ingredient_factor := null;
      if v_line.unit_id is not null and v_product_base_unit_id is not null then
        select u1.factor_to_base, u1.dimension, u2.dimension
        into v_ingredient_factor, v_ingredient_dimension, v_product_dimension
        from public.units u1, public.units u2
        where u1.id = v_line.unit_id and u2.id = v_product_base_unit_id;

        if v_ingredient_dimension is distinct from v_product_dimension then
          v_ingredient_factor := null; -- incompatibele dimensies, niet converteren
        end if;
      end if;

      if v_price_per_base is not null and v_ingredient_factor is not null then
        v_line_cost := v_line.quantity * v_ingredient_factor * v_price_per_base
                        * (1 + v_loss_pct / 100.0);
        v_total := v_total + v_line_cost;
      end if;
      -- Ontbreekt een prijs of een geldige conversie: draagt deze regel
      -- niets bij (i.p.v. de hele berekening te laten falen), zodat één
      -- incomplete regel niet de kostprijs van het hele recept blokkeert.

    elsif v_line.sub_recipe_id is not null then
      select r.yield_quantity into v_sub_yield
      from public.recipes r where r.id = v_line.sub_recipe_id;

      v_sub_cost := public.calculate_recipe_cost(
        v_line.sub_recipe_id, p_company_id, p_depth + 1
      );

      if v_sub_cost is not null and v_sub_yield is not null and v_sub_yield > 0 then
        v_total := v_total + v_sub_cost * (v_line.quantity / v_sub_yield);
      end if;
    end if;
  end loop;

  return round(v_total, 4);
end;
$$;

comment on function public.calculate_recipe_cost(uuid, uuid, integer) is
  'Kostprijs van een receptuur: converteert receptregel-eenheden naar de basiseenheid van elk product, past verlies%% toe, en schaalt subrecepten via hun yield_quantity. p_depth beschermt tegen (gemiste) circulaire subrecepten.';

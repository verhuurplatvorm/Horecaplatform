-- 0091_allergenen_handmatig_per_recept.sql
-- Handmatig allergenen aanpassen per gerecht/halfproduct.
--
-- De automatische afleiding (uit ingrediënten en halfproducten) blijft de
-- basis. De kok kan per allergeen een eigen keuze vastleggen die daar
-- bovenop gaat:
--   'bevat'      -> het allergeen staat in "Bevat"
--   'sporen'     -> het allergeen staat in "Kan sporen bevatten van"
--   'bevat_niet' -> het allergeen staat in "Bevat niet"
-- Een allergeen zonder eigen keuze volgt gewoon de automatische afleiding.
-- Omdat calculate_recipe_allergens recursief werkt, werkt een handmatige
-- keuze op een halfproduct ook door in de gerechten waarin het wordt gebruikt.

alter table public.recipes
  add column if not exists allergen_overrides jsonb not null default '{}'::jsonb;

comment on column public.recipes.allergen_overrides is
  'Handmatige allergeenkeuzes per allergeen: {"gluten": "bevat" | "sporen" | "bevat_niet"}. Leeg = alles automatisch uit de ingrediënten.';

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
  v_over jsonb;
  v_key text;
  v_choice text;
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

  -- Handmatige keuzes van de kok gaan boven de automatische afleiding.
  select allergen_overrides into v_over from public.recipes where id = p_recipe_id;
  if v_over is not null and v_over <> '{}'::jsonb then
    for v_key, v_choice in select key, value from jsonb_each_text(v_over)
    loop
      v_contains := array_remove(v_contains, v_key);
      v_traces := array_remove(v_traces, v_key);
      if v_choice = 'bevat' then
        v_contains := v_contains || v_key;
      elsif v_choice = 'sporen' then
        v_traces := v_traces || v_key;
      end if;
    end loop;
  end if;

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
  'Verzamelt allergenen (bevat/sporen) van een gerecht/halfproduct via producten en (recursief) halfproducten, met handmatige keuzes (recipes.allergen_overrides) boven de automatische afleiding.';

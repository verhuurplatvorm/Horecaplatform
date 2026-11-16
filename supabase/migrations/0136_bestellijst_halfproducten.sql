-- 0136: Bestellijst met halfproducten als aparte regel.
--
-- Halfproducten liggen meestal op voorraad. De bestellijst klapt ze daarom
-- niet meer automatisch uit tot ingrediënten: ze komen als eigen regel
-- (herinnering: "dit heb je nodig, check of het in huis is"). Wat er nodig
-- is als je het halfproduct wél moet maken, levert deze functie apart aan,
-- gelabeld met het halfproduct. De app telt die ingrediënten pas mee als
-- iemand het halfproduct op "niet in huis" zet.
--
-- Uitvoer (get_event_menu_order_needs):
--   halfproduct_id = X, product_id = null  → behoefte aan halfproduct X
--                                            (in de basiseenheid van X)
--   halfproduct_id = null, product_id = P  → ingrediënt P, altijd bestellen
--   halfproduct_id = X, product_id = P     → ingrediënt P, alleen als X
--                                            gemaakt moet worden
--
-- Alleen het bovenste halfproduct telt als regel; halfproducten binnen een
-- halfproduct worden onder dat bovenste halfproduct volledig uitgeklapt.
-- Omrekenen loopt via convert_recipe_quantity (stuk ↔ ml/g via
-- piece_quantity) en voor ingrediënten via convert_quantity, BRUTO, net als
-- explode_recipe_to_products.

create or replace function public.order_explode_recipe(
  p_recipe_id uuid,
  p_factor numeric,
  p_depth integer,
  p_tag uuid
)
returns table(halfproduct_id uuid, product_id uuid, quantity_in_base numeric)
language plpgsql
stable
as $$
declare
  v_line record;
  v_base uuid;
  v_qty numeric;
  v_sub record;
  v_sub_qty numeric;
begin
  if p_depth > 15 or p_factor is null or p_factor <= 0 then
    return;
  end if;

  for v_line in
    select ri.product_id, ri.sub_recipe_id, ri.quantity, ri.unit_id
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id
  loop
    if v_line.product_id is not null then
      select p.base_unit_id into v_base from public.products p where p.id = v_line.product_id;
      v_qty := public.convert_quantity(v_line.product_id, v_line.quantity, v_line.unit_id, v_base, false);
      if v_qty is not null then
        halfproduct_id := p_tag;
        product_id := v_line.product_id;
        quantity_in_base := v_qty * p_factor;
        return next;
      end if;

    elsif v_line.sub_recipe_id is not null then
      select r.id, r.yield_quantity, r.base_unit_id, r.recipe_kind
      into v_sub
      from public.recipes r where r.id = v_line.sub_recipe_id;

      if v_line.unit_id is null or v_sub.base_unit_id is null or v_line.unit_id = v_sub.base_unit_id then
        v_sub_qty := v_line.quantity;
      else
        v_sub_qty := public.convert_recipe_quantity(v_sub.id, v_line.quantity, v_line.unit_id, v_sub.base_unit_id);
      end if;
      if v_sub_qty is null then
        continue;
      end if;

      if v_sub.recipe_kind = 'halfproduct' and p_tag is null then
        -- Bovenste halfproduct: eigen regel + zijn ingrediënten gelabeld.
        halfproduct_id := v_sub.id;
        product_id := null;
        quantity_in_base := v_sub_qty * p_factor;
        return next;
        if v_sub.yield_quantity > 0 then
          return query
            select * from public.order_explode_recipe(
              v_sub.id, p_factor * v_sub_qty / v_sub.yield_quantity, p_depth + 1, v_sub.id);
        end if;
      elsif v_sub.yield_quantity > 0 then
        return query
          select * from public.order_explode_recipe(
            v_sub.id, p_factor * v_sub_qty / v_sub.yield_quantity, p_depth + 1, p_tag);
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.get_event_menu_order_needs(p_menu_id uuid)
returns table(halfproduct_id uuid, product_id uuid, quantity_in_base numeric)
language plpgsql
stable
as $$
declare
  v_line record;
  v_plan record;
  v_base uuid;
  v_qty numeric;
  v_rec record;
  v_hid uuid[] := '{}';
  v_pid uuid[] := '{}';
  v_q numeric[] := '{}';
  v_row record;
begin
  for v_line in
    select l.id, l.recipe_id, l.product_id, l.unit_id
    from public.event_menu_lines l where l.menu_id = p_menu_id
  loop
    select * into v_plan from public.event_line_plan(v_line.id);

    if v_line.product_id is not null then
      select p.base_unit_id into v_base from public.products p where p.id = v_line.product_id;
      v_qty := public.convert_quantity(v_line.product_id, v_plan.needed, v_line.unit_id, v_base, false);
      if v_qty is not null then
        v_hid := v_hid || null::uuid;
        v_pid := v_pid || v_line.product_id;
        v_q := v_q || v_qty;
      end if;

    elsif v_line.recipe_id is not null then
      select r.id, r.yield_quantity, r.base_unit_id, r.recipe_kind
      into v_rec from public.recipes r where r.id = v_line.recipe_id;

      if v_plan.is_party then
        for v_row in
          select * from public.order_explode_recipe(v_rec.id, v_plan.recipe_factor, 0, null)
        loop
          v_hid := v_hid || v_row.halfproduct_id;
          v_pid := v_pid || v_row.product_id;
          v_q := v_q || v_row.quantity_in_base;
        end loop;
        continue;
      end if;

      if v_line.unit_id is null or v_rec.base_unit_id is null or v_line.unit_id = v_rec.base_unit_id then
        v_qty := v_plan.needed;
      else
        v_qty := public.convert_recipe_quantity(v_rec.id, v_plan.needed, v_line.unit_id, v_rec.base_unit_id);
      end if;
      if v_qty is null then
        continue;
      end if;

      if v_rec.recipe_kind = 'halfproduct' then
        v_hid := v_hid || v_rec.id;
        v_pid := v_pid || null::uuid;
        v_q := v_q || v_qty;
        if v_rec.yield_quantity > 0 then
          for v_row in
            select * from public.order_explode_recipe(v_rec.id, v_qty / v_rec.yield_quantity, 0, v_rec.id)
          loop
            v_hid := v_hid || v_row.halfproduct_id;
            v_pid := v_pid || v_row.product_id;
            v_q := v_q || v_row.quantity_in_base;
          end loop;
        end if;
      elsif v_rec.yield_quantity > 0 then
        for v_row in
          select * from public.order_explode_recipe(v_rec.id, v_qty / v_rec.yield_quantity, 0, null)
        loop
          v_hid := v_hid || v_row.halfproduct_id;
          v_pid := v_pid || v_row.product_id;
          v_q := v_q || v_row.quantity_in_base;
        end loop;
      end if;
    end if;
  end loop;

  return query
    select t.h, t.p, sum(t.q)
    from unnest(v_hid, v_pid, v_q) as t(h, p, q)
    group by t.h, t.p;
end;
$$;

grant execute on function public.order_explode_recipe(uuid, numeric, integer, uuid) to authenticated;
grant execute on function public.get_event_menu_order_needs(uuid) to authenticated;

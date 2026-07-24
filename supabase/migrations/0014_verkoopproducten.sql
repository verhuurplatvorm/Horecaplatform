-- 0014_verkoopproducten.sql
-- Koppeling receptuur ↔ verkoopproduct (spec §8). Tot nu toe stond
-- sales_price direct op recipes, wat één receptuur gelijkstelde aan
-- precies één verkoopprijs. In werkelijkheid moet:
-- - één receptuur aan meerdere verkoopproducten gekoppeld kunnen worden
--   (kleine/grote portie, lunch/diner, per locatie een andere prijs);
-- - één verkoopproduct uit meerdere receptcomponenten kunnen bestaan
--   (bv. hoofdgerecht + bijgerecht als afzonderlijke regels).
--
-- recipes.sales_price blijft bestaan voor eenvoudige gevallen (backward
-- compatible), maar sales_products is vanaf nu de correcte manier om
-- verkoopprijzen per bedrijf/locatie te beheren.

create table public.sales_products (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references public.groups(id) on delete cascade,
  company_id         uuid not null references public.companies(id) on delete cascade,
  name               text not null,
  category           text,
  sales_price_incl_vat numeric(10,2) not null,
  vat_rate           numeric(5,2) not null default 9,
  pos_reference      text,       -- vrij veld voor kassakoppeling-referentie
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index idx_sales_products_company on public.sales_products(company_id);

create trigger trg_sales_products_updated_at
  before update on public.sales_products
  for each row execute function public.set_updated_at();

-- Receptcomponenten waaruit een verkoopproduct is opgebouwd. quantity is
-- het aantal keer de portie van dat recept (bv. 1x hoofdgerecht, 1x
-- bijgerecht = twee regels met quantity 1; "extra portie friet" = een
-- component met quantity 2).
create table public.sales_product_components (
  id                uuid primary key default gen_random_uuid(),
  sales_product_id  uuid not null references public.sales_products(id) on delete cascade,
  recipe_id         uuid not null references public.recipes(id) on delete restrict,
  quantity          numeric(10,4) not null default 1 check (quantity > 0),
  sort_order        integer not null default 0
);

create index idx_sales_product_components_product on public.sales_product_components(sales_product_id);
create index idx_sales_product_components_recipe on public.sales_product_components(recipe_id);

-- ---------------------------------------------------------------------
-- Kostprijs van een verkoopproduct: som van (kostprijs per portie van elk
-- gekoppeld recept × aantal), waarbij "kostprijs per portie" de totale
-- receptkostprijs deelt door portion_size (recepten worden doorgaans per
-- portie ingevoerd, dus portion_size is meestal 1 — maar bij een batch-
-- gerecht kan dit hoger zijn).
-- ---------------------------------------------------------------------
create or replace function public.calculate_sales_product_cost(
  p_sales_product_id uuid,
  p_company_id uuid
)
returns numeric
language plpgsql
stable
as $$
declare
  v_total numeric := 0;
  v_component record;
  v_recipe_cost numeric;
  v_portion_size numeric;
begin
  for v_component in
    select spc.recipe_id, spc.quantity
    from public.sales_product_components spc
    where spc.sales_product_id = p_sales_product_id
  loop
    select coalesce(r.portion_size, 1) into v_portion_size
    from public.recipes r where r.id = v_component.recipe_id;

    v_recipe_cost := public.calculate_recipe_cost(v_component.recipe_id, p_company_id);

    if v_recipe_cost is not null then
      v_total := v_total + v_component.quantity * (v_recipe_cost / greatest(v_portion_size, 0.0001));
    end if;
  end loop;

  return round(v_total, 4);
end;
$$;

comment on table public.sales_products is
  'Verkoopproducten (menukaart/kassa-items), per bedrijf met eigen prijs (spec §8). Kan uit meerdere receptcomponenten bestaan via sales_product_components.';
comment on table public.sales_product_components is
  'Koppeltabel: welke recepten (en in welke hoeveelheid) vormen samen dit verkoopproduct.';

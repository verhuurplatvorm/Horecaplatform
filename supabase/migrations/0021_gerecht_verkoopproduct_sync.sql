-- 0021_gerecht_verkoopproduct_sync.sql
-- Verkoopproducten en gerechten stonden los van elkaar, met verkoopprijs
-- op twee plekken (recipes.sales_price én een los sales_products-record)
-- zonder onderlinge koppeling. Dat is verwarrend: het gewone geval (één
-- gerecht, één prijs, één bedrijf) hoort automatisch te werken.
--
-- Nieuw gedrag: zodra een gerecht (recipe_kind = 'gerecht') een
-- company_id én een sales_price heeft, onderhoudt een trigger
-- automatisch een gekoppeld sales_products-record (1-op-1). De
-- uitzonderingen — meerdere portiegroottes, gebundelde menu's, een
-- andere prijs per bedrijf dan het "hoofd"-bedrijf van het gerecht —
-- blijven mogelijk via een los, handmatig aangemaakt verkoopproduct;
-- die blijven onaangeroerd door deze trigger.

alter table public.sales_products
  add column auto_generated_from_recipe_id uuid references public.recipes(id) on delete cascade;

create unique index uq_sales_products_auto_recipe
  on public.sales_products(auto_generated_from_recipe_id)
  where auto_generated_from_recipe_id is not null;

comment on column public.sales_products.auto_generated_from_recipe_id is
  'Gezet als dit verkoopproduct automatisch wordt beheerd vanuit een gerecht (recipes.sales_price). Handmatig aangemaakte verkoopproducten hebben dit veld leeg en worden nooit door de trigger overschreven.';

create or replace function public.sync_recipe_sales_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sales_product_id uuid;
begin
  select id into v_sales_product_id
  from public.sales_products
  where auto_generated_from_recipe_id = new.id;

  if new.recipe_kind = 'gerecht' and new.company_id is not null and new.sales_price is not null then
    if v_sales_product_id is null then
      insert into public.sales_products (
        group_id, company_id, name, category, sales_price_incl_vat, vat_rate,
        is_active, auto_generated_from_recipe_id
      ) values (
        new.group_id, new.company_id, new.name, new.category, new.sales_price,
        coalesce(new.vat_rate, 9), true, new.id
      )
      returning id into v_sales_product_id;

      insert into public.sales_product_components (sales_product_id, recipe_id, quantity, sort_order)
      values (v_sales_product_id, new.id, 1, 0);
    else
      update public.sales_products
      set company_id = new.company_id,
          name = new.name,
          category = new.category,
          sales_price_incl_vat = new.sales_price,
          vat_rate = coalesce(new.vat_rate, 9),
          is_active = true
      where id = v_sales_product_id;
    end if;
  elsif v_sales_product_id is not null then
    -- Gerecht heeft geen prijs (meer), is geen gerecht meer, of heeft
    -- geen bedrijf (centrale standaard): het automatische verkoopproduct
    -- wordt gedeactiveerd, niet verwijderd (behoud van prijshistorie/
    -- rapportages die er mogelijk naar verwijzen).
    update public.sales_products set is_active = false where id = v_sales_product_id;
  end if;

  return new;
end;
$$;

create trigger trg_sync_recipe_sales_product
  after insert or update of recipe_kind, company_id, sales_price, vat_rate, name, category
  on public.recipes
  for each row execute function public.sync_recipe_sales_product();

comment on function public.sync_recipe_sales_product() is
  'Houdt automatisch een sales_products-record in sync met een gerecht dat een company_id en sales_price heeft. Zie auto_generated_from_recipe_id.';

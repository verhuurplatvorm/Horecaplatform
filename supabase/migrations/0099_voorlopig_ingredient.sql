-- Voorlopig ingrediënt: een product dat al in recepten gebruikt wordt maar
-- nog niet besteld is (dus nog geen leveranciersartikel/prijs heeft).
-- Het rekent met de eigen kostprijs (manual_price_per_base_unit) als
-- schatting. Zodra er bij een factuur of prijslijst een leveranciersartikel
-- aan dit product gekoppeld wordt, gaat de leveranciersprijs automatisch
-- voor (current_product_cost) en vervalt de status "voorlopig".
alter table public.products
  add column if not exists is_provisional boolean not null default false;

comment on column public.products.is_provisional is
  'Voorlopig ingrediënt: nog niet besteld, rekent met geschatte eigen kostprijs. Wordt automatisch false zodra een leveranciersartikel gekoppeld wordt.';

create index if not exists products_provisional_idx
  on public.products (group_id)
  where is_provisional;

create or replace function public.clear_provisional_on_supplier_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.product_id is not null then
    update public.products
       set is_provisional = false
     where id = new.product_id
       and is_provisional;
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_products_clear_provisional on public.supplier_products;
create trigger supplier_products_clear_provisional
  after insert or update of product_id on public.supplier_products
  for each row execute function public.clear_provisional_on_supplier_product();

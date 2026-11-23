-- 0158: Bestellijst — "In huis".
-- 1. Per boeking: ingrediënt is (deze keer) in huis → hoeft niet besteld.
-- 2. Per ingrediënt: "altijd in huis" (basisvoorraad: zout, olie, kruiden…);
--    staat in elke bestellijst apart en telt niet mee in het bestelbedrag.

alter table public.event_menu_order_marks
  drop constraint if exists event_menu_order_marks_kind_check;
alter table public.event_menu_order_marks
  add constraint event_menu_order_marks_kind_check check (kind in ('besteld', 'niet_in_huis', 'in_huis'));

alter table public.products
  add column if not exists always_in_stock boolean not null default false;
comment on column public.products.always_in_stock is
  'Basisvoorraad: altijd in huis, hoeft niet op de bestellijst.';

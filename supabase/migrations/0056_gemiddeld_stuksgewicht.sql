-- 0056_gemiddeld_stuksgewicht.sql
--
-- Bij producten die per stuk worden ingekocht, maar in recepten in
-- gram/ml gebruikt worden (of andersom), ontbrak een brug tussen die
-- twee dimensies. Concreet voorbeeld: "Komkommer" rekent in recepten in
-- gram, maar wordt ingekocht per stuk — zonder een gemiddeld gewicht
-- per stuk kan een verpakking als "1 x 1 stuks" nooit omgerekend worden
-- naar gram, en bleef de regel hangen als "controleer de
-- productkoppeling" (hetzelfde patroon als eerder bij Mayonaise levo,
-- Satesaus en Mini Kaassoufflé).
--
-- Toevoeging: een optioneel "1 stuk komt overeen met X [eenheid]" per
-- product (bv. 1 stuk = 80 gram, of 1 stuk = 0,6 liter). Wordt gebruikt
-- als brug wanneer een verpakking of receptregel in een andere
-- dimensie staat dan de basiseenheid van het product, en alleen dan —
-- een gewone match binnen dezelfde dimensie (gram naar kg) blijft zoals
-- voorheen zonder deze brug werken.

alter table public.products
  add column if not exists avg_unit_quantity numeric(12,4)
  check (avg_unit_quantity is null or avg_unit_quantity > 0),
  add column if not exists avg_unit_id uuid references public.units(id);

comment on column public.products.avg_unit_quantity is
  'Gemiddelde hoeveelheid van avg_unit_id die overeenkomt met 1 stuk van dit product (bv. 80 voor "1 stuk = 80 gram"). Optioneel; alleen nodig als het product zowel per stuk als per gewicht/inhoud voorkomt.';
comment on column public.products.avg_unit_id is
  'De eenheid waarin avg_unit_quantity is uitgedrukt — altijd gewicht of inhoud, nooit "stuk" zelf (dat zou geen brug zijn).';

-- Bewaakt dat avg_unit_id niet per ongeluk op een "aantal"-eenheid
-- (zoals stuk) gezet wordt — dat zou de brug zinloos maken.
create or replace function public.check_avg_unit_not_aantal()
returns trigger
language plpgsql
as $$
declare
  v_dimension public.unit_dimension;
begin
  if new.avg_unit_id is not null then
    select dimension into v_dimension from public.units where id = new.avg_unit_id;
    if v_dimension = 'aantal' then
      raise exception 'Gemiddeld stuksgewicht moet in gewicht of inhoud zijn, niet in aantal.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_check_avg_unit on public.products;
create trigger trg_products_check_avg_unit
  before insert or update of avg_unit_id on public.products
  for each row execute function public.check_avg_unit_not_aantal();

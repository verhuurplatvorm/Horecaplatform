-- 0070_personeelsmaaltijden.sql
--
-- Personeelsmaaltijden registreren naast afval.
--
-- Bewust in dezelfde tabel met een type-veld, niet in een tweede
-- administratie: de vastlegging is identiek (wie, wat, hoeveel, waarde
-- uit dezelfde kostprijzen). Alleen de betekenis verschilt — afval is
-- verlies, een personeelsmaaltijd is een kostenpost. Door ze te scheiden
-- met een type blijven de totalen apart te tonen zonder dubbele tabellen,
-- schermen of berekeningen.
--
-- Net als afval staat dit los van voorraad.

create type public.consumption_type as enum ('afval', 'personeelsmaaltijd');

alter table public.waste_registrations
  add column if not exists registration_type public.consumption_type not null default 'afval';

comment on column public.waste_registrations.registration_type is
  'afval = weggegooid/derving; personeelsmaaltijd = intern verbruik door personeel. Beide worden op dezelfde manier vastgelegd en gewaardeerd, maar apart geteld.';

create index if not exists idx_waste_registrations_type
  on public.waste_registrations(group_id, registration_type, registered_at desc);

-- Een reden hoort bij afval; bij een personeelsmaaltijd is die niet van
-- toepassing. De kolom was al optioneel, dus er hoeft niets te wijzigen —
-- dit legt alleen vast waarom dat zo is.
comment on column public.waste_registrations.reason_id is
  'Reden van weggooien. Verplicht bij afval, leeg bij een personeelsmaaltijd.';

-- Vrije toelichting wordt verplicht zodra de reden "Anders" is; dat wordt
-- in het scherm afgedwongen. Hier alleen vastgelegd waar het veld voor is.
comment on column public.waste_registrations.note is
  'Vrije toelichting. Verplicht bij de reden "Anders", zodat die categorie niet stilzwijgend een verzamelbak wordt.';

-- ---------------------------------------------------------------------
-- waste_summary splitst nu per type, zodat afval en personeelsmaaltijden
-- niet door elkaar lopen in de totalen.
-- ---------------------------------------------------------------------
drop function if exists public.waste_summary(uuid, date, date);

create function public.waste_summary(
  p_company_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_type public.consumption_type default 'afval'
)
returns table (
  total_value numeric,
  registration_count integer,
  total_kg numeric,
  total_liter numeric,
  total_pieces numeric,
  previous_value numeric,
  ingredient_value numeric,
  halfproduct_value numeric
)
language sql
stable
as $$
  with bounds as (
    select
      coalesce(p_from, date_trunc('month', current_date)::date) as d_from,
      coalesce(p_to, current_date) as d_to
  ),
  prev as (
    select
      (select d_from from bounds) - ((select d_to from bounds) - (select d_from from bounds) + 1) as p_from,
      (select d_from from bounds) - 1 as p_to
  ),
  rows_in_period as (
    select w.*, u.dimension, u.factor_to_base
    from public.waste_registrations w
    left join public.units u on u.id = w.unit_id
    where not w.is_cancelled
      and w.registration_type = p_type
      and (p_company_id is null or w.company_id = p_company_id)
      and w.registered_at::date between (select d_from from bounds) and (select d_to from bounds)
  )
  select
    coalesce(sum(waste_value), 0),
    count(*)::integer,
    coalesce(sum(case when dimension = 'gewicht' then quantity * factor_to_base / 1000 end), 0),
    coalesce(sum(case when dimension = 'inhoud' then quantity * factor_to_base / 1000 end), 0),
    coalesce(sum(case when dimension = 'aantal' then quantity end), 0),
    (select coalesce(sum(w2.waste_value), 0)
     from public.waste_registrations w2, prev
     where not w2.is_cancelled
       and w2.registration_type = p_type
       and (p_company_id is null or w2.company_id = p_company_id)
       and w2.registered_at::date between prev.p_from and prev.p_to),
    coalesce(sum(case when product_id is not null then waste_value end), 0),
    coalesce(sum(case when recipe_id is not null then waste_value end), 0)
  from rows_in_period;
$$;

comment on function public.waste_summary(uuid, date, date, public.consumption_type) is
  'Totalen over een periode voor afval óf personeelsmaaltijden, met de daarvoor liggende even lange periode ter vergelijking.';

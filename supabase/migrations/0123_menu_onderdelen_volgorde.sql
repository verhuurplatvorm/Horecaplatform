-- Onderdelen van menu's: vaste volgorde en geen dubbele namen.
-- Probleem: alle onderdelen hadden sort_order 0, waardoor regels van
-- hetzelfde onderdeel (bv. "Koud") op twee plekken in het menu stonden.

-- 1. Regels uit dubbele onderdelen (zelfde naam, andere hoofdletters/spaties)
--    naar het eerste onderdeel met die naam. Lege dubbelen blijven staan
--    maar tonen niets.
with ranked as (
  select s.id, s.menu_id,
         lower(regexp_replace(trim(s.name), '\s+', ' ', 'g')) as key,
         first_value(s.id) over (
           partition by s.menu_id, lower(regexp_replace(trim(s.name), '\s+', ' ', 'g'))
           order by s.sort_order,
                    (select min(l.sort_order) from public.event_menu_lines l where l.section_id = s.id) nulls last,
                    s.id
         ) as keep_id
  from public.event_menu_sections s
)
update public.event_menu_lines l
set section_id = r.keep_id
from ranked r
where l.section_id = r.id and r.id <> r.keep_id;

-- 2. Volgorde opnieuw nummeren per menu: huidige volgorde, daarna de
--    plek van de eerste regel in dat onderdeel.
with numbered as (
  select s.id,
         row_number() over (
           partition by s.menu_id
           order by s.sort_order,
                    (select min(l.sort_order) from public.event_menu_lines l where l.section_id = s.id) nulls last,
                    s.name
         ) - 1 as rn
  from public.event_menu_sections s
)
update public.event_menu_sections s
set sort_order = n.rn
from numbered n
where n.id = s.id and s.sort_order is distinct from n.rn;

-- 3. Nieuw onderdeel zonder eigen volgorde komt achteraan.
create or replace function public.event_menu_section_next_sort()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.sort_order, 0) = 0 and exists (
    select 1 from public.event_menu_sections where menu_id = new.menu_id
  ) then
    select coalesce(max(sort_order), 0) + 1 into new.sort_order
    from public.event_menu_sections where menu_id = new.menu_id;
  end if;
  return new;
end;
$$;

drop trigger if exists event_menu_section_next_sort on public.event_menu_sections;
create trigger event_menu_section_next_sort
  before insert on public.event_menu_sections
  for each row execute function public.event_menu_section_next_sort();

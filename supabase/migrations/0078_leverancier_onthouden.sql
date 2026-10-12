-- 0078_leverancier_onthouden.sql
--
-- Als een factuur handmatig aan een bestaande leverancier wordt gekoppeld
-- (bv. "Fix Fisch B.V." op de factuur = "Fix-Fisch Zeevis groothandel" in
-- de leverancierslijst), onthoudt het systeem die koppeling:
--   1. de naam zoals die op de factuur staat wordt als bevestigde
--      alias bij de leverancier opgeslagen (deze tabel), en
--   2. ontbrekende btw-/kvk-/IBAN-gegevens van de leverancier worden
--      aangevuld (gebeurt in de applicatie, niet hier).
-- Een volgende factuur met dezelfde naam wordt daarna direct herkend.
-- Additief en idempotent.

create table if not exists public.supplier_name_aliases (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  alias_name  text not null,
  alias_key   text not null,
  created_at  timestamptz not null default now(),
  unique (group_id, alias_key)
);

create index if not exists supplier_name_aliases_supplier
  on public.supplier_name_aliases (supplier_id);

alter table public.supplier_name_aliases enable row level security;

drop policy if exists supplier_name_aliases_all on public.supplier_name_aliases;
create policy supplier_name_aliases_all on public.supplier_name_aliases
  for all using (group_id = public.current_user_group_id())
  with check (group_id = public.current_user_group_id());

comment on table public.supplier_name_aliases is
  'Namen waaronder een leverancier op facturen voorkomt, bevestigd door een gebruiker. Wordt gebruikt bij het herkennen van de leverancier.';

-- Leveranciersherkenning: nieuwe, betrouwbare stap "bevestigde_naam".
create or replace function public.match_supplier_from_invoice(
  p_group_id uuid,
  p_vat_number text,
  p_kvk_number text,
  p_iban text,
  p_name text
)
returns table (
  supplier_id uuid,
  supplier_name text,
  match_method text,
  iban_mismatch boolean
)
language plpgsql
stable
as $$
begin
  if p_vat_number is not null then
    return query
    select s.id, s.name, 'btw_nummer'::text, (s.iban is not null and p_iban is not null and s.iban is distinct from p_iban)
    from public.suppliers s
    where s.group_id = p_group_id and s.vat_number = p_vat_number;
    if found then return; end if;
  end if;

  if p_kvk_number is not null then
    return query
    select s.id, s.name, 'kvk_nummer'::text, (s.iban is not null and p_iban is not null and s.iban is distinct from p_iban)
    from public.suppliers s
    where s.group_id = p_group_id and s.kvk_number = p_kvk_number;
    if found then return; end if;
  end if;

  if p_iban is not null then
    return query
    select s.id, s.name, 'iban'::text, false
    from public.suppliers s
    where s.group_id = p_group_id and s.iban = p_iban;
    if found then return; end if;
  end if;

  if p_name is not null then
    -- Eerder door een gebruiker bevestigde naam.
    return query
    select s.id, s.name, 'bevestigde_naam'::text, false
    from public.supplier_name_aliases a
    join public.suppliers s on s.id = a.supplier_id
    where a.group_id = p_group_id
      and a.alias_key = trim(regexp_replace(lower(p_name), '[^a-z0-9]+', ' ', 'g'));
    if found then return; end if;

    return query
    select s.id, s.name, 'naam_gelijkenis'::text, false
    from public.suppliers s
    where s.group_id = p_group_id
      and similarity(lower(s.name), lower(p_name)) > 0.4
    order by similarity(lower(s.name), lower(p_name)) desc
    limit 3;
  end if;
end;
$$;

comment on function public.match_supplier_from_invoice(uuid, text, text, text, text) is
  'Herkent een leverancier op een factuur (spec §3): btw, kvk, IBAN, daarna een eerder bevestigde naam, daarna naamgelijkenis (alleen kandidaten).';

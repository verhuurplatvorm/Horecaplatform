-- 0077_genegeerde_factuurartikelen.sql
--
-- Artikelen die per leverancier nooit als ingrediënt/prijs verwerkt hoeven
-- te worden (bv. "Bar ijsemmer 10 liter zwart": een inkoopartikel dat geen
-- ingrediënt is). Bij een volgende factuur of prijslijst van dezelfde
-- leverancier worden zulke regels direct overgeslagen.
-- Herkenning: artikelnummer van de leverancier, of (als dat ontbreekt) de
-- genormaliseerde omschrijving. Het item kan altijd weer worden
-- teruggehaald (verwijderen uit deze tabel). Additief en idempotent.

create table if not exists public.ignored_invoice_items (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.groups(id) on delete cascade,
  supplier_id     uuid not null references public.suppliers(id) on delete cascade,
  article_number  text,
  description     text not null,
  description_key text not null,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create unique index if not exists ignored_invoice_items_unique
  on public.ignored_invoice_items (supplier_id, coalesce(article_number, ''), description_key);

create index if not exists ignored_invoice_items_supplier
  on public.ignored_invoice_items (supplier_id);

alter table public.ignored_invoice_items enable row level security;

drop policy if exists ignored_invoice_items_all on public.ignored_invoice_items;
create policy ignored_invoice_items_all on public.ignored_invoice_items
  for all using (group_id = public.current_user_group_id())
  with check (group_id = public.current_user_group_id());

comment on table public.ignored_invoice_items is
  'Per leverancier: artikelen die bij factuur-/prijslijstimport automatisch worden overgeslagen. Terug te halen door de regel te verwijderen.';

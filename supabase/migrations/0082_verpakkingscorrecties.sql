-- 0082_verpakkingscorrecties.sql
--
-- Logboek voor TECHNISCHE correcties van verpakkingsgegevens (bv. "4680 stuks"
-- die eigenlijk 18 stuks van 260 gram zijn). Bewust gescheiden van echte
-- leveranciersprijswijzigingen:
--   * een technische correctie wijzigt alleen packaging_unit_count en/of
--     packaging_description van een bestaande prijsregel — NIET de inkoopprijs
--     per verpakking en NIET de ingangsdatum;
--   * het prijsalarm (price_change_history / dashboard) kijkt naar
--     purchase_price per verpakking, dus een technische correctie veroorzaakt
--     geen onterecht prijsalarm;
--   * de oude waarden blijven hier bewaard (en in audit_log), zodat elke
--     correctie terug te draaien en na te lezen is.
-- Additief en idempotent.

create table if not exists public.packaging_corrections (
  id                      uuid primary key default gen_random_uuid(),
  group_id                uuid not null default public.current_user_group_id()
                            references public.groups(id) on delete cascade,
  batch_id                uuid not null,
  product_id              uuid not null references public.products(id) on delete cascade,
  supplier_product_id     uuid references public.supplier_products(id) on delete set null,
  supplier_id             uuid references public.suppliers(id) on delete set null,
  kind                    text not null default 'technisch' check (kind = 'technisch'),
  old_packaging_unit_count numeric(12,4),
  new_packaging_unit_count numeric(12,4),
  old_packaging_description text,
  new_packaging_description text,
  old_price_per_base_unit numeric(12,6),
  new_price_per_base_unit numeric(12,6),
  reason                  text not null,
  applied_by              uuid default auth.uid(),
  applied_at              timestamptz not null default now()
);

create index if not exists packaging_corrections_product
  on public.packaging_corrections (product_id, applied_at desc);
create index if not exists packaging_corrections_batch
  on public.packaging_corrections (batch_id);

alter table public.packaging_corrections enable row level security;

drop policy if exists packaging_corrections_all on public.packaging_corrections;
create policy packaging_corrections_all on public.packaging_corrections
  for all using (group_id = public.current_user_group_id())
  with check (group_id = public.current_user_group_id());

comment on table public.packaging_corrections is
  'Technische correcties van verpakkingsaantal/-omschrijving (geen leveranciersprijswijziging). Oude en nieuwe waarden per prijsregel; veroorzaakt geen prijsalarm omdat purchase_price ongewijzigd blijft.';

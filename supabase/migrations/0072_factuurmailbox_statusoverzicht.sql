-- 0072_factuurmailbox_statusoverzicht.sql
-- Bouwt de Factuurmailbox-module af op de al bestaande, webhook-gebaseerde
-- fundering (invoice_mailboxes + inbound_invoice_queue uit 0031, aangevuld
-- met item_category/leverings-velden uit 0071).
--
-- Bewust GEEN IMAP-postbus-polling toegevoegd: deze app is serverless
-- (Vercel + Supabase) en heeft al een werkende, instant-verwerkende
-- webhook-ontvangst via een e-mail-ontvangstdienst (Mailgun/Postmark/
-- SendGrid inbound parsing e.d.). Een los IMAP-cron-systeem zou die
-- bestaande, snellere aanpak dupliceren in plaats van verbeteren.
--
-- Deze migratie voegt toe wat nog ontbrak t.o.v. de volledige
-- Factuurmailbox-specificatie:
--   1. inbound_invoice_queue wordt het volledige statuslog: ELK
--      binnenkomend bericht krijgt een rij (ook een automatisch,
--      zonder tussenkomst verwerkte factuur) i.p.v. alleen de
--      gevallen die controle nodig hebben.
--   2. Volledige statusset: nieuw_ontvangen, wordt_verwerkt, verwerkt,
--      wacht_op_leverancier ("Controle nodig"), fout, dubbele_factuur,
--      afgewezen.
--   3. Dubbele-factuurdetectie: een hash van de bijlage-inhoud, plus
--      een check op leverancier+factuurnummer+totaalbedrag — voorkomt
--      dat een per ongeluk dubbel gemailde factuur twee keer verwerkt
--      wordt (spec §9: "Voorkom dubbele verwerking").
--   4. Instelbare foodcost-norm per groep (naast de al bestaande
--      price_alert_threshold_pct) zodat het margeprobleem-signaal
--      vanuit Beheer → Factuurverwerking aan te passen is.
--
-- Idempotent: elke stap controleert eerst of hij al is uitgevoerd.

-- ---------------------------------------------------------------------
-- 1. Nieuwe kolommen op inbound_invoice_queue
-- ---------------------------------------------------------------------
alter table public.inbound_invoice_queue
  add column if not exists attachment_hash text,
  add column if not exists invoice_number text,
  add column if not exists total_incl_vat numeric(12,2),
  add column if not exists error_message text,
  add column if not exists matched_supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists duplicate_of_queue_id uuid references public.inbound_invoice_queue(id) on delete set null,
  add column if not exists processed_at timestamptz;

comment on column public.inbound_invoice_queue.attachment_hash is
  'SHA-256 van de ruwe bijlage-inhoud. Gebruikt om te herkennen of exact dezelfde factuur al eens via de mailbox is binnengekomen (spec §9).';
comment on column public.inbound_invoice_queue.duplicate_of_queue_id is
  'Verwijst naar het eerder ontvangen bericht waarvan dit een dubbele is — alleen gevuld als status = ''dubbele_factuur''.';

-- Bestaande rijen hadden nog geen status buiten wacht_op_leverancier/
-- verwerkt/afgewezen; dat blijft geldig binnen de nu geformaliseerde set.
alter table public.inbound_invoice_queue drop constraint if exists inbound_invoice_queue_status_check;
alter table public.inbound_invoice_queue
  add constraint inbound_invoice_queue_status_check
  check (status in (
    'nieuw_ontvangen',
    'wordt_verwerkt',
    'verwerkt',
    'wacht_op_leverancier',
    'fout',
    'dubbele_factuur',
    'afgewezen'
  ));

create index if not exists idx_inbound_invoice_queue_hash
  on public.inbound_invoice_queue(group_id, attachment_hash)
  where attachment_hash is not null;

create index if not exists idx_inbound_invoice_queue_status
  on public.inbound_invoice_queue(group_id, status, received_at desc);

-- ---------------------------------------------------------------------
-- 2. Dubbele-detectiefunctie — gezaghebbende, herbruikbare controle
--    i.p.v. ad-hoc logica in de webhook-route.
-- ---------------------------------------------------------------------
create or replace function public.find_duplicate_invoice_email(
  p_group_id uuid,
  p_attachment_hash text,
  p_supplier_id uuid,
  p_invoice_number text,
  p_total_incl_vat numeric
)
returns uuid
language sql
stable
as $$
  select id from public.inbound_invoice_queue
  where group_id = p_group_id
    and status not in ('fout', 'afgewezen', 'dubbele_factuur')
    and (
      (p_attachment_hash is not null and attachment_hash = p_attachment_hash)
      or (
        p_supplier_id is not null and p_invoice_number is not null
        and matched_supplier_id = p_supplier_id
        and invoice_number = p_invoice_number
        and (p_total_incl_vat is null or total_incl_vat is null or total_incl_vat = p_total_incl_vat)
      )
    )
  order by received_at asc
  limit 1;
$$;

comment on function public.find_duplicate_invoice_email(uuid, text, uuid, text, numeric) is
  'Zoekt een eerder ontvangen e-mailfactuur die vermoedelijk hetzelfde document is: zelfde bijlage-hash, of zelfde leverancier+factuurnummer+totaalbedrag. Gebruikt door de inbound-email-webhook om dubbele verwerking te voorkomen (spec §9).';

-- ---------------------------------------------------------------------
-- 3. Statusoverzicht-view — telt per status, voor het dashboardpaneel
--    en het statusoverzichtscherm.
-- ---------------------------------------------------------------------
create or replace function public.mailbox_status_summary(
  p_group_id uuid,
  p_company_id uuid default null,
  p_days integer default 30
)
returns table (
  status text,
  aantal bigint
)
language sql
stable
as $$
  select status, count(*) as aantal
  from public.inbound_invoice_queue
  where group_id = p_group_id
    and (p_company_id is null or company_id = p_company_id)
    and received_at >= now() - (p_days || ' days')::interval
  group by status;
$$;

comment on function public.mailbox_status_summary(uuid, uuid, integer) is
  'Aantal binnengekomen e-mailfacturen per status, voor het Factuurmailbox-dashboardpaneel en -overzichtsscherm.';

-- ---------------------------------------------------------------------
-- 4. Instelbare foodcost-norm per groep (naast price_alert_threshold_pct)
-- ---------------------------------------------------------------------
alter table public.groups
  add column if not exists foodcost_norm_pct numeric(5,2) not null default 33;

comment on column public.groups.foodcost_norm_pct is
  'Foodcost-norm (%) waarboven een gerecht als margeprobleem gesignaleerd wordt (zie dashboard_margin_problems). Instelbaar onder Beheer -> Factuurverwerking.';

-- groups had tot nu toe alleen een select-policy — price_alert_threshold_pct
-- (0061) kon dus al die hele tijd nooit vanuit de applicatie zelf gewijzigd
-- worden. Voor het nieuwe instellingenscherm Beheer -> Factuurverwerking
-- (foodcost-norm + prijsalarm-drempel) is een update-policy nodig.
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups
  for update using (id = public.current_user_group_id() and public.is_group_admin())
  with check (id = public.current_user_group_id() and public.is_group_admin());

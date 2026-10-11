-- 0074_factuurmailbox_emailadres.sql
--
-- Per factuur-mailbox het e-mailadres vastleggen waarop facturen worden
-- ontvangen (bv. facturen@mg.culilogic.nl), zodat het naast de webhook-URL
-- in Beheer → Mailboxen beheren zichtbaar is. Alleen ter weergave: de
-- webhook gebruikt dit veld niet; de koppeling loopt via de route bij de
-- ontvangstdienst (Mailgun) naar de webhook-URL.
-- Additief en idempotent: bestaande mailboxen krijgen een leeg veld.

alter table public.invoice_mailboxes
  add column if not exists email_address text;

comment on column public.invoice_mailboxes.email_address is
  'Het e-mailadres waarop deze mailbox facturen ontvangt. Alleen ter weergave; de verwerking loopt via de webhook-token.';

-- 0073_factuurmailbox_negeerlijst.sql
--
-- Per factuur-mailbox een lijst met afzenders (e-mailadres, domein of een
-- deel van de naam) waarvan de e-mail NIET wordt ingelezen. Bedoeld voor
-- mail die wel in de factuurmailbox belandt maar geen inkoopfactuur is
-- (bv. een ovenreparatie of niet-food-rekeningen).
--
-- De webhook logt zulke berichten met status 'afgewezen' en de reden in
-- error_message, zodat ze in het statusoverzicht zichtbaar blijven, maar
-- start geen OCR en maakt geen prijsimport-batch aan.
-- Additief en idempotent: bestaande mailboxen krijgen een lege lijst.

alter table public.invoice_mailboxes
  add column if not exists ignored_senders text[] not null default '{}';

comment on column public.invoice_mailboxes.ignored_senders is
  'Afzenders die genegeerd worden: elk item is een e-mailadres, domein of naamdeel (hoofdletterongevoelig, "bevat"-vergelijking met de From-regel).';

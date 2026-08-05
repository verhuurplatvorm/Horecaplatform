-- 0041_leverancier_factuurstructuur.sql
-- Onthoudt per leverancier bijzonderheden in de factuuropmaak (bv. "kolom
-- X betekent stuks bij een S erachter, anders kilo"), zodat het uitlezen
-- via Claude vision bij een volgende factuur van dezelfde leverancier
-- direct rekening houdt met wat al eerder gecorrigeerd is.

create table public.supplier_invoice_templates (
  supplier_id uuid primary key references public.suppliers(id) on delete cascade,
  field_notes text not null default '',
  updated_at timestamptz not null default now()
);

comment on table public.supplier_invoice_templates is
  'Vrije-tekst aanwijzingen per leverancier over de opmaak van hun facturen, meegegeven aan de Claude OCR-prompt bij een volgende upload van dezelfde leverancier.';

alter table public.supplier_invoice_templates enable row level security;

create policy supplier_invoice_templates_select on public.supplier_invoice_templates
  for select using (
    exists (
      select 1 from public.suppliers s
      where s.id = supplier_invoice_templates.supplier_id
        and (
          (s.company_id is null and s.group_id = public.current_user_group_id())
          or public.has_company_access(s.company_id)
        )
    )
  );

create policy supplier_invoice_templates_write on public.supplier_invoice_templates
  for all using (
    exists (
      select 1 from public.suppliers s
      where s.id = supplier_invoice_templates.supplier_id
        and (
          (s.company_id is null and public.is_group_admin())
          or public.has_company_access(s.company_id)
        )
    )
  );

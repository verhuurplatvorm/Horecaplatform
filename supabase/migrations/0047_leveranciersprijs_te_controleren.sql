-- 0047_leveranciersprijs_te_controleren.sql
-- Markeert leveranciersprijzen die bij bulk-import als "onzeker" zijn
-- meegekomen (bv. de "Niet herkend"-kolom uit een externe export), zodat
-- ze gewoon geïmporteerd worden zonder de import te blokkeren, maar
-- later makkelijk teruggevonden kunnen worden voor controle.

alter table public.supplier_products
  add column if not exists flagged_for_review boolean not null default false;

comment on column public.supplier_products.flagged_for_review is
  'True als deze prijs bij import als onzeker/niet automatisch herkend is gemarkeerd — geen blokkade, alleen ter herinnering voor latere handmatige controle.';

create index if not exists idx_supplier_products_flagged
  on public.supplier_products(flagged_for_review)
  where flagged_for_review = true;

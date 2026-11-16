-- 0137: Menu's & buffetten rekenen standaard met 9% btw.
--
-- De standaard stond op 21%, waardoor de omzet excl. btw te laag en de
-- foodcost te hoog uitkwam (bv. "2 for 1 week 3": € 30 → € 24,79 i.p.v.
-- € 27,52). Eten valt onder 9%; alleen alcohol is 21%. Recepten en
-- verkoopproducten stonden al op 9%.

alter table public.event_menus alter column vat_rate set default 9;

update public.event_menus set vat_rate = 9 where vat_rate = 21;

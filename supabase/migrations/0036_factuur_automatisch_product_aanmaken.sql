-- 0036_factuur_automatisch_product_aanmaken.sql
-- Bij facturen (niet bij gewone prijslijsten) worden regels die zeker
-- geen match hebben nu automatisch als nieuw product aangemaakt en aan
-- de leverancier gekoppeld — mits er geen twijfel is (spec: bestaande
-- producten mogen nooit dubbel worden aangemaakt). Regels die op een
-- bestaand product lijken blijven gewoon handmatige controle vereisen.

alter type public.price_match_method add value if not exists 'automatisch_aangemaakt';

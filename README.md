# Horeca Platform — Fase 1: Fundament

Centraal horecamanagementsysteem voor één horecagroep met 1–25 bedrijven.
Dit is het fase 1-fundament uit het ontwikkelplan: organisatiestructuur,
gebruikersrechten, centrale productdatabase, leveranciers, recepturen,
kostprijzen, een basisdashboard en auditlogging. Personeelszaken zijn
bewust buiten scope gehouden.

## Techstack

- **Frontend:** Next.js 16 (App Router), React, TypeScript, Tailwind CSS v4
- **Backend:** Supabase (PostgreSQL, Auth, Row Level Security)
- **Auth:** Supabase magic-link e-mail login

## Snel starten

### 1. Supabase-project aanmaken

Maak een project aan op [supabase.com](https://supabase.com) (of draai
Supabase lokaal via de Supabase CLI).

### 2. Migraties draaien

Voer de bestanden in `supabase/migrations/` **in volgorde** uit tegen je
project (via de SQL-editor in het Supabase-dashboard, of via de Supabase
CLI: `supabase db push`):

1. `0001_extensions.sql` — extensies + generieke helpers
2. `0002_organisatie.sql` — groep, juridisch bedrijf, bedrijf, vestiging, afdeling, kostenplaats
3. `0003_gebruikers_rechten.sql` — profielen, rollen, rechten, RLS-helperfuncties
4. `0004_producten_leveranciers.sql` — centrale productdatabase + leveranciers
5. `0005_recepturen_kostprijzen.sql` — recepturenbeheer + live kostprijsberekening
6. `0006_audit_log.sql` — auditlogging
7. `0007_rls_policies.sql` — Row Level Security op alle tabellen
8. `0008_seed_dev.sql` — **optioneel**, alleen voor lokale ontwikkeling/testen (3 demo-bedrijven)

⚠️ Draai `0008_seed_dev.sql` **niet** in productie.

### 3. Environment variables

```bash
cp .env.local.example .env.local
```

Vul `NEXT_PUBLIC_SUPABASE_URL` en `NEXT_PUBLIC_SUPABASE_ANON_KEY` in vanuit
je Supabase-project (Project Settings → API).

### 4. Eerste groepsbeheerder aanmaken

Na het inloggen (magic link) moet er handmatig een rij in
`user_profiles` komen met `is_group_admin = true`, gekoppeld aan de
`auth.users.id` van het account, en een rij in `groups`. Bijvoorbeeld:

```sql
insert into groups (id, name) values ('...', 'Mijn Horeca Groep');
insert into user_profiles (id, group_id, full_name, email, is_group_admin)
values ('<auth.users.id>', '<group.id>', 'Jouw naam', 'jij@bedrijf.nl', true);
```

Latere gebruikers kunnen dan via de UI (fase 2) beheerd worden.

### 5. Installeren en draaien

```bash
npm install
npm run dev
```

De app draait op `http://localhost:3000` en stuurt niet-ingelogde
gebruikers automatisch naar `/login`.

## Architectuur — belangrijkste keuzes

- **Eén centrale database, geen database per bedrijf.** Scheiding loopt via
  `group_id` / `legal_entity_id` / `company_id` / `location_id` /
  `department_id` / `cost_center_id`, zoals gespecificeerd. Zie
  `0002_organisatie.sql`.
- **Row Level Security regelt autorisatie op databaseniveau**, niet alleen
  in de applicatielaag. `public.has_company_access(company_id)` en
  `public.is_group_admin()` (in `0003_gebruikers_rechten.sql`) zijn de
  centrale helperfuncties waar alle policies op leunen.
- **Centrale vs. lokale gegevens.** Producten en recepturen kunnen
  groepsbreed (`company_id IS NULL`) of lokaal bestaan. Lokale varianten
  van een centrale receptuur worden nooit stilzwijgend overschreven —
  `recipe_revisions` bewaart de wijzigingshistorie.
- **Kostprijzen zijn een live berekening, geen los veld.** De functie
  `calculate_recipe_cost(recipe_id, company_id)` rekent recursief door
  subrecepturen heen op basis van de actuele inkoopprijs
  (`current_product_cost`-view), zodat een prijswijziging bij de
  leverancier automatisch doorwerkt.
- **Auditlogging** loopt via een generieke trigger (`audit_row_change`)
  die aan de gevoeligste tabellen is gekoppeld (kostprijzen, recepturen,
  rechten, bedrijven). Uitbreidbaar naar meer tabellen door de trigger
  toe te voegen.
- **Bedrijfsselector** (`src/components/company-context.tsx` +
  `layout/company-switcher.tsx`) is de kern van de UI: overal schakelbaar
  tussen "alle bedrijven" (groepsweergave) en één of meerdere specifieke
  bedrijven, met RLS die vanzelf de zichtbare data begrenst.

## Projectstructuur

```
supabase/migrations/      Database-schema, RLS-policies, seeddata
src/lib/supabase/         Browser-, server- en middleware-clients
src/lib/types/database.ts Handmatige TS-types (vervang door `supabase gen types` zodra live)
src/components/           UI-primitieven, layout, bedrijfsselector
src/app/(app)/            Geauthenticeerde routes: dashboard, producten,
                           leveranciers, recepturen, bedrijven, gebruikers
src/app/login/            Inlogpagina (magic link)
```

## Wat hierna (fase 2–4, nog niet gebouwd)

- **Fase 2:** inkoop, voorraad, interne leveringen, productie, HACCP, afval, onderhoud, taken
- **Fase 3:** kassa-/boekhoud-/reserveringskoppelingen, groepsvergelijkingen, benchmarks, menu-engineering, prognoses
- **Fase 4:** AI-managementassistent, automatische afwijkingsanalyse, bestelvoorspellingen

Personeelszaken (planning, uren, contracten, verzuim, loonkosten) zijn
bewust buiten deze versie gehouden; het datamodel (aparte `company_id`-
scheiding, geen aannames die HR-achtige velden nodig hebben) laat dit
later toe als losse module.

## Belangrijk vóór productiegebruik

- Zet `0008_seed_dev.sql` nooit in een productiepijplijn.
- Vervang `src/lib/types/database.ts` door echte gegenereerde types zodra
  het schema in Supabase staat:
  `npx supabase gen types typescript --project-id <id> > src/lib/types/database.ts`.
  Let op: gebruik `type` in plaats van `interface` voor rij-types als je
  dit bestand handmatig aanpast — een `interface` breekt de
  typeninferentie van `@supabase/supabase-js` op subtiele wijze (elke
  query resolvet dan stilzwijgend naar `never`).
- Controleer de RLS-policies (`0007_rls_policies.sql`) tegen je eigen
  rollenmodel voordat gevoelige data (kostprijzen, contracten) wordt
  ingevoerd.

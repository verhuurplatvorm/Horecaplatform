-- Snellere toegangscontrole (RLS). Dezelfde regels, maar de controle-
-- functies worden één keer per opvraging uitgerekend i.p.v. per rij
-- (Supabase-advies: functies in "(select …)" zetten).
--   has_company_access(x)  → is_group_admin() OR x in eigen bedrijven
--   current_user_group_id(), is_group_admin(), auth.uid() → (select …)

create or replace function public.current_user_company_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(uca.company_id), '{}'::uuid[])
  from public.user_company_access uca
  where uca.user_id = auth.uid();
$$;
grant execute on function public.current_user_company_ids() to authenticated;

do $$
declare
  p record;
  q text;
  w text;
  sql text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(has_company_access\(|current_user_group_id\(\)|is_group_admin\(\)|auth\.uid\(\))'
  loop
    if (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~* 'not\s+has_company_access' then
      raise exception 'Onverwachte NOT has_company_access in %', p.policyname;
    end if;
    q := p.qual;
    w := p.with_check;
    -- 1. losse functies één keer per query
    q := replace(q, 'is_group_admin()', '( SELECT is_group_admin())');
    w := replace(w, 'is_group_admin()', '( SELECT is_group_admin())');
    q := replace(q, 'current_user_group_id()', '( SELECT current_user_group_id())');
    w := replace(w, 'current_user_group_id()', '( SELECT current_user_group_id())');
    q := replace(q, 'auth.uid()', '( SELECT auth.uid())');
    w := replace(w, 'auth.uid()', '( SELECT auth.uid())');
    -- 2. bedrijfstoegang zonder functie per rij
    q := regexp_replace(q, 'has_company_access\(([^)]*)\)',
           '(( SELECT is_group_admin()) OR (\1 IN ( SELECT unnest(current_user_company_ids()))))', 'g');
    w := regexp_replace(w, 'has_company_access\(([^)]*)\)',
           '(( SELECT is_group_admin()) OR (\1 IN ( SELECT unnest(current_user_company_ids()))))', 'g');
    sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if q is not null then
      sql := sql || ' using (' || q || ')';
    end if;
    if w is not null then
      sql := sql || ' with check (' || w || ')';
    end if;
    execute sql;
  end loop;
end;
$$;

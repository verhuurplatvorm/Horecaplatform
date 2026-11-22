-- 0143: Dagprijzen geven gewoon prijsalarmen.
-- LET OP: direct daarna vervangen door 0143_prijsalarmen_afgesproken_prijzen.sql
-- (zelfde doel, volledige nieuwe price_comparison). Bewaard omdat hij in de
-- migratiegeschiedenis van de database staat.
--
-- In 0142 gaven afwijkingen bij leveranciers met dagprijzen geen
-- waarschuwing in de prijscontrole. Dat is teruggedraaid: ook dagprijzen
-- geven een alarm volgens de normale grenzen, zodat de prijsontwikkeling
-- zichtbaar blijft. Ze krijgen alleen het label 'Dagprijs'.
-- Vaste prijzen blijven: elke afwijking melden, plus een verlopen prijslijst.
-- Gerichte aanpassing van de functie uit 0142; stopt als tekst niet klopt.

do $$
declare
  d text;
  n text;
  pairs text[][] := array[
    array[E'      when f.price_type = ''dag'' then 4\n', ''],
    array[E'p.pos_count >= p.repeat_count\n         and p.price_type is distinct from ''dag'' then 2', 'p.pos_count >= p.repeat_count then 2'],
    array['then ''Dagprijs — afwijking is normaal'' end', 'then ''Dagprijs'' end'],
    array['case when p.price_type is distinct from ''dag'' and p.diff > 0.005', 'case when p.diff > 0.005']
  ];
  i int;
begin
  d := pg_get_functiondef('public.price_comparison(date, date, uuid[])'::regprocedure);
  n := d;
  for i in 1 .. array_length(pairs, 1) loop
    if position(pairs[i][1] in n) = 0 then
      raise exception 'price_comparison: tekst % niet gevonden', i;
    end if;
    n := replace(n, pairs[i][1], pairs[i][2]);
  end loop;
  if position('is distinct from ''dag''' in n) > 0 then
    raise exception 'price_comparison: nog een dagprijs-uitzondering over';
  end if;
  execute n;
end;
$$;

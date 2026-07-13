-- ============================================
-- Fix identity sequences ONLY (no data loss)
-- Safe to run anytime — fixes "duplicate key" errors
-- ============================================
do $$
declare
  rec record;
  seq_name text;
begin
  for rec in
    select tablename, columnname
    from (values
      ('courses','id'),('lessons','id'),('lectures','id'),
      ('homework','id'),('hw_questions','id'),('exams','id'),
      ('exam_questions','id'),('progress','id')
    ) as t(tablename, columnname)
  loop
    seq_name := pg_get_serial_sequence(rec.tablename, rec.columnname);
    if seq_name is not null then
      execute format('select setval(%L, (select max(%I) from %I))', seq_name, rec.columnname, rec.tablename);
    end if;
  end loop;
end $$;

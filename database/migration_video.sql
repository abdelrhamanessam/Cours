-- ============================================
-- Migration: Add video support + Storage bucket
-- Run ONCE in Supabase SQL Editor
-- ============================================

-- 1. Add video_url column to lectures
alter table lectures add column if not exists video_url text default '';

-- 2. Create private storage bucket for videos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', false, 2147483648, array['video/mp4', 'video/webm', 'video/ogg'])
on conflict (id) do nothing;

-- 3. RLS policies for storage bucket
create policy "Authenticated can read videos"
on storage.objects for select
using (bucket_id = 'videos' and auth.role() = 'authenticated');

create policy "Admin can upload videos"
on storage.objects for insert
with check (bucket_id = 'videos' and auth.uid() in (select id from profiles where role='admin'));

create policy "Admin can update videos"
on storage.objects for update
using (bucket_id = 'videos' and auth.uid() in (select id from profiles where role='admin'));

create policy "Admin can delete videos"
on storage.objects for delete
using (bucket_id = 'videos' and auth.uid() in (select id from profiles where role='admin'));

-- 4. Reset sequence (safe, no data loss)
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

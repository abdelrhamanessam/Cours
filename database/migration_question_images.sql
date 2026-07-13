-- Migration: Add image_url and option_images columns to questions tables
alter table hw_questions add column if not exists image_url text default null;
alter table exam_questions add column if not exists image_url text default null;
alter table hw_questions add column if not exists option_images jsonb default '[]'::jsonb;
alter table exam_questions add column if not exists option_images jsonb default '[]'::jsonb;

-- Storage bucket for question images
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-images', 'question-images', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- RLS policies (DO block to avoid IF NOT EXISTS syntax error)
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Auth insert question-images' and tablename = 'objects') then
    create policy "Auth insert question-images" on storage.objects for insert
    with check (bucket_id = 'question-images' and auth.role() = 'authenticated');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Auth select question-images' and tablename = 'objects') then
    create policy "Auth select question-images" on storage.objects for select
    using (bucket_id = 'question-images' and auth.role() = 'authenticated');
  end if;
end $$;

-- ============================================
-- Migration: Add academic level (Sec 1/2/3)
-- Run ONCE in Supabase SQL Editor
-- ============================================

alter table courses add column if not exists level text not null default 'sec1';
alter table profiles add column if not exists level text not null default 'sec1';

-- Update trigger to include level from signup metadata
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, role, level)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), 'student', coalesce(new.raw_user_meta_data->>'level', 'sec1'));
  return new;
end;
$$ language plpgsql security definer;

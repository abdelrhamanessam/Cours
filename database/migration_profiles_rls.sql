-- Fix profiles RLS recursion: use security definer is_admin() helper
-- Without this, any policy that reads profiles from within a profiles policy causes infinite recursion.

drop policy if exists "Authenticated can read profiles" on profiles;
drop policy if exists "Admins can read all profiles" on profiles;
drop policy if exists "Users can read own profile" on profiles;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create policy "Users can read own profile" on profiles
  for select using (auth.uid() = id);

create policy "Admins can read all profiles" on profiles
  for select using (public.is_admin());

-- Migrate all existing Admin all * policies to use is_admin() to prevent future recursion
do $$
declare
  rec record;
begin
  for rec in select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname like 'Admin all %'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      rec.policyname, rec.schemaname, rec.tablename
    );
    execute format(
      'create policy %I on %I.%I for all using (public.is_admin()) with check (public.is_admin())',
      rec.policyname, rec.schemaname, rec.tablename
    );
  end loop;
end $$;

-- Fix storage policies
drop policy if exists "Admin can upload videos" on storage.objects;
drop policy if exists "Admin can update videos" on storage.objects;
drop policy if exists "Admin can delete videos" on storage.objects;

create policy "Admin can upload videos" on storage.objects
  for insert with check (bucket_id = 'videos' and public.is_admin());

create policy "Admin can update videos" on storage.objects
  for update using (bucket_id = 'videos' and public.is_admin());

create policy "Admin can delete videos" on storage.objects
  for delete using (bucket_id = 'videos' and public.is_admin());

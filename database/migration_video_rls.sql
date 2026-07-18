-- ===============================================================
-- Migration: Enable RLS on video tables + Admin-only policies
-- Dependency: migration_profiles_rls.sql (provides public.is_admin())
-- Run ONLY after migration_profiles_rls.sql has been applied.
-- ===============================================================

-- Guard: verify is_admin() exists before proceeding
do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'is_admin' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'public.is_admin() not found. Apply migration_profiles_rls.sql first.';
  end if;
end $$;

-- ============================================================
-- 1. video_manifests
--    Contains: id, master_key, lesson_id, course_id, etc.
--    Master key is the crown jewel — must be admin-only.
-- ============================================================
alter table video_manifests enable row level security;

drop policy if exists "Admin all video_manifests" on video_manifests;
create policy "Admin all video_manifests" on video_manifests
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 2. mega_segments
--    Contains: manifest_id, mega_link, iv, file_name, etc.
--    mega_link + file_name must never leak to students.
-- ============================================================
alter table mega_segments enable row level security;

drop policy if exists "Admin all mega_segments" on mega_segments;
create policy "Admin all mega_segments" on mega_segments
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 3. video_access_log
--    Currently written by Edge Functions (service_role, bypasses RLS).
--    Policy exists for future admin panel read access.
--    TODO: Wire up an admin dashboard view for this table.
-- ============================================================
alter table video_access_log enable row level security;

drop policy if exists "Admin all video_access_log" on video_access_log;
create policy "Admin all video_access_log" on video_access_log
  for all using (public.is_admin()) with check (public.is_admin());

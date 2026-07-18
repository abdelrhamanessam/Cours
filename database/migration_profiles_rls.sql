-- Restrict profiles read: users can read own profile, admins can read all
drop policy if exists "Authenticated can read profiles" on profiles;

create policy "Users can read own profile" on profiles
  for select using (auth.uid() = id);

create policy "Admins can read all profiles" on profiles
  for select using (auth.uid() in (select id from profiles where role = 'admin'));
